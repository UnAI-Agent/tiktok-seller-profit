$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"

git -C $root fetch origin main
if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed" }

$dirty = git -C $root status --porcelain
if ($dirty) { throw "Refusing promote: git tree is dirty. Commit or stash first." }
$branch = git -C $root branch --show-current
if ($branch -ne "main") { throw "Refusing promote: branch is '$branch'. Need main." }
$head = git -C $root rev-parse HEAD
$origin = git -C $root rev-parse origin/main
if ($head -ne $origin) { throw "Refusing promote: HEAD is not origin/main." }
$commit = git -C $root rev-parse --short HEAD

$lleRaw = curl.exe -fsS --max-time 20 "https://marginmark-api-lle.fly.dev/health"
$lle = $lleRaw | ConvertFrom-Json
if ($lle.app_env -ne "lle" -or $lle.commit -ne $commit) {
  throw "Refusing promote: LLE health must be app_env=lle and commit=$commit."
}

Push-Location $root
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "tsc failed" }
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test failed" }
Pop-Location

$python = Join-Path $backend "venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { $python = "python" }
Push-Location $backend
& $python -m pytest
if ($LASTEXITCODE -ne 0) { throw "pytest failed" }
Pop-Location

$fly = Get-Command fly -ErrorAction SilentlyContinue
if (-not $fly) { $fly = Get-Command flyctl -ErrorAction SilentlyContinue }
if (-not $fly) { throw "Install Fly CLI: https://fly.io/docs/flyctl/install/  then: fly auth login" }
$fly = $fly.Source

function Get-FlyImageRef([string]$app) {
  # Confirmed on fly v0.4.104: `releases -a APP --image -j` prints a JSON array
  # (ImageRef on each release; --image is the table column). No releases => [].
  # `image show -a APP -j` prints Registry/Repository/Tag/Digest, or null.
  $raw = & $fly releases -a $app --image -j
  if ($LASTEXITCODE -ne 0) { throw "fly releases --image failed for $app" }
  $text = ($raw | Out-String).Trim()
  $chosen = $null
  if ($text -and $text -ne "[]" -and $text -ne "null") {
    $releases = @($text | ConvertFrom-Json)
    $chosen = $releases | Where-Object { $_.Status -eq "complete" -and $_.ImageRef } | Select-Object -First 1
  }
  if ($chosen) { return [string]$chosen.ImageRef }

  $shown = & $fly image show -a $app -j
  if ($LASTEXITCODE -ne 0) { throw "No image on $app" }
  $showText = ($shown | Out-String).Trim()
  if (-not $showText -or $showText -eq "null" -or $showText -eq "[]") {
    throw "No deployed image on $app"
  }
  $machines = @($showText | ConvertFrom-Json)
  $machine = $machines | Where-Object { $_.Repository -and $_.Tag } | Select-Object -First 1
  if (-not $machine) { throw "No deployed image on $app" }
  $ref = "{0}/{1}:{2}" -f $machine.Registry, $machine.Repository, $machine.Tag
  if ($machine.Digest) { $ref = "$ref@$($machine.Digest)" }
  return $ref
}

$image = Get-FlyImageRef "marginmark-api-lle"
$previous = $null
try { $previous = Get-FlyImageRef "marginmark-api-prod" } catch { $previous = $null }

Write-Host "Target app: marginmark-api-prod"
Write-Host "Commit: $commit"
Write-Host "Image: $image"
$typed = Read-Host "Type prod to promote"
if ($typed -ne "prod") { throw "Aborted." }

& $fly deploy -a marginmark-api-prod --config (Join-Path $backend "fly.prod.toml") --image $image --strategy rolling --env "GIT_SHA=$commit"
if ($LASTEXITCODE -ne 0) {
  if ($previous) { Write-Host "fly deploy -a marginmark-api-prod --image $previous" }
  throw "fly deploy failed"
}

$ok = $false
foreach ($try in 1..36) {
  Start-Sleep -Seconds 5
  try {
    $prodRaw = curl.exe -fsS --max-time 20 "https://marginmark-api-prod.fly.dev/health"
    $prod = $prodRaw | ConvertFrom-Json
    if ($prod.app_env -eq "prod" -and $prod.commit -eq $commit) { $ok = $true; break }
  } catch {
    continue
  }
}
if (-not $ok) {
  if ($previous) {
    Write-Host "fly deploy -a marginmark-api-prod --image $previous"
  } else {
    Write-Host "No previous prod image was recorded."
  }
  throw "Prod /health did not report app_env=prod and commit=$commit"
}

$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$tag = "v" + $manifest.version
git -C $root rev-parse -q --verify "refs/tags/$tag" 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  git -C $root tag -a $tag -m "Prod promote $commit"
  if ($LASTEXITCODE -ne 0) { throw "git tag $tag failed" }
}
Write-Host "git push origin $tag"
