# Local loop: this repo's API on :8000 (never ChromExtentionProjects\backend).
# Usage:
#   .\scripts\dev-up.ps1
#   .\scripts\dev-up.ps1 -Build
param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$python = Join-Path $backend "venv\Scripts\python.exe"

Write-Host "Stopping whatever is on 127.0.0.1:8000..."
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

if ($Build) {
  Set-Location $root
  npm run build
}

if (-not (Test-Path -LiteralPath $python)) {
  throw "Missing venv python at $python. From backend: python -m venv venv; .\venv\Scripts\pip install -r requirements.txt"
}
$envFile = Join-Path $backend ".env"
$dbLine = Select-String -LiteralPath $envFile -Pattern '^DATABASE_URL=(.*)$' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $dbLine -or -not $dbLine.Matches[0].Groups[1].Value.Trim()) {
  throw "DATABASE_URL is required. Start Postgres: docker run -d --name mm-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16 and set DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/postgres"
}
$appLine = Select-String -LiteralPath $envFile -Pattern '^APP_ENV=(.*)$' -ErrorAction SilentlyContinue | Select-Object -First 1
$appEnv = if ($appLine) { $appLine.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'") } else { "" }
if ($appEnv -ne "local") {
  throw "Refusing to start: dev-up.ps1 only runs when APP_ENV=local."
}

Write-Host ""
Write-Host "API starting from $backend"
Write-Host "Then: chrome://extensions -> Reload (0.1.4) -> Seller Center Ctrl+Shift+R -> toolbar icon."
Write-Host "Expect /health db_path under tiktok-seller-profit\backend"
Write-Host ""

Set-Location $backend
try {
  & $python -m uvicorn marginmark_app:app --host 127.0.0.1 --port 8000
} finally {
  Set-Location $root
}
