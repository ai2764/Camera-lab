[CmdletBinding()]
param(
    [switch]$SkipNode,
    [switch]$InstallPlaywrightBrowser,
    [switch]$SkipWorkflowInstall,
    [switch]$IncludeExperimentalWorkflows
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$envPath = Join-Path $repoRoot ".env"
$exampleEnvPath = Join-Path $repoRoot ".env.example"

function Load-CameraLabEnv {
    param([string]$Path)
    if (!(Test-Path $Path)) {
        return
    }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) {
            return
        }
        $name, $value = $line.Split("=", 2)
        $name = $name.Trim()
        $value = $value.Trim().Trim('"').Trim("'")
        if ($name -and !(Get-Item "Env:$name" -ErrorAction SilentlyContinue)) {
            Set-Item "Env:$name" $value
        }
    }
}

Set-Location $repoRoot

if (!(Test-Path $envPath)) {
    if (!(Test-Path $exampleEnvPath)) {
        throw ".env.example is missing."
    }
    Copy-Item -LiteralPath $exampleEnvPath -Destination $envPath
    Write-Host "Created .env from .env.example. Edit COMFYUI_ROOT before running setup checks."
}

Write-Host "Installing Python dependencies..."
python -m pip install -r requirements.txt

if (!$SkipNode -and (Test-Path (Join-Path $repoRoot "package.json"))) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) {
        Write-Host "Installing Node dependencies..."
        npm install
        if ($InstallPlaywrightBrowser) {
            Write-Host "Installing Playwright Chromium..."
            npx playwright install chromium
        }
    } else {
        Write-Warning "npm was not found. Skipping Node dependencies and browser smoke-test setup."
    }
}

Load-CameraLabEnv $envPath

$hasComfyRoot = $env:COMFYUI_ROOT -and $env:COMFYUI_ROOT -ne "<path-to-your-ComfyUI>" -and (Test-Path $env:COMFYUI_ROOT)
if (!$SkipWorkflowInstall -and $hasComfyRoot) {
    $workflowArgs = @()
    if ($IncludeExperimentalWorkflows) {
        $workflowArgs += "-IncludeExperimental"
    }
    & (Join-Path $scriptDir "install_workflows.ps1") @workflowArgs
} elseif (!$SkipWorkflowInstall) {
    Write-Warning "COMFYUI_ROOT is not configured or does not exist. Skipping workflow install."
}

Write-Host ""
Write-Host "Agent setup finished."
Write-Host "Next: edit .env if needed, start ComfyUI, then run .\scripts\check_setup.ps1."
