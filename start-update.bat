@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%"

if "%PORT%"=="" set "PORT=8787"
if "%HOST%"=="" set "HOST=0.0.0.0"
set "LOCAL_BUN=%ROOT%runtime\bun\bun.exe"
set "BUN_CMD=bun"
set "BUN_READY="

echo.
echo ========================================
echo  GPT Image Workbench start / update
echo ========================================
echo  Project: %CD%
echo  Host:    %HOST%
echo  Port:    %PORT%
echo.

if exist "%LOCAL_BUN%" (
  set "BUN_CMD=%LOCAL_BUN%"
  set "BUN_READY=1"
  echo Using bundled Bun: %LOCAL_BUN%
  echo.
) else (
  where bun >nul 2>nul
  if errorlevel 1 (
  echo [WARN] Bun was not found.
  echo This machine needs Bun before the project can start.
  echo If this machine cannot access GitHub, copy bun.exe to:
  echo %LOCAL_BUN%
  echo.
  choice /C YN /M "Install Bun now"
  if errorlevel 2 (
    echo.
    echo Install Bun manually, then reopen this bat:
    echo powershell -c "irm bun.sh/install.ps1^|iex"
    echo.
    pause
    exit /b 1
  )
  echo.
  echo Installing Bun...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  if errorlevel 1 (
    echo.
    echo [ERROR] Bun install failed. Check the network, then try again.
    echo Manual install command:
    echo powershell -c "irm bun.sh/install.ps1^|iex"
    echo.
    pause
    exit /b 1
  )
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  where bun >nul 2>nul
  if errorlevel 1 (
    echo.
    echo [ERROR] Bun was installed but this window still cannot find it.
    echo Close this window, reopen start-update.bat, and try again.
    echo.
    pause
    exit /b 1
  )
  echo Bun installed.
  echo.
  set "BUN_READY=1"
  ) else (
    set "BUN_READY=1"
  )
)

if not "%BUN_READY%"=="1" (
  echo [ERROR] Bun was not found.
  echo Install Bun first, or copy bun.exe to:
  echo %LOCAL_BUN%
  echo Manual install command:
  echo powershell -c "irm bun.sh/install.ps1^|iex"
  echo.
  pause
  exit /b 1
)

echo [1/4] Installing dependencies...
"%BUN_CMD%" install --frozen-lockfile
if errorlevel 1 (
  if exist "node_modules" (
    echo.
    echo [WARN] Dependency install failed, but node_modules exists.
    echo Continuing with existing node_modules.
  ) else (
  echo.
  echo [ERROR] Dependency install failed.
  echo If package.json and bun.lock were changed intentionally, run:
  echo bun install
  echo.
  pause
  exit /b 1
  )
)

echo.
echo [2/4] Building frontend...
"%BUN_CMD%" run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed.
  echo Check the build error above. On Windows, try running this bat as administrator if esbuild reports spawn EPERM.
  echo.
  pause
  exit /b 1
)

echo.
echo [3/4] Stopping old process on port %PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=[int]$env:PORT; $listenerIds=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($id in $listenerIds) { if ($id) { Write-Host ('Stopping PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }"
if errorlevel 1 (
  echo.
  echo [WARN] Failed to check or stop the old port process. Continuing to start; if startup fails, check whether the port is occupied.
)

echo.
echo [4/4] Starting server...
if "%HOST%"=="0.0.0.0" (
  echo Main app:      http://127.0.0.1:%PORT%
  echo Config app:    http://127.0.0.1:%PORT%/config
  echo Health check:  http://127.0.0.1:%PORT%/api/health
  echo LAN app:       http://YOUR-LAN-IP:%PORT%
) else (
  echo Main app:      http://%HOST%:%PORT%
  echo Config app:    http://%HOST%:%PORT%/config
  echo Health check:  http://%HOST%:%PORT%/api/health
)
echo.
echo Keep this window open while the service is running.
echo Press Ctrl+C to stop.
echo.

"%BUN_CMD%" server/index.ts

echo.
echo Server stopped.
pause
