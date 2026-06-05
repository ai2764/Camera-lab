param(
    [Alias("p")]
    [int]$Port = 1234,
    [switch]$Restart,
    [switch]$Open
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$envPath = Join-Path $repoRoot ".env"
$serverPath = Join-Path $repoRoot "tools\camera_lab_server.py"
$logDir = Join-Path $repoRoot "tasks"
$stdoutLog = Join-Path $logDir "camera_lab_server.log"
$stderrLog = Join-Path $logDir "camera_lab_server.log.err"
$url = "http://127.0.0.1:$Port"

if (!(Test-Path $serverPath)) {
    throw "Server not found: $serverPath"
}

if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
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

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if (!$Restart) {
        Write-Host "Camera Lab already appears to be running on $url"
        Write-Host "PID(s): $($owners -join ', ')"
        Write-Host "Use -Restart to stop the current listener and start a fresh server."
        if ($Open) {
            Start-Process $url
        }
        exit 0
    }

    foreach ($owner in $owners) {
        Write-Host "Stopping existing listener on port $Port, PID $owner"
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

Write-Host "Starting Camera Lab..."
$proc = Start-Process `
    -FilePath "python" `
    -ArgumentList @($serverPath, "--port", $Port) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

Start-Sleep -Seconds 2

if ($proc.HasExited) {
    Write-Host "Camera Lab failed to start. stderr:"
    if (Test-Path $stderrLog) {
        Get-Content $stderrLog -Tail 80
    }
    exit 1
}

try {
    $config = Invoke-RestMethod "$url/api/config" -TimeoutSec 5
    $comfy = if ($config.comfy.ok) { "online" } else { "offline" }
    Write-Host "Camera Lab: $url"
    Write-Host "PID: $($proc.Id)"
    Write-Host "ComfyUI: $comfy ($($config.comfy.url))"
    Write-Host "Logs:"
    Write-Host "  $stdoutLog"
    Write-Host "  $stderrLog"
} catch {
    Write-Host "Camera Lab process started, but health check failed:"
    Write-Host $_.Exception.Message
    Write-Host "Logs:"
    Write-Host "  $stdoutLog"
    Write-Host "  $stderrLog"
    exit 1
}

if ($Open) {
    Start-Process $url
}
