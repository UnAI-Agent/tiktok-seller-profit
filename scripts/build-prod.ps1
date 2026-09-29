$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. (Join-Path $PSScriptRoot "_load-env.ps1")

$envFile = Join-Path $root "deploy\prod.env"
if (Test-Path $envFile) {
  Import-DotEnv $envFile
} else {
  $env:VITE_API_BASE_URL = "https://marginmark-api-prod.fly.dev"
  $env:VITE_EXT_NAME = "MarginMark $([char]0x2014) Profit Calculator for TikTok Shop Sellers"
  $env:VITE_STRIP_DEV_HOSTS = "1"
}
$env:VITE_LLE_BADGE = "0"
if (-not $env:VITE_CONFIG_PUBLIC_KEY) {
  throw "Set VITE_CONFIG_PUBLIC_KEY to the public SPKI from: python scripts/config-keygen.py <path-outside-repo>"
}

npm run build
node scripts/verify-prod.mjs
if ($LASTEXITCODE -ne 0) { throw "Prod build check failed." }
Write-Host "Prod zip source: dist/  API=$($env:VITE_API_BASE_URL)"
Write-Host "Upload dist/ to the public Chrome Web Store listing."
