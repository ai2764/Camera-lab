param(
    [string]$Python = "python",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$specPath = Join-Path $repoRoot "packaging/camera-lab.spec"
$distRoot = Join-Path $repoRoot "dist"
$appRoot = Join-Path $distRoot "CameraLab"

Push-Location $repoRoot
try {
    & $Python -m PyInstaller --version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller is not installed. Run: $Python -m pip install pyinstaller"
    }

    & $Python -m PyInstaller --noconfirm $specPath
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller build failed."
    }

    foreach ($name in @("frontend", "workflows")) {
        $source = Join-Path $repoRoot $name
        $target = Join-Path $appRoot $name
        if (Test-Path $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
        Copy-Item -LiteralPath $source -Destination $target -Recurse
    }

    foreach ($file in @(".env.example", "README.md")) {
        $source = Join-Path $repoRoot $file
        if (Test-Path $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $appRoot $file) -Force
        }
    }

    $startBat = Join-Path $appRoot "Start Camera Lab.bat"
    Set-Content -LiteralPath $startBat -Encoding ASCII -Value @(
        "@echo off",
        "cd /d %~dp0",
        "CameraLab.exe --open %*"
    )

    $zipPath = Join-Path $distRoot "CameraLab-portable.zip"
    if (Test-Path $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path $appRoot -DestinationPath $zipPath -Force

    Write-Host "Portable app: $appRoot"
    Write-Host "Portable zip: $zipPath"
}
finally {
    Pop-Location
}
