[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$InspectPath,
    [string]$LeanMarkExePath,
    [ValidateRange(1, 50)][int]$Runs = 10,
    [string]$OutputDirectory = 'artifacts/perf-windows',
    [switch]$NoFail
)

# The Windows twin of tests/perf/run_perf.py, for the perf-memory CI job: the
# launch scenarios P-01 to P-06 and M-01 to M-05 with the same JSON shape
# (perf-windows.json) and a Markdown table (perf-windows.md). The scenarios
# that need an interactive script hook (P-07 to P-11, M-06 to M-09) run on the
# Linux host only.
#
# Method, as in LeanMark's Measure-Performance.ps1 and tests/owner: every
# launch waits until no WebView2 process still uses LeanDoc's profile folder,
# reads --trace-timing, waits for a complete tree (LeanDoc.exe plus at least
# a browser and a renderer), and samples the private bytes of the whole tree
# every 500 ms until three samples agree within 1.5 MiB (at least 3 s, at
# most 12 s). Each figure is the median of -Runs launches. With
# -LeanMarkExePath, LeanMark measured the same way gives the family
# comparison. Runner figures are test-gate figures, never product claims.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $testsRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force

if ([string]::IsNullOrWhiteSpace($ExePath)) { $ExePath = Join-Path $repoRoot 'dist\LeanDoc.exe' }
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
if ([string]::IsNullOrWhiteSpace($InspectPath)) { $InspectPath = Join-Path (Split-Path -Parent $ExePath) 'tools\leandoc-inspect.exe' }
$out = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
New-Item -ItemType Directory -Path $out -Force | Out-Null
$docs = Join-Path $out 'documents'
& python (Join-Path $PSScriptRoot 'make_report.py') $docs | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'make_report.py failed.' }
$report3 = Join-Path $docs 'report-3.docx'
$second = Join-Path $docs 'report-3-b.docx'
Copy-Item -LiteralPath $report3 -Destination $second -Force
$five = @(1..5 | ForEach-Object {
    $copy = Join-Path $docs ('tab-{0:D2}.docx' -f $_)
    Copy-Item -LiteralPath $report3 -Destination $copy -Force
    $copy
})

function Get-Median([double[]]$values) {
    $clean = @($values | Where-Object { -not [double]::IsNaN($_) })
    if ($clean.Count -eq 0) { return $null }
    [Math]::Round((Get-LeanDocMedian $clean), 1)
}

function Wait-Settled([int]$RootId, [int]$MinimumProcesses = 3) {
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $samples = [System.Collections.Generic.List[object]]::new()
    while ($true) {
        $sample = Get-LeanDocProcessSample -RootProcessId $RootId
        $samples.Add($sample)
        $recent = @($samples | Select-Object -Last 3)
        if ($clock.Elapsed.TotalSeconds -ge 3 -and $recent.Count -eq 3) {
            $values = @($recent | ForEach-Object { $_.PrivateBytes / 1MB })
            if ((($values | Measure-Object -Maximum).Maximum - ($values | Measure-Object -Minimum).Minimum) -le 1.5) { break }
        }
        if ($clock.Elapsed.TotalSeconds -ge 12) { break }
        Start-Sleep -Milliseconds 500
    }
    [pscustomobject]@{
        PrivateMiB = [Math]::Round($sample.PrivateBytes / 1MB, 2)
        WorkingSetMiB = [Math]::Round($sample.WorkingSetBytes / 1MB, 2)
        Processes = $sample.ProcessCount
        Complete = $sample.ProcessCount -ge $MinimumProcesses
        SettledAfterS = [Math]::Round($clock.Elapsed.TotalSeconds, 1)
    }
}

# One LeanDoc launch with --trace-timing. Returns the events, the settled
# memory, and the process so a caller can keep using the window.
function Start-Traced([string[]]$Documents) {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $ExePath
    $arguments = @('--trace-timing')
    if ($Documents.Count -gt 0) { $arguments += '--'; $arguments += @($Documents | ForEach-Object { '"{0}"' -f $_ }) }
    $info.Arguments = $arguments -join ' '
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.WorkingDirectory = Split-Path -Parent $ExePath
    $process = [System.Diagnostics.Process]::Start($info)
    $state = [pscustomobject]@{ Process = $process; Events = [ordered]@{}; Lines = [System.Collections.Generic.List[object]]::new(); Pending = $null }
    $state.Pending = $process.StandardOutput.ReadLineAsync()
    $state
}

function Read-Events($state, [string]$Event, [int]$Count = 1, [int]$TimeoutSeconds = 60) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (@($state.Lines | Where-Object { $_.Event -eq $Event }).Count -lt $Count) {
        if ([DateTime]::UtcNow -gt $deadline) { throw "no $Event event #$Count within $TimeoutSeconds s" }
        if (-not $state.Pending.Wait(50)) { continue }
        $line = $state.Pending.Result
        if ($null -eq $line) { throw "LeanDoc exited before $Event" }
        $arrived = [DateTime]::UtcNow
        if ($line -match '^LEANDOC_TIMING (\S+) (\d+)(?: (.*))?$') {
            $state.Lines.Add([pscustomobject]@{ Event = $Matches[1]; Ms = [int64]$Matches[2]; Details = [string]$Matches[3]; Arrived = $arrived })
            if (-not $state.Events.Contains($Matches[1])) { $state.Events[$Matches[1]] = [int64]$Matches[2] }
        }
        $state.Pending = $state.Process.StandardOutput.ReadLineAsync()
    }
    @($state.Lines | Where-Object { $_.Event -eq $Event })[$Count - 1]
}

function Measure-Scenario([string]$Name, [string[]]$Documents) {
    $records = [System.Collections.Generic.List[object]]::new()
    $excluded = 0
    $attempts = 0
    while ($records.Count -lt $Runs -and $attempts -lt $Runs + 5) {
        $attempts += 1
        [void](Wait-WebView2Idle -TimeoutSeconds 30)
        $state = Start-Traced $Documents
        try {
            $target = if ($Documents.Count -gt 0) { 'rendered' } else { 'webview-ready' }
            $event = Read-Events $state $target
            $memory = Wait-Settled $state.Process.Id
            if (-not $memory.Complete) { $excluded += 1; continue }
            $pages = $null
            if ($event.Details -match 'pages=(\d+)') { $pages = [int]$Matches[1] }
            $record = [pscustomobject]@{
                timings = $state.Events; pages = $pages; memory = $memory
            }
            $records.Add($record)
            Write-Host ('  {0} #{1}: visible {2} ms, {3} {4} ms, private {5} MiB, {6} processes' -f $Name,
                $records.Count, $state.Events['window-visible'], $target, $event.Ms, $memory.PrivateMiB, $memory.Processes)
        } catch {
            Write-Warning ('{0}: launch failed: {1}' -f $Name, $_.Exception.Message)
            $excluded += 1
        } finally {
            Stop-LeanDocTestProcessTree -RootProcess $state.Process
        }
    }
    [pscustomobject]@{ Name = $Name; Records = @($records); Excluded = $excluded }
}

$measures = [ordered]@{}
$launches = [ordered]@{}
function Add-Measure([string]$Id, $Value, [string]$Unit, [string]$Budget, $Passed, [string]$Note, $Samples) {
    $result = if ($null -eq $Passed) { 'recorded' } elseif ($Passed) { 'pass' } else { 'fail' }
    $measures[$Id] = [ordered]@{ value = $Value; unit = $Unit; budget = $Budget; result = $result; note = $Note; samples = @($Samples) }
}
function Summary($scenario, [string]$Property) {
    Get-Median ([double[]]@($scenario.Records | ForEach-Object {
        if ($Property -eq 'private') { $_.memory.PrivateMiB }
        elseif ($Property -eq 'visible') { $_.timings['window-visible'] }
        else { $_.timings['rendered'] }
    }))
}

$machine = Get-LeanDocMachineSummary
Write-Host ('LeanDoc perf on {0}, {1}, WebView2 {2}' -f $machine.Processor, $machine.OperatingSystem, $machine.WebView2Runtime)

$empty = Measure-Scenario 'empty window' @()
$launches['empty window'] = $empty.Records
$m01 = Summary $empty 'private'
$p01 = Summary $empty 'visible'
Add-Measure 'P-01' $p01 'ms' '< 300' ($p01 -lt 300) ("launch to window visible, empty window; {0} excluded" -f $empty.Excluded) @($empty.Records | ForEach-Object { $_.timings['window-visible'] })
Add-Measure 'M-01' $m01 'MiB' 'baseline' $null 'empty window, private bytes of the tree' @($empty.Records | ForEach-Object { $_.memory.PrivateMiB })

$m02 = $null
foreach ($case in @(
    @{ P = 'P-02'; M = 'M-02'; Name = 'report-3'; Render = 1000; Memory = 40 },
    @{ P = 'P-03'; M = 'M-03'; Name = 'report-300'; Render = 2500; Memory = 120 },
    @{ P = 'P-04'; M = 'M-04'; Name = 'report-1000'; Render = 6000; Memory = 300 })) {
    $scenario = Measure-Scenario $case.Name @((Join-Path $docs ($case.Name + '.docx')))
    $launches[$case.Name] = $scenario.Records
    $rendered = Summary $scenario 'rendered'
    $private = Summary $scenario 'private'
    $pages = if ($scenario.Records.Count -gt 0) { $scenario.Records[0].pages } else { $null }
    Add-Measure $case.P $rendered 'ms' ('< {0}' -f $case.Render) ($null -ne $rendered -and $rendered -lt $case.Render) ("launch to first page, {0} ({1} pages)" -f $case.Name, $pages) @($scenario.Records | ForEach-Object { $_.timings['rendered'] })
    $delta = if ($null -ne $private -and $null -ne $m01) { [Math]::Round($private - $m01, 1) } else { $null }
    Add-Measure $case.M $delta 'MiB over M-01' ('<= {0}' -f $case.Memory) ($null -ne $delta -and $delta -le $case.Memory) ("{0}: {1} MiB" -f $case.Name, $private) @($scenario.Records | ForEach-Object { $_.memory.PrivateMiB })
    if ($case.Name -eq 'report-3') { $m02 = $private }
}

# P-05: the core with leandoc-inspect.
if (Test-Path -LiteralPath $InspectPath) {
    $rows = [ordered]@{}
    $passed = $true
    foreach ($entry in @(@('report-3', 50), @('report-300', 500), @('report-1000', 1500), @('images-20mb', 1000))) {
        $times = @(1..$Runs | ForEach-Object {
            $line = @(& $InspectPath --time (Join-Path $docs ($entry[0] + '.docx')))[-1]
            [double]($line | ConvertFrom-Json).ms
        })
        $median = Get-Median $times
        $rows[$entry[0]] = [ordered]@{ medianMs = $median; budgetMs = $entry[1]; samples = $times }
        $passed = $passed -and ($median -lt $entry[1])
    }
    Add-Measure 'P-05' (($rows.Values | ForEach-Object { $_.medianMs }) | Measure-Object -Maximum).Maximum 'ms (worst document)' '3-page < 50, 300-page < 500, 1,000-page < 1500, 20 MB images < 1000' $passed 'leandoc-inspect --time, Release build' @()
    $measures['P-05']['documents'] = $rows
}

# P-06: a second launch hands its file to the running window.
$handoffs = [System.Collections.Generic.List[double]]::new()
for ($index = 0; $index -lt $Runs; $index += 1) {
    [void](Wait-WebView2Idle -TimeoutSeconds 30)
    $state = Start-Traced @($report3)
    try {
        [void](Read-Events $state 'rendered')
        Start-Sleep -Milliseconds 500
        $started = [DateTime]::UtcNow
        $secondProcess = Start-Process -FilePath $ExePath -ArgumentList @('--', ('"{0}"' -f $second)) -PassThru
        $event = Read-Events $state 'rendered' 2
        $handoffs.Add([Math]::Round(($event.Arrived - $started).TotalMilliseconds, 1))
        [void]$secondProcess.WaitForExit(10000)
    } catch {
        Write-Warning ('P-06 launch failed: {0}' -f $_.Exception.Message)
    } finally {
        Stop-LeanDocTestProcessTree -RootProcess $state.Process
    }
}
$p06 = Get-Median ([double[]]$handoffs)
Add-Measure 'P-06' $p06 'ms' '< 500' ($null -ne $p06 -and $p06 -lt 500) 'second launch to the running window''s rendered (3-page report)' $handoffs

# M-05: five documents as tabs in one launch, as Explorer opens a selection.
$tabs = Measure-Scenario 'five tabs' $five
$launches['five tabs'] = $tabs.Records
$m05 = Summary $tabs 'private'
$limit = if ($null -ne $m02) { [Math]::Round($m02 + 25, 1) } else { $null }
Add-Measure 'M-05' $m05 'MiB' ("<= M-02 + 25 ({0})" -f $limit) ($null -ne $limit -and $null -ne $m05 -and $m05 -le $limit) 'five 3-page reports as tabs' @($tabs.Records | ForEach-Object { $_.memory.PrivateMiB })

# LeanMark 0.3.0 on the same runner, measured the same way (no hooks: the
# window, a complete tree, then the settled private bytes).
$leanmark = [ordered]@{}
if (-not [string]::IsNullOrWhiteSpace($LeanMarkExePath) -and (Test-Path -LiteralPath $LeanMarkExePath)) {
    $markdown = [ordered]@{
        'simple' = Join-Path $repoRoot 'README.md'
        'heavy' = Join-Path $docs 'heavy.md'
    }
    $heavy = [System.Text.StringBuilder]::new()
    for ($section = 1; $section -le 300; $section += 1) {
        [void]$heavy.AppendLine(('## Section {0}' -f $section)).AppendLine().AppendLine(('The survey team measured water levels at station {0} and recorded the results. **Flow** increased after the storm while *sediment* stayed within range.' -f $section)).AppendLine()
        if ($section % 4 -eq 0) { [void]$heavy.AppendLine('| Station | Level | Flow |').AppendLine('| --- | ---: | ---: |').AppendLine(('| S{0} | 1.2 | 3.4 |' -f $section)).AppendLine() }
    }
    [System.IO.File]::WriteAllText($markdown['heavy'], $heavy.ToString())
    foreach ($entry in $markdown.GetEnumerator()) {
        # The comparison is context, not a gate: a LeanMark launch that fails
        # (for example 0xC0000142 once the runner's desktop heap runs out)
        # is reported and skipped, never fails the LeanDoc measurements.
        try {
            $values = [System.Collections.Generic.List[double]]::new()
            for ($index = 0; $index -lt $Runs; $index += 1) {
                $process = Start-Process -FilePath $LeanMarkExePath -ArgumentList @('--', ('"{0}"' -f $entry.Value)) -PassThru
                try {
                    $deadline = [DateTime]::UtcNow.AddSeconds(30)
                    do { Start-Sleep -Milliseconds 100; $count = (Get-LeanDocProcessSample -RootProcessId $process.Id).ProcessCount }
                    while ($count -lt 3 -and [DateTime]::UtcNow -lt $deadline)
                    $memory = Wait-Settled $process.Id
                    if ($memory.Complete) { $values.Add($memory.PrivateMiB) }
                } finally {
                    Stop-LeanDocTestProcessTree -RootProcess $process
                    Start-Sleep -Milliseconds 1500
                }
            }
            if ($values.Count -gt 0) {
                $leanmark[$entry.Key] = [ordered]@{ privateMiB = (Get-Median ([double[]]$values)); samples = @($values) }
                Write-Host ('  LeanMark {0}: {1} MiB' -f $entry.Key, $leanmark[$entry.Key].privateMiB)
            }
        } catch {
            Write-Warning ('LeanMark {0} comparison skipped: {1}' -f $entry.Key, $_.Exception.Message)
        }
    }
}

$revision = (& git -C $repoRoot rev-parse --short HEAD)
$data = [ordered]@{
    meta = [ordered]@{ machine = $machine; revision = $revision; runs = $Runs; started = (Get-Date).ToUniversalTime().ToString('o') }
    measures = $measures
    launches = $launches
    leanmark = $leanmark
}
$data | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $out 'perf-windows.json') -Encoding utf8
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add(('## LeanDoc performance and memory, Windows runner ({0})' -f $machine.OperatingSystem))
$lines.Add('')
$lines.Add(('Test-gate figures from {0}, {1} logical processors, {2} GiB, WebView2 {3}; revision {4}; median of {5} launches; memory is the private bytes of the whole process tree. Not product claims.' -f $machine.Processor, $machine.LogicalProcessors, $machine.MemoryGiB, $machine.WebView2Runtime, $revision, $Runs))
$lines.Add('')
$lines.Add('| ID | Value | Budget | Result | Note |')
$lines.Add('| --- | ---: | --- | --- | --- |')
foreach ($id in ($measures.Keys | Sort-Object)) {
    $m = $measures[$id]
    $lines.Add(('| {0} | {1} {2} | {3} | {4} | {5} |' -f $id, $m.value, $m.unit, $m.budget, $m.result, $m.note))
}
if ($leanmark.Count -gt 0) {
    $lines.Add('')
    $lines.Add('| Same runner, same method | Private memory (MiB) |')
    $lines.Add('| --- | ---: |')
    $lines.Add(('| LeanDoc, empty window | {0} |' -f $m01))
    $lines.Add(('| LeanDoc, 3-page report | {0} |' -f $m02))
    $lines.Add(('| LeanDoc, 300-page report | {0} |' -f (Summary ([pscustomobject]@{ Records = $launches['report-300'] }) 'private')))
    if ($leanmark.Contains('simple')) { $lines.Add(('| LeanMark 0.3.0, README.md | {0} |' -f $leanmark['simple'].privateMiB)) }
    if ($leanmark.Contains('heavy')) { $lines.Add(('| LeanMark 0.3.0, 300-section Markdown | {0} |' -f $leanmark['heavy'].privateMiB)) }
}
$markdownText = $lines -join "`n"
Set-Content -LiteralPath (Join-Path $out 'perf-windows.md') -Value $markdownText -Encoding utf8
Write-Output $markdownText
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $markdownText }

$failed = @($measures.Keys | Where-Object { $measures[$_].result -eq 'fail' })
if ($failed.Count -gt 0) {
    Write-Warning ('Budget missed: {0}' -f ($failed -join ', '))
    if (-not $NoFail) { exit 1 }
}
