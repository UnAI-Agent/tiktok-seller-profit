$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$typed = Read-Host "Type prod to deploy marginmark-api-prod"
if ($typed -ne "prod") {
  throw "Aborted."
}
$dirty = git -C $root status --porcelain
if ($dirty) {
  throw "Refusing deploy: git tree is dirty. Commit or stash first."
}
$commit = git -C $root rev-parse --short HEAD
Write-Host "Deploying marginmark-api-prod at $commit"

Set-Location $backend

$fly = Get-Command fly -ErrorAction SilentlyContinue
if (-not $fly) { $fly = Get-Command flyctl -ErrorAction SilentlyContinue }
if (-not $fly) {
  throw "Install Fly CLI: https://fly.io/docs/flyctl/install/  then: fly auth login"
}

& $fly.Source deploy --config fly.prod.toml --strategy rolling --env "GIT_SHA=$commit"
$body = curl.exe -fsS "https://marginmark-api-prod.fly.dev/health"
if ($body -notmatch '"app_env"\s*:\s*"prod"') {
  throw "Health check did not report app_env=prod. Body: $body"
}
Write-Host $body
