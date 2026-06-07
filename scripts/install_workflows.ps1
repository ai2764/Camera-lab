[CmdletBinding()]
param(
    [switch]$IncludeExperimental
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$envPath = Join-Path $repoRoot ".env"

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

Load-CameraLabEnv $envPath

if (!$env:COMFYUI_ROOT) {
    throw "COMFYUI_ROOT is not set. Copy .env.example to .env and set COMFYUI_ROOT first."
}

$comfyRoot = $env:COMFYUI_ROOT
$targetRoot = Join-Path $comfyRoot "user\default\workflows\camera-lab"

if (!(Test-Path $comfyRoot)) {
    throw "COMFYUI_ROOT does not exist: $comfyRoot"
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

$sources = @(
    @{ Name = "app"; Path = Join-Path $repoRoot "workflows\app" }
)

if ($IncludeExperimental) {
    $sources += @{ Name = "experimental"; Path = Join-Path $repoRoot "workflows\experimental" }
}

$copied = 0
foreach ($source in $sources) {
    if (!(Test-Path $source.Path)) {
        continue
    }
    $target = Join-Path $targetRoot $source.Name
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Get-ChildItem -Path $source.Path -Filter "*.json" -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Force
        $copied += 1
        Write-Host "Installed $($source.Name)\$($_.Name)"
    }
}

Write-Host ""
Write-Host "Installed $copied workflow file(s) to:"
Write-Host $targetRoot
Write-Host ""
Write-Host "Restart or refresh ComfyUI if the workflow browser does not show the new files."
