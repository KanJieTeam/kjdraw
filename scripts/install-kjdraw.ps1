param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$Blank,
  [Parameter(Mandatory = $true)][string]$CandidateSha,
  [Parameter(Mandatory = $true)][string]$Integrity,
  [ValidateSet('millimeter', 'meter')][string]$Units = 'millimeter',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try {
  $nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop
  $installer = Join-Path $PSScriptRoot 'install-kjdraw.mjs'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Local KJDraw installer core is missing' }
  $arguments = @($installer, '--project', $Project, '--blank', $Blank, '--candidate-sha', $CandidateSha, '--integrity', $Integrity, '--units', $Units)
  if ($DryRun) { $arguments += '--dry-run' }
  & $nodeCommand.Source @arguments
  exit $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine('KJDraw installer: trusted local Node.js and installer files are required')
  exit 1
}
