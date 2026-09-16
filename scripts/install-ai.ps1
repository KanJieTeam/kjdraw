$ErrorActionPreference = 'Stop'

$KJDrawSourceSha = '80e29bb14d33d68aff024b7098c40116bccd224e'
$KJDrawUserHome = if ($env:KJDRAW_USER_HOME) { $env:KJDRAW_USER_HOME } else { $env:USERPROFILE }
$KJDrawInstall = Join-Path $env:LOCALAPPDATA 'KJDraw\source-80e29bb'

if (-not $KJDrawUserHome -or -not [IO.Path]::IsPathRooted($KJDrawUserHome) -or -not (Test-Path -LiteralPath $KJDrawUserHome -PathType Container)) {
  throw 'The current user home directory could not be resolved safely.'
}
Get-Command node -CommandType Application -ErrorAction Stop | Out-Null
node -e "if (+process.versions.node.split('.')[0] < 22) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'KJDraw requires Node.js 22 or newer.' }

if (Test-Path -LiteralPath $KJDrawInstall) {
  $KJDrawMarker = Join-Path $KJDrawInstall '.kjdraw-source-sha'
  if (Test-Path -LiteralPath $KJDrawMarker -PathType Leaf) {
    $KJDrawActual = (Get-Content -Raw -LiteralPath $KJDrawMarker).Trim()
  } elseif (Test-Path -LiteralPath (Join-Path $KJDrawInstall '.git')) {
    Get-Command git -CommandType Application -ErrorAction Stop | Out-Null
    $KJDrawActual = (git -C $KJDrawInstall rev-parse HEAD).Trim()
  } else {
    $KJDrawActual = ''
  }
  if ($KJDrawActual -ne $KJDrawSourceSha) {
    throw "The existing KJDraw install is not the pinned candidate: $KJDrawInstall"
  }
} else {
  $KJDrawParent = Split-Path -Parent $KJDrawInstall
  $KJDrawStage = "$KJDrawInstall.stage-$PID"
  $KJDrawArchive = "$KJDrawStage.zip"
  if ((Test-Path -LiteralPath $KJDrawStage) -or (Test-Path -LiteralPath $KJDrawArchive)) {
    throw 'A KJDraw installer staging path already exists; inspect it instead of overwriting it.'
  }
  New-Item -ItemType Directory -Force -Path $KJDrawParent | Out-Null
  try {
    Invoke-WebRequest -Uri "https://codeload.github.com/KanJieTeam/kjdraw/zip/$KJDrawSourceSha" -OutFile $KJDrawArchive
    Expand-Archive -LiteralPath $KJDrawArchive -DestinationPath $KJDrawStage
    $KJDrawExpanded = @(Get-ChildItem -LiteralPath $KJDrawStage -Directory)
    if ($KJDrawExpanded.Count -ne 1) { throw 'The KJDraw source archive has an unexpected layout.' }
    Set-Content -LiteralPath (Join-Path $KJDrawExpanded[0].FullName '.kjdraw-source-sha') -Value $KJDrawSourceSha -NoNewline
    Move-Item -LiteralPath $KJDrawExpanded[0].FullName -Destination $KJDrawInstall
  } finally {
    if (Test-Path -LiteralPath $KJDrawArchive) { Remove-Item -LiteralPath $KJDrawArchive -Force }
    if (Test-Path -LiteralPath $KJDrawStage) { Remove-Item -LiteralPath $KJDrawStage -Recurse -Force }
  }
}

$KJDrawConnect = Join-Path $KJDrawInstall 'packages\kjdraw-sdk\bin\kjdraw-connect.mjs'
$KJDrawHost = Join-Path $KJDrawUserHome '.kjdraw\host.kjd'
Write-Host "Installing KJDraw user configuration in: $KJDrawUserHome"
if (Test-Path -LiteralPath $KJDrawHost -PathType Leaf) {
  $KJDrawOutput = @(node $KJDrawConnect --all --apply --scope user --workspace $KJDrawUserHome --input '.kjdraw/host.kjd')
} else {
  $KJDrawOutput = @(node $KJDrawConnect --all --apply --scope user --workspace $KJDrawUserHome --blank '.kjdraw/host.kjd' --units millimeter)
}
if ($LASTEXITCODE -ne 0) { throw 'KJDraw refused the user connection; no conflicting client entry was overwritten.' }
$KJDrawResult = ($KJDrawOutput -join [Environment]::NewLine) | ConvertFrom-Json
$KJDrawTrae = @($KJDrawResult.clients | Where-Object { $_.client -eq 'TraeCode' })[0]
if ($KJDrawTrae.installUrl) {
  $KJDrawTraeFile = Join-Path $KJDrawUserHome '.kjdraw\trae-install-url.txt'
  Set-Content -LiteralPath $KJDrawTraeFile -Value $KJDrawTrae.installUrl -NoNewline
  if (-not $env:KJDRAW_NO_OPEN_TRAE -and (Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\trae-cn')) {
    Start-Process $KJDrawTrae.installUrl
  }
}

Write-Host ''
Write-Host 'KJDraw user configuration is installed.' -ForegroundColor Green
Write-Host 'Restart Kimi Code, WorkBuddy, or ZCode and verify the kjdraw tool call in any workspace. TraeCode uses its official import confirmation.'
Write-Host 'Ask:'
Write-Host 'Use KJDraw to read the current drawing, then draw a circle with a 5 mm radius. Create a pending proposal only.'
