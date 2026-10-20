[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$OutputDirectory = 'artifacts/network-windows',
    [ValidateRange(10, 1000)][int]$SampleIntervalMilliseconds = 50,
    [ValidateRange(1000, 20000)][int]$WatchMilliseconds = 4000
)

# S-02: every security fixture and the hyperlinks fixture through the real
# LeanDoc on WebView2, with the TCP connections and UDP endpoints of the whole
# process tree sampled every 50 ms from launch until the window is closed (in
# the style of LeanRows' Observe-LeanRowsNetwork.ps1). Pass: LeanDoc's own
# process has no TCP connection and no UDP endpoint at any sample. Endpoints
# of the WebView2 runtime processes are recorded and attributed by process
# name; a remote address other than loopback fails the run too. Polling can
# miss a connection shorter than one interval; the largest gap between
# sample starts is recorded. Writes network-windows.json and .md.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'S-02 runs on Windows.' }
$testsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $testsRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force

if ([string]::IsNullOrWhiteSpace($ExePath)) { $ExePath = Join-Path $repoRoot 'dist\LeanDoc.exe' }
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
$out = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
New-Item -ItemType Directory -Path $out -Force | Out-Null
# A LeanDoc of the same path left running by an earlier step would take every
# launch as a later one (single instance). Close it first.
foreach ($left in @(Get-LeanDocProcessesByPath -ExePath $ExePath)) {
    Write-Warning ('Stopping LeanDoc process {0} left by an earlier step.' -f $left.Id)
    Stop-LeanDocTestProcessTree -RootProcess $left
}
$fixtures = @(Get-ChildItem -LiteralPath (Join-Path $testsRoot 'fixtures\security') -Filter *.docx | Sort-Object Name)

function Test-Loopback([string]$Address) {
    return $Address -in @('127.0.0.1', '::1', '0.0.0.0', '::') -or $Address.StartsWith('127.')
}

$rows = @()
$problems = @()
foreach ($fixture in $fixtures) {
    [void](Wait-WebView2Idle -TimeoutSeconds 30)
    $process = Start-LeanDocProcess -ExePath $ExePath -DocumentPaths @($fixture.FullName)
    $seen = @{}
    $samples = 0
    $largestGap = 0
    $lastStart = $null
    $processNames = @{}
    try {
        $deadline = [DateTime]::UtcNow.AddMilliseconds($WatchMilliseconds)
        while ([DateTime]::UtcNow -lt $deadline) {
            $now = [DateTime]::UtcNow
            if ($null -ne $lastStart) {
                $largestGap = [Math]::Max($largestGap, [int]($now - $lastStart).TotalMilliseconds)
            }
            $lastStart = $now
            $ids = @(Get-LeanDocProcessTreeIds -RootProcessId $process.Id)
            foreach ($id in $ids) {
                if (-not $processNames.ContainsKey($id)) {
                    $live = Get-Process -Id $id -ErrorAction SilentlyContinue
                    if ($null -ne $live) { $processNames[$id] = $live.ProcessName }
                }
            }
            $tcp = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess })
            $udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess })
            foreach ($entry in $tcp) {
                $key = 'TCP {0} {1}:{2} -> {3}:{4} {5}' -f $entry.OwningProcess, $entry.LocalAddress, $entry.LocalPort,
                    $entry.RemoteAddress, $entry.RemotePort, $entry.State
                $seen[$key] = [pscustomobject]@{ Protocol = 'TCP'; ProcessId = [int]$entry.OwningProcess
                    Remote = [string]$entry.RemoteAddress; Detail = $key }
            }
            foreach ($entry in $udp) {
                $key = 'UDP {0} {1}:{2}' -f $entry.OwningProcess, $entry.LocalAddress, $entry.LocalPort
                $seen[$key] = [pscustomobject]@{ Protocol = 'UDP'; ProcessId = [int]$entry.OwningProcess
                    Remote = ''; Detail = $key }
            }
            $samples += 1
            Start-Sleep -Milliseconds $SampleIntervalMilliseconds
        }
    } finally {
        Stop-LeanDocTestProcessTree -RootProcess $process
    }
    $own = @($seen.Values | Where-Object { $_.ProcessId -eq $process.Id })
    $remote = @($seen.Values | Where-Object { $_.Protocol -eq 'TCP' -and -not (Test-Loopback $_.Remote) })
    $attributed = @($seen.Values | ForEach-Object {
        $name = if ($processNames.ContainsKey($_.ProcessId)) { $processNames[$_.ProcessId] } else { 'exited' }
        '{0} ({1})' -f $_.Detail, $name
    })
    if ($own.Count -gt 0) { $problems += ('{0}: LeanDoc.exe itself had {1}' -f $fixture.Name, (($own | ForEach-Object Detail) -join '; ')) }
    if ($remote.Count -gt 0) { $problems += ('{0}: a remote connection {1}' -f $fixture.Name, (($remote | ForEach-Object Detail) -join '; ')) }
    $rows += [pscustomobject]@{
        fixture = $fixture.Name
        samples = $samples
        largestGapMs = $largestGap
        processes = $processNames.Count
        endpoints = $attributed
    }
    Write-Host ('{0}: {1} samples, largest gap {2} ms, {3} processes, {4} endpoints' -f $fixture.Name, $samples,
        $largestGap, $processNames.Count, $attributed.Count)
}

$result = [pscustomobject]@{
    measure = 'S-02'
    executable = $ExePath
    sampleIntervalMs = $SampleIntervalMilliseconds
    watchMs = $WatchMilliseconds
    pass = $problems.Count -eq 0
    problems = $problems
    rows = $rows
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'network-windows.json') -Encoding utf8
$lines = @('| Fixture | Samples | Largest gap (ms) | Processes | Endpoints (process) |', '| --- | ---: | ---: | ---: | --- |')
foreach ($row in $rows) {
    $endpoints = if ($row.endpoints.Count) { ($row.endpoints -join '; ') } else { 'none' }
    $lines += ('| {0} | {1} | {2} | {3} | {4} |' -f $row.fixture, $row.samples, $row.largestGapMs, $row.processes, $endpoints)
}
$lines += ''
$lines += $(if ($problems.Count) { 'Problems: ' + ($problems -join ' / ') } else { 'S-02 passed: LeanDoc.exe had no TCP connection or UDP endpoint, and no process reached a remote address.' })
Set-Content -LiteralPath (Join-Path $out 'network-windows.md') -Value ($lines -join "`n") -Encoding utf8
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ($lines -join "`n") }
if ($problems.Count) { throw ('S-02 failed: ' + ($problems -join ' / ')) }
Write-Output 'S-02 passed.'
