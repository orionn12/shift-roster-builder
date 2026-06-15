$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$packageDir = Join-Path $root "dist\ShiftRosterBuilder"
$packageZip = Join-Path $root "dist\ShiftRosterBuilder.zip"
$existingRosterData = Join-Path $packageDir "data\rosters.json"
$rosterDataBackup = Join-Path $root "build\rosters.package.backup.json"

if (Test-Path $existingRosterData) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $rosterDataBackup) -Force | Out-Null
  Copy-Item -LiteralPath $existingRosterData -Destination $rosterDataBackup -Force
}

npm run build

if (Test-Path $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}
if (Test-Path $packageZip) {
  Remove-Item -LiteralPath $packageZip -Force
}

pyinstaller --noconfirm --clean ShiftRosterBuilder.spec
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE"
}

$readme = Join-Path $packageDir "README.txt"
@(
  "Shift Roster Builder packaged version",
  "",
  "1. Run ShiftRosterBuilder.exe.",
  "2. Your browser will open http://127.0.0.1:5173.",
  "3. To quit, close the black console window that opened with the app.",
  "",
  "Notes:",
  "- Saved monthly settings are stored in data\\rosters.json inside this folder.",
  "- Move the whole ShiftRosterBuilder folder when using another PC.",
  "- Close any other shift-roster-builder or development server before starting this packaged app."
) | Set-Content -LiteralPath $readme -Encoding UTF8

$docsDir = Join-Path $root "docs"
if (Test-Path $docsDir) {
  Get-ChildItem -LiteralPath $docsDir -Filter "*.txt" | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $packageDir $_.Name) -Force
  }
}

if (Test-Path $rosterDataBackup) {
  $dataDir = Join-Path $packageDir "data"
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  Copy-Item -LiteralPath $rosterDataBackup -Destination (Join-Path $dataDir "rosters.json") -Force
}

tar.exe -a -c -f $packageZip -C (Join-Path $root "dist") "ShiftRosterBuilder"
if ($LASTEXITCODE -ne 0) {
  throw "tar.exe failed with exit code $LASTEXITCODE"
}

Write-Host "Package created:"
Write-Host $packageDir
Write-Host $packageZip
