[CmdletBinding()]
param(
    [Alias("p")]
    [int]$Port = 1234,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) {
    Write-Host "Camera Lab is not listening on http://127.0.0.1:$Port"
    exit 0
}

$owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
$matched = 0
$stopped = 0
$blocked = @()

foreach ($ownerPid in $owners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
    $commandLine = if ($process) { [string]$process.CommandLine } else { "" }
    $name = if ($process) { [string]$process.Name } else { "unknown" }

    $isCameraLab = $commandLine -match "camera_lab_server\.py"
    if (!$isCameraLab) {
        $blocked += "PID $ownerPid ($name): $commandLine"
        continue
    }

    $matched += 1
    if ($DryRun) {
        Write-Host "Would stop Camera Lab PID $ownerPid ($name)"
        continue
    }

    Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    Write-Host "Stopped Camera Lab PID $ownerPid"
    $stopped += 1
}

if ($blocked.Count -gt 0) {
    Write-Host "Refused to stop non-Camera Lab listener(s) on port ${Port}:"
    foreach ($item in $blocked) {
        Write-Host "  $item"
    }
    Write-Host "ComfyUI is not touched by this script."
}

if ($matched -eq 0 -and $blocked.Count -eq 0) {
    Write-Host "No Camera Lab process found on port $Port"
}
