$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

npm run build

$packageDir = Join-Path $root "dist\ShiftRosterBuilder"
$packageZip = Join-Path $root "dist\ShiftRosterBuilder.zip"

if (Test-Path $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}
if (Test-Path $packageZip) {
  Remove-Item -LiteralPath $packageZip -Force
}

pyinstaller --noconfirm --clean ShiftRosterBuilder.spec

$readme = Join-Path $packageDir "README.txt"
@(
  "Shift Roster Builder packaged version",
  "",
  "1. Run ShiftRosterBuilder.exe.",
  "2. Your browser will open http://127.0.0.1:5173.",
  "3. To quit, close the black console window that opened with the app.",
  "",
  "Notes:",
  "- Saved monthly settings are stored in the browser.",
  "- This package uses the same URL, http://127.0.0.1:5173, so existing saved data remains available on the same PC and browser.",
  "- Close any other shift-roster-builder or development server before starting this packaged app."
) | Set-Content -LiteralPath $readme -Encoding UTF8

Compress-Archive -Path $packageDir -DestinationPath $packageZip

Write-Host "Package created:"
Write-Host $packageDir
Write-Host $packageZip
