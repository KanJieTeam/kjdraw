$ErrorActionPreference = 'Stop'

$KJDrawSourceSha = '6977028ba021ceb890a1f66bb02513e13851d2de'
$KJDrawUserHome = if ($env:KJDRAW_USER_HOME) { $env:KJDRAW_USER_HOME } else { $env:USERPROFILE }
$KJDrawDataRoot = Join-Path $env:LOCALAPPDATA 'KJDraw'
$KJDrawInstall = Join-Path $KJDrawDataRoot 'source-6977028'
$KJDrawStableBin = Join-Path $KJDrawDataRoot 'bin'
$KJDrawStableMcp = Join-Path $KJDrawStableBin 'kjdraw-mcp.mjs'
$KJDrawCurrent = Join-Path $KJDrawDataRoot 'current.json'
$KJDrawProcessUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$KJDrawDesktopUser = $null
try { $KJDrawDesktopUser = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName } catch {}
$KJDrawDifferentDesktopUser = $KJDrawDesktopUser -and -not [string]::Equals($KJDrawProcessUser, $KJDrawDesktopUser, [StringComparison]::OrdinalIgnoreCase)
$KJDrawPreviousMcpCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-000d7f7\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-ddb0b53\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-bb17394\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-734a7f4\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-4c7124e\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-0c2d86e\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-57e0697\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-1854240\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-5f655c2\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-69bec87\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-7b25cf4\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-b022932\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-6da40b2\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-85d750e\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-c526aa7\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-a3c1bca\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-71df822\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-616133e\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-2a793ad\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'),
  (Join-Path $env:LOCALAPPDATA 'KJDraw\source-be1e4b5\packages\kjdraw-sdk\bin\kjdraw-mcp.mjs')
)

function Assert-KJDrawSafeItem([string]$Path, [string]$Kind) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $KJDrawItem = Get-Item -Force -LiteralPath $Path
  if (($KJDrawItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Kind must not be a symbolic link or reparse point: $Path"
  }
}

function Install-KJDrawAtomicFile([string]$Staged, [string]$Target) {
  Assert-KJDrawSafeItem $Target 'KJDraw managed file'
  if (Test-Path -LiteralPath $Target) {
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw "KJDraw managed path is not a file: $Target" }
    $KJDrawBackup = "$Target.backup-$PID"
    if (Test-Path -LiteralPath $KJDrawBackup) { throw "KJDraw atomic backup already exists: $KJDrawBackup" }
    [IO.File]::Replace($Staged, $Target, $KJDrawBackup, $true)
    Remove-Item -LiteralPath $KJDrawBackup -Force
  } else {
    [IO.File]::Move($Staged, $Target)
  }
}
if (-not $KJDrawUserHome -or -not [IO.Path]::IsPathRooted($KJDrawUserHome) -or -not (Test-Path -LiteralPath $KJDrawUserHome -PathType Container)) {
  throw 'The current user home directory could not be resolved safely.'
}
Get-Command node -CommandType Application -ErrorAction Stop | Out-Null
node -e "if (+process.versions.node.split('.')[0] < 22) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'KJDraw requires Node.js 22 or newer.' }

Assert-KJDrawSafeItem $KJDrawDataRoot 'KJDraw data directory'
if (-not (Test-Path -LiteralPath $KJDrawDataRoot)) { New-Item -ItemType Directory -Path $KJDrawDataRoot | Out-Null }
if (-not (Test-Path -LiteralPath $KJDrawDataRoot -PathType Container)) { throw 'KJDraw data root is not a directory.' }
Assert-KJDrawSafeItem $KJDrawInstall 'KJDraw version directory'

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
  $KJDrawInstallDrive = New-Object System.IO.DriveInfo ([IO.Path]::GetPathRoot($KJDrawInstall))
  $KJDrawMinimumFreeBytes = 128MB
  if ($KJDrawInstallDrive.AvailableFreeSpace -lt $KJDrawMinimumFreeBytes) {
    $KJDrawAvailableMiB = [math]::Floor($KJDrawInstallDrive.AvailableFreeSpace / 1MB)
    throw "KJDraw needs at least 128 MiB free on $($KJDrawInstallDrive.Name) for an atomic install; only $KJDrawAvailableMiB MiB is available. Free disk space and run the same one-line installer again."
  }
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
    # Cleanup must never replace the real download, extraction, or move error.
    if (Test-Path -LiteralPath $KJDrawArchive) { Remove-Item -LiteralPath $KJDrawArchive -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $KJDrawStage) { Remove-Item -LiteralPath $KJDrawStage -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

$KJDrawConnect = Join-Path $KJDrawInstall 'packages\kjdraw-sdk\bin\kjdraw-connect.mjs'
$KJDrawInstalledLauncher = Join-Path $KJDrawInstall 'packages\kjdraw-sdk\bin\kjdraw-installed-mcp.mjs'
$KJDrawMcp = Join-Path $KJDrawInstall 'packages\kjdraw-sdk\bin\kjdraw-mcp.mjs'
$KJDrawHost = Join-Path $KJDrawUserHome '.kjdraw\host.kjd'

Assert-KJDrawSafeItem $KJDrawDataRoot 'KJDraw data directory'
if (-not (Test-Path -LiteralPath $KJDrawDataRoot)) { New-Item -ItemType Directory -Path $KJDrawDataRoot | Out-Null }
if (-not (Test-Path -LiteralPath $KJDrawDataRoot -PathType Container)) { throw 'KJDraw data root is not a directory.' }
Assert-KJDrawSafeItem $KJDrawStableBin 'KJDraw launcher directory'
if (-not (Test-Path -LiteralPath $KJDrawStableBin)) { New-Item -ItemType Directory -Path $KJDrawStableBin | Out-Null }
if (-not (Test-Path -LiteralPath $KJDrawStableBin -PathType Container)) { throw 'KJDraw launcher path is not a directory.' }
Assert-KJDrawSafeItem $KJDrawInstalledLauncher 'Packaged KJDraw launcher'
if (-not (Test-Path -LiteralPath $KJDrawInstalledLauncher -PathType Leaf)) { throw 'The pinned KJDraw source does not contain the installed launcher.' }

$KJDrawLauncherStage = "$KJDrawStableMcp.next-$PID"
$KJDrawCurrentStage = "$KJDrawCurrent.next-$PID"
if ((Test-Path -LiteralPath $KJDrawLauncherStage) -or (Test-Path -LiteralPath $KJDrawCurrentStage)) {
  throw 'A KJDraw upgrade staging file already exists; inspect it instead of overwriting it.'
}
try {
  [IO.File]::Copy($KJDrawInstalledLauncher, $KJDrawLauncherStage)
  $KJDrawCurrentBody = [ordered]@{
    schema = 'com.kanjie.kjdraw.install-current@1'
    sourceSha = $KJDrawSourceSha
    installDirectory = [IO.Path]::GetFullPath($KJDrawInstall)
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($KJDrawCurrentStage, ($KJDrawCurrentBody + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Install-KJDrawAtomicFile $KJDrawLauncherStage $KJDrawStableMcp
} catch {
  if (Test-Path -LiteralPath $KJDrawLauncherStage) { Remove-Item -LiteralPath $KJDrawLauncherStage -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $KJDrawCurrentStage) { Remove-Item -LiteralPath $KJDrawCurrentStage -Force -ErrorAction SilentlyContinue }
  throw
}
Write-Host "Installing KJDraw user configuration in: $KJDrawUserHome"
if ($KJDrawDifferentDesktopUser) {
  Write-Warning "This PowerShell is running as $KJDrawProcessUser, but the active Windows desktop belongs to $KJDrawDesktopUser. KJDraw only configures the current account. Run this one-line installer from a normal PowerShell opened by the same account that runs WorkBuddy, Kimi Code, or ZCode."
}
$KJDrawSchemaOutput = @(node $KJDrawMcp --check-tool-schemas)
if ($LASTEXITCODE -ne 0) { throw 'KJDraw MCP tool schemas failed compatibility validation; no client configuration was changed.' }
$KJDrawSchemaCheck = ($KJDrawSchemaOutput -join [Environment]::NewLine) | ConvertFrom-Json
if (-not $KJDrawSchemaCheck.ok -or $KJDrawSchemaCheck.profile -ne 'moonshot-walle-compatible-v1') {
  throw 'KJDraw MCP tool schemas are not compatible with the installed Kimi Code integration; no client configuration was changed.'
}
if (Test-Path -LiteralPath $KJDrawHost -PathType Leaf) {
  $KJDrawArgs = @('--all', '--apply', '--scope', 'user', '--workspace', $KJDrawUserHome, '--input', '.kjdraw/host.kjd', '--candidate-dir', '.kjdraw/results')
} else {
  $KJDrawArgs = @('--all', '--apply', '--scope', 'user', '--workspace', $KJDrawUserHome, '--blank', '.kjdraw/host.kjd', '--units', 'millimeter', '--candidate-dir', '.kjdraw/results')
}
# This is the official KJDraw installer, so an existing `kjdraw` entry is
# managed by KJDraw and may be replaced. The connector only replaces that
# named entry; unrelated MCP servers remain untouched. Unknown conflicts in
# other files still fail atomically inside kjdraw-connect.
$KJDrawArgs += @('--mcp-script', $KJDrawStableMcp)
$KJDrawArgs += '--replace-existing'
$KJDrawPreviousMcp = @($KJDrawPreviousMcpCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
foreach ($KJDrawPreviousPath in $KJDrawPreviousMcp) { $KJDrawArgs += @('--previous-mcp-script', $KJDrawPreviousPath) }
try {
  $KJDrawOutput = @(node $KJDrawConnect @KJDrawArgs)
  if ($LASTEXITCODE -ne 0) { throw 'KJDraw refused the user connection; no conflicting client entry was overwritten.' }
  Install-KJDrawAtomicFile $KJDrawCurrentStage $KJDrawCurrent
} catch {
  if (Test-Path -LiteralPath $KJDrawCurrentStage) { Remove-Item -LiteralPath $KJDrawCurrentStage -Force -ErrorAction SilentlyContinue }
  throw
}
$KJDrawResult = ($KJDrawOutput -join [Environment]::NewLine) | ConvertFrom-Json
$KJDrawTrae = @($KJDrawResult.clients | Where-Object { $_.client -eq 'TraeCode' })[0]
if ($KJDrawTrae.installUrl) {
  $KJDrawTraeFile = Join-Path $KJDrawUserHome '.kjdraw\trae-install-url.txt'
  Set-Content -LiteralPath $KJDrawTraeFile -Value $KJDrawTrae.installUrl -NoNewline
  if (-not $env:KJDRAW_NO_OPEN_TRAE -and (Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\trae-cn')) {
    Start-Process $KJDrawTrae.installUrl
  }
}

# Client tasks keep the stdio process they launched when the task started.
# Detect only exact earlier KJDraw MCP script paths; never terminate the client
# or unrelated Node processes from an installer.
$KJDrawStaleProcesses = @()
try {
  $KJDrawPreviousCanonical = @($KJDrawStableMcp) + @($KJDrawPreviousMcp | ForEach-Object { [IO.Path]::GetFullPath($_) })
  if ($KJDrawPreviousCanonical.Count) {
    $KJDrawStaleProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop | Where-Object {
      $KJDrawCommandLine = $_.CommandLine
      $KJDrawCommandLine -and @($KJDrawPreviousCanonical | Where-Object { $KJDrawCommandLine.Contains($_, [StringComparison]::OrdinalIgnoreCase) }).Count
    })
  }
} catch {
  $KJDrawStaleProcesses = @()
}

Write-Host ''
Write-Host ('KJDraw is installed and current at source ' + $KJDrawSourceSha.Substring(0, 7) + '.') -ForegroundColor Green
Write-Host 'Run this same one-line installer again for future in-place upgrades; uninstall is not required.'
if ($KJDrawStaleProcesses.Count) {
  $KJDrawStaleIds = ($KJDrawStaleProcesses | ForEach-Object { $_.ProcessId }) -join ', '
  Write-Warning "An earlier KJDraw MCP process is still attached to an open client task (PID: $KJDrawStaleIds). Fully exit WorkBuddy/Kimi Code, reopen it, and start a new task. Existing candidate HTML files are immutable and will keep their old appearance."
}
if ($KJDrawDifferentDesktopUser) {
  Write-Warning 'The desktop client for the other Windows account was not configured by this run.'
}
Write-Host 'Restart Kimi Code, WorkBuddy, or ZCode and verify the kjdraw tool call in any workspace. TraeCode uses its official import confirmation.'
Write-Host 'Ask:'
Write-Host 'Use KJDraw to draw a circle with a 5 mm radius.'
