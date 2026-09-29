param(
  [switch]$All,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

# Patterns are concatenated so this file does not contain a contiguous secret.
$script:SecretRules = @(
  @{ Name = "gocspx"; Pattern = ("GOC" + "SPX-" + "[0-9A-Za-z_\-]{8,}") },
  @{ Name = "sk_live"; Pattern = ("sk_li" + "ve_" + "[A-Za-z0-9]{8,}") },
  @{ Name = "sk_test"; Pattern = ("sk_te" + "st_" + "[A-Za-z0-9]{8,}") },
  @{ Name = "whsec"; Pattern = ("wh" + "sec_" + "[A-Za-z0-9]{8,}") },
  @{ Name = "sk_ant"; Pattern = ("sk-" + "ant-" + "[A-Za-z0-9_\-]{8,}") },
  @{ Name = "db_url"; Pattern = ("post" + "gres(ql)?://[^:\s]+:[^@\s]+@") },
  @{ Name = "private_key"; Pattern = ("-----BE" + "GIN (RSA |EC |OPENSSH )?PRIVATE KEY-----") },
  @{ Name = "akia"; Pattern = ("AK" + "IA[0-9A-Z]{16}") },
  @{ Name = "jwt_secret"; Pattern = ("JWT_SEC" + "RET=\S{16,}") },
  @{ Name = "admin_key"; Pattern = ("ADMIN_" + "KEY=\S{16,}") }
)

function Test-Placeholder([string]$value) {
  if ($value -match "\.\.\.") { return $true }
  if ($value -match "<[^>\r\n]+>") { return $true }
  if ($value -match "(?i)xxx") { return $true }
  if ($value -match "(?i)example") { return $true }
  return $false
}

function Get-SecretNames([string]$text) {
  $names = @()
  if (-not $text) { return $names }
  foreach ($rule in $script:SecretRules) {
    foreach ($match in [regex]::Matches($text, $rule.Pattern)) {
      if (-not (Test-Placeholder $match.Value)) {
        $names += $rule.Name
        break
      }
    }
  }
  return $names
}

function Test-BlockedFileName([string]$path) {
  $norm = ($path -replace "\\", "/").Trim()
  $leaf = [System.IO.Path]::GetFileName($norm)
  if ($leaf -eq ".env.example" -or $norm -like "*.env.example") { return $false }
  if ($leaf -eq ".env") { return $true }
  if ($leaf -match "\.(pem|key|p12|pfx|db)$") { return $true }
  if ($norm -match "(^|/)deploy/[^/]+\.env$") { return $true }
  return $false
}

function Test-ContentExempt([string]$path) {
  $norm = ($path -replace "\\", "/")
  $leaf = [System.IO.Path]::GetFileName($norm)
  if ($norm -match "(^|/)docs/") { return $true }
  if ($leaf -like "*.example" -or $leaf -like "*.md") { return $true }
  if ($leaf -like "*.test.*" -or $leaf -like "test_*.py") { return $true }
  return $false
}

function Invoke-SelfTest {
  $failed = 0
  $cases = @(
    @{ Name = "gocspx blocked"; Text = (("GOC" + "SPX-") + "Abcdefgh12345678"); Block = $true },
    @{ Name = "gocspx allowed"; Text = (("GOC" + "SPX-") + "..."); Block = $false },
    @{ Name = "sk_live blocked"; Text = (("sk_li" + "ve_") + "Abcdefgh12345678"); Block = $true },
    @{ Name = "sk_live allowed"; Text = (("sk_li" + "ve_") + "..."); Block = $false },
    @{ Name = "sk_test blocked"; Text = (("sk_te" + "st_") + "Abcdefgh12345678"); Block = $true },
    @{ Name = "sk_test allowed"; Text = (("sk_te" + "st_") + "..."); Block = $false },
    @{ Name = "whsec blocked"; Text = (("wh" + "sec_") + "Abcdefgh12345678"); Block = $true },
    @{ Name = "whsec allowed"; Text = (("wh" + "sec_") + "..."); Block = $false },
    @{ Name = "sk_ant blocked"; Text = (("sk-" + "ant-") + "Abcdefgh12345678"); Block = $true },
    @{ Name = "sk_ant allowed"; Text = (("sk-" + "ant-") + "example1"); Block = $false },
    @{ Name = "db_url blocked"; Text = (("post" + "gresql://user:") + "Abcdefgh12345678" + "@db.internal/"); Block = $true },
    @{ Name = "db_url allowed"; Text = ("post" + "gresql://user:example@localhost/"); Block = $false },
    @{ Name = "private_key blocked"; Text = ("-----BE" + "GIN PRIVATE KEY-----"); Block = $true },
    @{ Name = "private_key allowed"; Text = ("-----BE" + "GIN example PRIVATE KEY-----"); Block = $false },
    @{ Name = "akia blocked"; Text = (("AK" + "IA") + "0123456789ABCDEF"); Block = $true },
    @{ Name = "akia allowed"; Text = (("AK" + "IA") + "EXAMPLEEXAMPLEEX"); Block = $false },
    @{ Name = "jwt blocked"; Text = (("JWT_SEC" + "RET=") + "Abcdefgh12345678"); Block = $true },
    @{ Name = "jwt allowed"; Text = ("JWT_SEC" + "RET=exampleexampleexample"); Block = $false },
    @{ Name = "admin blocked"; Text = (("ADMIN_" + "KEY=") + "Abcdefgh12345678"); Block = $true },
    @{ Name = "admin allowed"; Text = ("ADMIN_" + "KEY=<not-a-real-secret>"); Block = $false }
  )
  foreach ($case in $cases) {
    $hit = @(Get-SecretNames $case.Text).Count -gt 0
    if ($hit -ne [bool]$case.Block) {
      Write-Output "FAIL $($case.Name)"
      $failed++
    }
  }
  if (-not (Test-BlockedFileName "test.pem")) { Write-Output "FAIL pem name"; $failed++ }
  if (Test-BlockedFileName ".env.example") { Write-Output "FAIL env example name"; $failed++ }
  if (-not (Test-BlockedFileName "backend/.env")) { Write-Output "FAIL dotenv name"; $failed++ }
  if (Test-BlockedFileName "deploy/lle.env.example") { Write-Output "FAIL deploy example name"; $failed++ }
  if (-not (Test-BlockedFileName "deploy/lle.env")) { Write-Output "FAIL deploy env name"; $failed++ }
  if ($failed -gt 0) { exit 1 }
  Write-Output "self-test ok"
  exit 0
}

if ($SelfTest) { Invoke-SelfTest }
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$files = @()
if ($All) {
  $files = @(git ls-files)
} else {
  $files = @(git diff --cached --name-only --diff-filter=ACMR)
}
$files = @($files | Where-Object { $_ })

$findings = @()
foreach ($path in $files) {
  if (Test-BlockedFileName $path) {
    $findings += "$path (filename)"
  }
  if (Test-ContentExempt $path) { continue }
  if ($path -match "\.(png|jpg|jpeg|gif|webp|ico|woff2?|zip|pdf)$") { continue }
  $text = ""
  if ($All) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $text = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $path))
  } else {
    $text = git show ":$path"
    if ($LASTEXITCODE -ne 0) { continue }
  }
  $names = @(Get-SecretNames $text)
  if ($names.Count -gt 0) {
    $findings += ("{0} ({1})" -f $path, ($names -join ", "))
  }
}

if ($findings.Count -gt 0) {
  Write-Output "Blocked secret material (values omitted):"
  $findings | ForEach-Object { Write-Output "  $_" }
  exit 1
}

Write-Output "secret scan clean ($($files.Count) files)"
exit 0
