$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$head = git -C $root rev-parse --short HEAD

function Get-Health([string]$url) {
  try {
    $raw = curl.exe -fsS --max-time 20 $url 2>$null
    if (-not $raw) { return $null }
    return $raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-Row($target, $appEnv, $commit, $db, [bool]$bad) {
  $color = "Gray"
  if ($bad) { $color = "Red" }
  $line = "{0,-8} {1,-10} {2,-14} {3,-10}" -f $target, $appEnv, $commit, $db
  Write-Host $line -ForegroundColor $color
}

Write-Host ("{0,-8} {1,-10} {2,-14} {3,-10}" -f "target", "app_env", "commit", "db")
Write-Row "local" "-" $head "-" $false

$remotes = @(
  @{ Name = "lle"; Url = "https://marginmark-api-lle.fly.dev/health"; Env = "lle" },
  @{ Name = "prod"; Url = "https://marginmark-api-prod.fly.dev/health"; Env = "prod" }
)
foreach ($remote in $remotes) {
  $body = Get-Health $remote.Url
  if (-not $body) {
    Write-Row $remote.Name "unreachable" "-" "-" $true
    continue
  }
  $commit = [string]$body.commit
  if (-not $commit) { $commit = "-" }
  $db = [string]$body.db
  if (-not $db) { $db = "-" }
  $bad = ([string]$body.app_env -ne $remote.Env) -or ($commit -ne $head)
  Write-Row $remote.Name ([string]$body.app_env) $commit $db $bad
}
