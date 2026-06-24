# package-extension.ps1 - packs extension/ into a zip for Chrome Web Store upload.
#
# Usage (PowerShell):  .\tools\package-extension.ps1
# Output:  dist\moodle-hebrew-subtitles-<version>.zip

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$extDir = Join-Path $root "extension"
$distDir = Join-Path $root "dist"

# Read version from manifest.json
$manifest = Get-Content (Join-Path $extDir "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version

if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
$zipPath = Join-Path $distDir "moodle-hebrew-subtitles-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Pack the whole extension/ folder (store zip must have manifest.json at root)
Compress-Archive -Path (Join-Path $extDir "*") -DestinationPath $zipPath

Write-Output "OK - package created: $zipPath"
Write-Output "version: $version"
Write-Output "Next: upload the zip at https://chrome.google.com/webstore/devconsole"
