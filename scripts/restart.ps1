$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
  Remove-Item Env:CHATGPT_WEB_BRIDGE_SETUP_ERROR -ErrorAction SilentlyContinue
  bun run setup:chatgpt-web
  if ($LASTEXITCODE -ne 0) {
    $env:CHATGPT_WEB_BRIDGE_SETUP_ERROR = "启动器准备 Python 环境失败，请查看上方日志并重新启动以恢复官网普通额度"
    Write-Warning "ChatGPT Web Python runtime setup failed. The app will continue without ordinary ChatGPT Web quota fallback."
  }

  bun run build
  if ($LASTEXITCODE -ne 0) {
    throw "bun run build failed with exit code $LASTEXITCODE"
  }

  $port = if ($env:PORT) { [int]$env:PORT } else { 8787 }
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)

  foreach ($processId in $processIds) {
    if ($processId -and $processId -ne $PID) {
      Stop-Process -Id $processId -Force
    }
  }

  bun run start
} finally {
  Pop-Location
}
