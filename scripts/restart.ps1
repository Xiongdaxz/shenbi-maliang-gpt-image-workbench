$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
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

  bun server/index.ts
} finally {
  Pop-Location
}
