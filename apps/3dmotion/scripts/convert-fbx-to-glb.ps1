param(
  [Parameter(Mandatory = $true)]
  [string]$InputFbx,

  [Parameter(Mandatory = $false)]
  [string]$OutputGlb,

  [Parameter(Mandatory = $false)]
  [double]$Scale = 1.0
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Blender = Join-Path $ProjectRoot "tools\blender-5.1.2-windows-x64\blender.exe"
$Converter = Join-Path $ProjectRoot "tools\convert_fbx_to_glb.py"

if (-not (Test-Path -LiteralPath $Blender)) {
  throw "Blender not found at $Blender"
}

if (-not (Test-Path -LiteralPath $InputFbx)) {
  throw "Input FBX not found: $InputFbx"
}

if (-not $OutputGlb) {
  $source = Get-Item -LiteralPath $InputFbx
  $OutputGlb = Join-Path $source.DirectoryName ($source.BaseName + ".glb")
}

& $Blender --background --python $Converter -- --input $InputFbx --output $OutputGlb --scale $Scale

if ($LASTEXITCODE -ne 0) {
  throw "Blender conversion failed with exit code $LASTEXITCODE"
}

Write-Host "Wrote $OutputGlb"
