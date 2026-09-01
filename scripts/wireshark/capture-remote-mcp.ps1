[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Interface,
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Endpoint,
  [switch]$HostClient,
  [switch]$FinalHostClient
)

$ErrorActionPreference = "Stop"

try {
  $uri = [Uri]$Endpoint
  if ($uri.Scheme -ne "https" -or $uri.AbsolutePath -ne "/mcp" -or $uri.Query -or $uri.Fragment) { throw "invalid" }
  if ([string]::IsNullOrWhiteSpace($Interface)) { throw "invalid" }
  if ($HostClient -and $FinalHostClient) { throw "FINAL_MODE_CONFLICT" }
} catch {
  $code = if ($_.Exception.Message -eq "FINAL_MODE_CONFLICT") { "FINAL_MODE_CONFLICT" } else { "INVALID_ARGUMENTS" }
  Write-Error "Remote MCP capture failed: $code."
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
$usesHostClient = $HostClient -or $FinalHostClient
$prefix = if ($FinalHostClient) { "host-remote-final" } elseif ($HostClient) { "host-remote-preliminary" } else { "remote-mcp" }
$capture = Join-Path $localDirectory "$prefix-$timestamp.pcapng"
$keyLog = Join-Path $localDirectory "$prefix-$timestamp.keys.log"
$stdoutLog = Join-Path $localDirectory "$prefix-$timestamp.tshark.stdout.log"
$stderrLog = Join-Path $localDirectory "$prefix-$timestamp.tshark.stderr.log"
$summary = Join-Path $localDirectory "$prefix-$timestamp.host-summary.json"
$probeRelativePath = if ($usesHostClient) { "scripts\wireshark\host-remote-mcp-probe.ts" } else { "scripts\wireshark\remote-mcp-probe.ts" }
$probe = Join-Path $root $probeRelativePath
$captureProcess = $null

try {
  $addresses = [System.Net.Dns]::GetHostAddresses($uri.Host) |
    Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -or $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6 } |
    ForEach-Object { $_.IPAddressToString } |
    Select-Object -Unique
  if (-not $addresses) { throw "unresolved" }
  $captureFilter = "tcp port 443 and (" + (($addresses | ForEach-Object { "host $_" }) -join " or ") + ")"
} catch {
  Write-Error "Remote MCP capture failed: ENDPOINT_UNRESOLVED."
  exit 1
}

try {
  $durationSeconds = if ($usesHostClient) { 75 } else { 8 }
  $tsharkArguments = "-q -i `"$Interface`" -f `"$captureFilter`" -a duration:$durationSeconds -w `"$capture`""
  $captureProcess = Start-Process -FilePath $tshark -ArgumentList $tsharkArguments -PassThru -NoNewWindow -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  Start-Sleep -Seconds 1
  $nodeArguments = @("--no-warnings", "--tls-keylog=$keyLog", "--import", "tsx", $probe, $Endpoint)
  if ($usesHostClient) { $nodeArguments += $summary }
  & $node @nodeArguments
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

if (-not (Test-Path $capture) -or (Get-Item $capture).Length -eq 0 -or -not (Test-Path $keyLog) -or (Get-Item $keyLog).Length -eq 0 -or ($usesHostClient -and (-not (Test-Path $summary) -or (Get-Item $summary).Length -eq 0))) {
  Write-Error "Remote MCP capture failed: ARTIFACTS_MISSING."
  exit 1
}

function Get-FileSha256([string]$path) {
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

$hash = Get-FileSha256 $capture
$summaryHash = if ($usesHostClient) { Get-FileSha256 $summary } else { $null }
Write-Output "Remote MCP capture completed."
Write-Output "Capture: $capture"
Write-Output "TLS key log: $keyLog"
if ($usesHostClient) {
  Write-Output "Host summary: $summary"
  Write-Output "Host summary SHA-256: $summaryHash"
}
Write-Output "Capture SHA-256: $hash"
