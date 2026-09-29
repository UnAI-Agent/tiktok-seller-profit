param(
  [ValidateSet("local", "lle")]
  [string]$Env = "local"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$failed = $false

function Add-Row([string]$Name, [bool]$Ok, [string]$Detail) {
  $mark = if ($Ok) { "OK" } else { "FAIL" }
  if (-not $Ok) { $script:failed = $true }
  Write-Host ("{0,-28} {1,-4} {2}" -f $Name, $mark, $Detail)
}

function Read-DotEnv([string]$Path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $map[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $map
}

function Test-Local {
  $path = Join-Path $root "backend\.env"
  $map = Read-DotEnv $path
  if ($null -eq $map) {
    Add-Row "backend/.env" $false "missing"
    return
  }
  Add-Row "APP_ENV" ($map["APP_ENV"] -eq "local") $(if ($map["APP_ENV"]) { $map["APP_ENV"] } else { "missing" })
  $db = [string]$map["DATABASE_URL"]
  $pooler = $db.Contains("-pooler")
  $devHost = $false
  $oneLine = -not ($db.Contains("`n"))
  if ($db) {
    try { $devHost = ([Uri]$db).Host -like "*marginmark-dev*" } catch { $devHost = $false }
  }
  $dbOk = [bool]$db -and $oneLine -and $pooler -and $devHost -and ($db.StartsWith("postgres"))
  $dbDetail = "set"
  if (-not $db) { $dbDetail = "missing" }
  elseif (-not $oneLine) { $dbDetail = "split across lines" }
  elseif (-not $pooler) { $dbDetail = "not a pooler URL" }
  elseif (-not $devHost) { $dbDetail = "host is not marginmark-dev" }
  Add-Row "DATABASE_URL" $dbOk $dbDetail
  foreach ($name in @("JWT_SECRET", "ADMIN_KEY", "TELEMETRY_READ_KEY")) {
    $value = [string]$map[$name]
    $long = $value.Length -ge 32
    Add-Row $name $long $(if (-not $value) { "missing" } elseif ($long) { ">=32" } else { "short" })
  }
  $distinct = $map["JWT_SECRET"] -and $map["ADMIN_KEY"] -and $map["TELEMETRY_READ_KEY"] -and
    ($map["JWT_SECRET"] -ne $map["ADMIN_KEY"]) -and
    ($map["JWT_SECRET"] -ne $map["TELEMETRY_READ_KEY"]) -and
    ($map["ADMIN_KEY"] -ne $map["TELEMETRY_READ_KEY"])
  Add-Row "secrets distinct" ([bool]$distinct) $(if ($distinct) { "yes" } else { "no" })
  Add-Row "TELEMETRY_ADMIN_KEY" (-not $map.ContainsKey("TELEMETRY_ADMIN_KEY")) $(if ($map.ContainsKey("TELEMETRY_ADMIN_KEY")) { "obsolete name is set" } else { "absent" })
  $stripe = [string]$map["STRIPE_SECRET_KEY"]
  Add-Row "STRIPE_SECRET_KEY" ($stripe.StartsWith("sk_test_")) $(if ($stripe.StartsWith("sk_live_")) { "sk_live_ (refused)" } elseif ($stripe.StartsWith("sk_test_")) { "sk_test_ (set)" } else { "missing" })
  $wh = [string]$map["STRIPE_WEBHOOK_SECRET"]
  Add-Row "STRIPE_WEBHOOK_SECRET" ($wh.StartsWith("whsec_")) $(if ($wh.StartsWith("whsec_")) { "whsec_ (set)" } else { "missing" })
  foreach ($pair in @(
      @("STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_TIKTOK_SELLER"),
      @("STRIPE_PRICE_PRO_YEARLY", "STRIPE_PRICE_TIKTOK_SELLER_YEARLY")
    )) {
    $value = [string]$map[$pair[0]]
    if (-not $value) { $value = [string]$map[$pair[1]] }
    Add-Row $pair[0] ($value.StartsWith("price_")) $(if ($value.StartsWith("price_")) { "price_ (set)" } else { "missing" })
  }
  foreach ($name in @("STRIPE_PRICE_DIAMOND_MONTHLY", "STRIPE_PRICE_DIAMOND_YEARLY")) {
    $value = [string]$map[$name]
    Add-Row $name ($value.StartsWith("price_")) $(if ($value.StartsWith("price_")) { "price_ (set)" } else { "missing" })
  }
  $gid = [string]$map["GOOGLE_CLIENT_ID"]
  $gsec = [string]$map["GOOGLE_CLIENT_SECRET"]
  $googleOk = ((-not $gid) -and (-not $gsec)) -or ($gid -and $gsec)
  Add-Row "GOOGLE_CLIENT" $googleOk $(if ($gid -and $gsec) { "set" } elseif ($googleOk) { "optional, unset" } else { "pair is incomplete" })
}

function Test-Lle {
  $fly = Get-Command fly -ErrorAction SilentlyContinue
  if (-not $fly) { $fly = Get-Command flyctl -ErrorAction SilentlyContinue }
  if (-not $fly) {
    Add-Row "fly" $false "missing"
    return
  }
  $raw = & $fly.Source secrets list -a marginmark-api-lle 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Add-Row "marginmark-api-lle" $false "fly secrets list failed"
    return
  }
  $names = New-Object System.Collections.Generic.HashSet[string]
  foreach ($line in $raw -split "`n") {
    if ($line -match '^\s*([A-Z][A-Z0-9_]+)\s+') { [void]$names.Add($Matches[1]) }
  }
  $required = @(
    "DATABASE_URL", "EXPECTED_DB_HOST", "JWT_SECRET", "ADMIN_KEY", "TELEMETRY_READ_KEY",
    "ADMIN_IP_ALLOWLIST", "EXTENSION_IDS", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY",
    "STRIPE_PRICE_DIAMOND_MONTHLY", "STRIPE_PRICE_DIAMOND_YEARLY"
  )
  foreach ($name in $required) {
    $present = $names.Contains($name)
    Add-Row $name $present $(if ($present) { "set" } else { "missing" })
  }
  Add-Row "TELEMETRY_ADMIN_KEY" (-not $names.Contains("TELEMETRY_ADMIN_KEY")) $(if ($names.Contains("TELEMETRY_ADMIN_KEY")) { "obsolete name is set" } else { "absent" })
}

Write-Host "check-env $Env"
if ($Env -eq "local") { Test-Local } else { Test-Lle }
if ($script:failed) { exit 1 }
Write-Host "check-env $Env passed"
