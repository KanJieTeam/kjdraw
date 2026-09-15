$ErrorActionPreference = 'Stop'

$KJDrawSourceSha = '466d8be59e1be68dea19043427b4ec9f6295c0ee'
$KJDrawProject = if ($env:KJDRAW_PROJECT) { $env:KJDRAW_PROJECT } else { (Get-Location).Path }
$KJDrawInstall = Join-Path $env:LOCALAPPDATA 'KJDraw\source-466d8be'

if (-not [IO.Path]::IsPathFullyQualified($KJDrawProject) -or -not (Test-Path -LiteralPath $KJDrawProject -PathType Container)) {
  throw 'Run this command inside an existing project, or set KJDRAW_PROJECT to its absolute path.'
}
Get-Command node, git -CommandType Application -ErrorAction Stop | Out-Null
node -e "if (+process.versions.node.split('.')[0] < 22) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'KJDraw requires Node.js 22 or newer.' }

if (Test-Path -LiteralPath $KJDrawInstall) {
  $KJDrawActual = (git -C $KJDrawInstall rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $KJDrawActual -ne $KJDrawSourceSha) {
    throw "The existing KJDraw install is not the pinned candidate: $KJDrawInstall"
  }
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KJDrawInstall) | Out-Null
  git clone --filter=blob:none --no-checkout https://github.com/KanJieTeam/kjdraw.git $KJDrawInstall
  if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the public KJDraw source candidate.' }
  git -C $KJDrawInstall checkout --detach $KJDrawSourceSha
  if ($LASTEXITCODE -ne 0) { throw 'Unable to check out the pinned KJDraw source candidate.' }
}

$KJDrawConnect = Join-Path $KJDrawInstall 'packages\kjdraw-sdk\bin\kjdraw-connect.mjs'
$KJDrawHost = Join-Path $KJDrawProject '.kjdraw\host.kjd'
Write-Host "Installing KJDraw project configuration in: $KJDrawProject"
if (Test-Path -LiteralPath $KJDrawHost -PathType Leaf) {
  node $KJDrawConnect --all --apply --workspace $KJDrawProject --input '.kjdraw/host.kjd'
} else {
  node $KJDrawConnect --all --apply --workspace $KJDrawProject --blank '.kjdraw/host.kjd' --units millimeter
}
if ($LASTEXITCODE -ne 0) { throw 'KJDraw refused the project connection; no conflicting client entry was overwritten.' }

Write-Host ''
Write-Host 'KJDraw project configuration is installed.' -ForegroundColor Green
Write-Host 'Restart your AI client, open this project, and verify the kjdraw tool call. Ask:'
Write-Host 'Use KJDraw to read the current drawing, then draw a circle with a 5 mm radius. Create a pending proposal only.'
Write-Host '或者输入：'
Write-Host '使用 KJDraw 读取当前图纸，然后画一个半径 5 mm 的圆；只生成待审核提案。'
