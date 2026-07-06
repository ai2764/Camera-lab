[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Warning "install_camera_lab.ps1 was renamed to setup_windows_python.ps1; forwarding to the new bootstrap."
& (Join-Path $scriptDir "setup_windows_python.ps1") @RemainingArgs
exit $LASTEXITCODE
