$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
Copy-Item (Join-Path $root "src\tiers.json") (Join-Path $backend "tiers.json") -Force
Set-Location $backend

docker build -t marginmark-api:smoke -f Dockerfile .
docker rm -f marginmark-smoke 2>$null | Out-Null
docker run -d --name marginmark-smoke -p 127.0.0.1:8001:8000 `
  -e ENV=development `
  -e APP_ENV=local `
  -e JWT_SECRET=example-example-example-example-example `
  marginmark-api:smoke | Out-Null

try {
  $ok = $false
  foreach ($try in 1..20) {
    Start-Sleep -Seconds 1
    try {
      $body = curl.exe -fsS "http://127.0.0.1:8001/health"
      if ($body -match '"status"\s*:\s*"ok"') { $ok = $true; break }
    } catch {
      continue
    }
  }
  if (-not $ok) { throw "Smoke container did not serve /health" }
  Write-Host $body
} finally {
  docker rm -f marginmark-smoke | Out-Null
}
