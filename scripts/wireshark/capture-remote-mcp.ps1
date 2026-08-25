[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Interface,
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Endpoint
)

$ErrorActionPreference = "Stop"

try {
  $uri = [Uri]$Endpoint
  if ($uri.Scheme -ne "https" -or $uri.AbsolutePath -ne "/mcp" -or $uri.Query -or $uri.Fragment) { throw "invalid" }
  if ([string]::IsNullOrWhiteSpace($Interface)) { throw "invalid" }
} catch {
  Write-Error "Remote MCP capture failed: INVALID_ARGUMENTS."
  exit 1
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$tsharkCommand = Get-Command tshark -ErrorAction SilentlyContinue
$tshark = if ($tsharkCommand) { $tsharkCommand.Source } else { "C:\Program Files\Wireshark\tshark.exe" }
if (-not (Test-Path $tshark)) {
  Write-Error "Remote MCP capture failed: TSHARK_UNAVAILABLE."
  exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Error "Remote MCP capture failed: NODE_UNAVAILABLE."
  exit 1
}

$localDirectory = Join-Path $root "docs\wireshark\local"
New-Item -ItemType Directory -Force -Path $localDirectory | Out-Null
$timestamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$capture = Join-Path $localDirectory "remote-mcp-$timestamp.pcapng"
$keyLog = Join-Path $localDirectory "remote-mcp-$timestamp.keys.log"
$stdoutLog = Join-Path $localDirectory "remote-mcp-$timestamp.tshark.stdout.log"
$stderrLog = Join-Path $localDirectory "remote-mcp-$timestamp.tshark.stderr.log"
$probe = Join-Path $root "scripts\wireshark\remote-mcp-probe.ts"
$captureProcess = $null

try {
  $tsharkArguments = "-q -i `"$Interface`" -f `"tcp port 443`" -a duration:8 -w `"$capture`""
  $captureProcess = Start-Process -FilePath $tshark -ArgumentList $tsharkArguments -PassThru -NoNewWindow -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  Start-Sleep -Seconds 1
  & $node "--no-warnings" "--tls-keylog=$keyLog" "--import" "tsx" $probe $Endpoint
  if ($LASTEXITCODE -ne 0) { throw "probe failed" }
} catch {
  Write-Error "Remote MCP capture failed: PROBE_OR_CAPTURE_FAILED."
  exit 1
} finally {
  if ($captureProcess -and -not $captureProcess.HasExited) {
    $captureProcess.WaitForExit(12000) | Out-Null
  }
  if ($captureProcess -and -not $captureProcess.HasExited) {
    Stop-Process -Id $captureProcess.Id -Force
    $captureProcess.WaitForExit()
  }
}

if (-not (Test-Path $capture) -or (Get-Item $capture).Length -eq 0 -or -not (Test-Path $keyLog) -or (Get-Item $keyLog).Length -eq 0) {
  Write-Error "Remote MCP capture failed: ARTIFACTS_MISSING."
  exit 1
}

$stream = [System.IO.File]::OpenRead($capture)
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
} finally {
  $stream.Dispose()
}
Write-Output "Remote MCP capture completed."
Write-Output "Capture: $capture"
Write-Output "TLS key log: $keyLog"
Write-Output "Capture SHA-256: $hash"
