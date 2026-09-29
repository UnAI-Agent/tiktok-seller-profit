$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$dirty = git -C $root status --porcelain
if ($dirty) {
  throw "Refusing deploy: git tree is dirty. Commit or stash first."
}
$commit = git -C $root rev-parse --short HEAD
Write-Host "Deploying marginmark-api-lle at $commit"

Copy-Item (Join-Path $root "src\tiers.json") (Join-Path $backend "tiers.json") -Force
Set-Location $backend

$fly = Get-Command fly -ErrorAction SilentlyContinue
if (-not $fly) { $fly = Get-Command flyctl -ErrorAction SilentlyContinue }
if (-not $fly) {
  throw "Install Fly CLI: https://fly.io/docs/flyctl/install/  then: fly auth login"
}

& $fly.Source deploy --config fly.lle.toml --strategy rolling --env "GIT_SHA=$commit"
$body = curl.exe -fsS "https://marginmark-api-lle.fly.dev/health"
if ($body -notmatch '"app_env"\s*:\s*"lle"') {
  throw "Health check did not report app_env=lle. Body: $body"
}
Write-Host $body
