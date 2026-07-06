[CmdletBinding()]
param(
    [switch]$All,
    [switch]$ListModules,
    [switch]$ListProfiles,
    [string]$Modules,
    [switch]$SkipNode,
    [switch]$InstallPlaywrightBrowser,
    [switch]$SkipWorkflowInstall,
    [switch]$SkipModelDownload,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Test-CameraLabPython {
    param(
        [string]$Command,
        [string[]]$PrefixArgs = @()
    )
    try {
        & $Command @PrefixArgs -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Resolve-CameraLabPython {
    if ((Get-Command python -ErrorAction SilentlyContinue) -and (Test-CameraLabPython -Command "python")) {
        return @("python")
    }
    if ((Get-Command py -ErrorAction SilentlyContinue) -and (Test-CameraLabPython -Command "py" -PrefixArgs @("-3"))) {
        return @("py", "-3")
    }
    return $null
}

$python = @(Resolve-CameraLabPython)
if (!$python) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (!$winget) {
        throw "Python 3.10+ is not installed, and winget is not available. Install Python from https://www.python.org/downloads/ and run this script again."
    }

    Write-Host "Python 3.10+ was not found. Installing Python 3.12 with winget..."
    winget install --id Python.Python.3.12 -e --source winget
    if ($LASTEXITCODE -ne 0) {
        throw "winget failed to install Python. Install Python manually, then run this script again."
    }

    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
    $python = @(Resolve-CameraLabPython)
    if (!$python) {
        throw "Python was installed, but it is not available on PATH yet. Open a new terminal and run this script again."
    }
}

$installerArgs = @("scripts/install_camera_lab.py")
if ($ListModules) {
    $installerArgs += "--list-modules"
} else {
    if ($ListProfiles) {
        $installerArgs += "--list-profiles"
    }
    if ($Modules) {
        $installerArgs += @("--modules", $Modules)
    } elseif ($All) {
        $installerArgs += "--all"
    } elseif (!$ListProfiles) {
        $installerArgs += "--all"
    }
}
if ($SkipNode) { $installerArgs += "--skip-node" }
if ($InstallPlaywrightBrowser) { $installerArgs += "--install-playwright-browser" }
if ($SkipWorkflowInstall) { $installerArgs += "--skip-workflow-install" }
if ($SkipModelDownload) { $installerArgs += "--skip-model-download" }
if ($Yes) { $installerArgs += "--yes" }

$pythonCommand = $python[0]
$pythonPrefixArgs = @()
if ($python.Count -gt 1) {
    $pythonPrefixArgs = $python[1..($python.Count - 1)]
}

& $pythonCommand @pythonPrefixArgs @installerArgs
exit $LASTEXITCODE
