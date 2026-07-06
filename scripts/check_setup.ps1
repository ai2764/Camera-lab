[CmdletBinding()]
param(
    [string]$Modules
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$pythonArgs = @("scripts/check_setup.py")
if ($Modules) { $pythonArgs += @("--modules", $Modules) }

python @pythonArgs
exit $LASTEXITCODE
