[CmdletBinding()]
param()

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

function Add-Check {
    param(
        [string]$Name,
        [bool]$Ok,
        [string]$Detail
    )
    $status = if ($Ok) { "OK" } else { "MISSING" }
    Write-Host "[$status] $Name - $Detail"
    return $Ok
}

Load-CameraLabEnv $envPath

$checks = @()
$comfyRoot = if ($env:COMFYUI_ROOT) { $env:COMFYUI_ROOT } else { "ComfyUI" }
$comfyUrl = if ($env:COMFYUI_URL) { $env:COMFYUI_URL } else { "http://127.0.0.1:8000" }

$checks += Add-Check ".env" (Test-Path $envPath) "copy .env.example to .env and edit COMFYUI_ROOT if this is missing"
$checks += Add-Check ".env.example" (Test-Path $exampleEnvPath) $exampleEnvPath

try {
    $pythonVersion = & python --version 2>&1
    $checks += Add-Check "Python" $true ($pythonVersion -join " ")
} catch {
    $checks += Add-Check "Python" $false "install Python 3 and make sure python is on PATH"
}

try {
    & python -c "import PIL" 2>$null
    $checks += Add-Check "Pillow" $true "installed"
} catch {
    $checks += Add-Check "Pillow" $false "run: python -m pip install -r requirements.txt"
}

$checks += Add-Check "ComfyUI root" (Test-Path $comfyRoot) $comfyRoot
$checks += Add-Check "ComfyUI input" (Test-Path (Join-Path $comfyRoot "input")) (Join-Path $comfyRoot "input")
$checks += Add-Check "ComfyUI output" (Test-Path (Join-Path $comfyRoot "output")) (Join-Path $comfyRoot "output")
$checks += Add-Check "ComfyUI models" (Test-Path (Join-Path $comfyRoot "models")) (Join-Path $comfyRoot "models")
$checks += Add-Check "ComfyUI workflows" (Test-Path (Join-Path $comfyRoot "user\default\workflows")) (Join-Path $comfyRoot "user\default\workflows")

try {
    $stats = Invoke-RestMethod "$comfyUrl/system_stats" -TimeoutSec 5
    $checks += Add-Check "ComfyUI server" ($null -ne $stats) $comfyUrl
} catch {
    $checks += Add-Check "ComfyUI server" $false "start ComfyUI, then check $comfyUrl"
}

$modelRoot = Join-Path $comfyRoot "models"
$requiredModels = @(
    "checkpoints\ltx-2.3-22b-dev-fp8.safetensors",
    "text_encoders\gemma_3_12B_it_fp4_mixed.safetensors",
    "loras\ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
    "latent_upscale_models\ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
)

foreach ($model in $requiredModels) {
    $checks += Add-Check "Model $model" (Test-Path (Join-Path $modelRoot $model)) (Join-Path $modelRoot $model)
}

$ttpPath = Join-Path $comfyRoot "custom_nodes\Comfyui_TTP_Toolset\LTXVFirstLastFrameControl_TTP.py"
$checks += Add-Check "TTP custom node" (Test-Path $ttpPath) $ttpPath

$appWorkflowRoot = Join-Path $repoRoot "workflows\app"
$installedAppWorkflowRoot = Join-Path $comfyRoot "user\default\workflows\camera-lab\app"
$repoWorkflows = @(
    "LTX-2.3_FML2V_RuneXX_guider.local.json"
)

foreach ($workflow in $repoWorkflows) {
    $checks += Add-Check "Repo workflow $workflow" (Test-Path (Join-Path $appWorkflowRoot $workflow)) (Join-Path $appWorkflowRoot $workflow)
    $checks += Add-Check "Installed ComfyUI workflow $workflow" (Test-Path (Join-Path $installedAppWorkflowRoot $workflow)) (Join-Path $installedAppWorkflowRoot $workflow)
}

$failed = @($checks | Where-Object { $_ -eq $false }).Count
if ($failed -gt 0) {
    Write-Host ""
    Write-Host "$failed setup check(s) need attention."
    exit 1
}

Write-Host ""
Write-Host "All setup checks passed."
