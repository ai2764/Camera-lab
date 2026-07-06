[CmdletBinding()]
param(
    [switch]$IncludeExperimental,
    [string]$Modules
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$pythonArgs = @("scripts/install_workflows.py")
if ($IncludeExperimental) { $pythonArgs += "--include-experimental" }
if ($Modules) { $pythonArgs += @("--modules", $Modules) }

python @pythonArgs
exit $LASTEXITCODE
