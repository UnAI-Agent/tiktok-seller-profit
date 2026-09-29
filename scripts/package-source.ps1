$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root "manifest.json") | ConvertFrom-Json).version
$output = Join-Path $root "marginmark-source-$version.zip"

Push-Location $root
try {
  git archive --format=zip --output=$output HEAD
  Write-Host "Created $output from tracked HEAD files."
} finally {
  Pop-Location
}
