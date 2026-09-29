$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. (Join-Path $PSScriptRoot "_load-env.ps1")

$envFile = Join-Path $root "deploy\lle.env"
if (Test-Path $envFile) {
  Import-DotEnv $envFile
} else {
  $env:VITE_API_BASE_URL = "https://marginmark-api-lle.fly.dev"
  $env:VITE_EXT_NAME = "MarginMark (LLE)"
  $env:VITE_STRIP_DEV_HOSTS = "0"
}
$env:VITE_LLE_BADGE = "1"

npm run build
node scripts/verify-prod.mjs --names-only
if ($LASTEXITCODE -ne 0) { throw "LLE product-name check failed." }
Write-Host "LLE unpacked build: dist/  API=$($env:VITE_API_BASE_URL)"
Write-Host "Load unpacked in chrome://extensions (keep the prod CWS install separate)."
