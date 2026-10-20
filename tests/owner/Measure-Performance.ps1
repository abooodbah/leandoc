[CmdletBinding()]
param(
    [string]$ExePath,
    [string[]]$DocumentPath,
    [ValidateRange(1, 50)][int]$Iterations = 10,
    [ValidateRange(0, 5)][int]$WarmupIterations = 1,
    [ValidateRange(500, 30000)][int]$SettleMilliseconds = 2000,
    [switch]$SkipEmptyWindow,
    [string]$OutputPath
)

# LeanDoc start-up and memory on Windows, with LeanMark's method:
#   - each scenario is launched Iterations times after WarmupIterations;
#   - before every launch the script waits until no WebView2 process still
#     uses LeanDoc's profile folder, so a launch never attaches to a dying one;
#   - memory is the private bytes and working set of LeanDoc.exe plus every
#     descendant WebView2 process, sampled after the page is stable;
#   - a launch whose tree is incomplete (fewer than three processes) is
#     excluded and reported;
#   - first page is the reader's "rendered" message, read from --trace-timing.
# It prints the machine details and a Markdown table of medians. Close every
# LeanDoc window first. Example:
#   pwsh -File tests\owner\Measure-Performance.ps1 -ExePath "$env:LOCALAPPDATA\Programs\LeanDoc\LeanDoc.exe" `
#        -DocumentPath C:\Docs\report.docx, C:\Docs\long.docx

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $testsRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force

if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $installed = Join-Path $env:LOCALAPPDATA 'Programs\LeanDoc\LeanDoc.exe'
    $ExePath = if (Test-Path -LiteralPath $installed) { $installed } else { Join-Path $repoRoot 'dist\LeanDoc.exe' }
}
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
if (@($DocumentPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -eq 0) {
    $DocumentPath = @(Join-Path $testsRoot 'hosts\fixtures\smoke.docx')
}
$running = @(Get-Process LeanDoc -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    throw 'Close every LeanDoc window before measuring; a running LeanDoc would receive the documents.'
}

$scenarios = [System.Collections.Generic.List[object]]::new()
if (-not $SkipEmptyWindow) {
    $scenarios.Add([pscustomobject]@{ Name = 'Empty window'; Documents = @() })
}
foreach ($document in $DocumentPath) {
    $full = [System.IO.Path]::GetFullPath($document)
    $scenarios.Add([pscustomobject]@{ Name = [System.IO.Path]::GetFileName($full); Documents = @($full) })
}

$machine = Get-LeanDocMachineSummary
$version = (Get-Item -LiteralPath $ExePath).VersionInfo.ProductVersion
$results = [System.Collections.Generic.List[object]]::new()
$clock = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($scenario in $scenarios) {
    $launches = [System.Collections.Generic.List[object]]::new()
    for ($index = 1; $index -le ($WarmupIterations + $Iterations); $index += 1) {
        $warmup = $index -le $WarmupIterations
        if (-not (Wait-WebView2Idle -TimeoutSeconds 30)) {
            Write-Warning 'A previous WebView2 process did not exit within 30 s; this launch may be skewed.'
        }
        $label = if ($warmup) { 'warm-up' } else { 'launch {0} of {1}' -f ($index - $WarmupIterations), $Iterations }
        Write-Host ('{0}: {1}' -f $scenario.Name, $label)
        $launch = Measure-LeanDocLaunch -ExePath $ExePath -DocumentPaths $scenario.Documents `
            -SettleMilliseconds $SettleMilliseconds
        if (-not $warmup) { $launches.Add($launch) }
        if (-not $launch.Complete) { Write-Warning ('Excluded: {0}' -f $launch.Failure) }
        Start-Sleep -Milliseconds 500
    }
    $complete = @($launches | Where-Object { $_.Complete })
    $results.Add([pscustomobject]@{
        Scenario = $scenario.Name
        Launches = $launches.Count
        Excluded = $launches.Count - $complete.Count
        WindowVisibleMs = Get-LeanDocMedian ([double[]]@($complete | ForEach-Object { $_.WindowVisibleMs }))
        FirstPageMs = if ($scenario.Documents.Count -gt 0) { Get-LeanDocMedian ([double[]]@($complete | ForEach-Object { $_.FirstPageMs })) } else { [double]::NaN }
        Pages = if ($complete.Count -gt 0) { $complete[0].Pages } else { $null }
        PrivateMiB = Get-LeanDocMedian ([double[]]@($complete | ForEach-Object { $_.PrivateMiB }))
        WorkingSetMiB = Get-LeanDocMedian ([double[]]@($complete | ForEach-Object { $_.WorkingSetMiB }))
        Processes = Get-LeanDocMedian ([double[]]@($complete | ForEach-Object { $_.ProcessCount }))
        Raw = @($launches)
    })
}

function Format-Number([double]$value, [string]$format = 'N0') {
    if ([double]::IsNaN($value)) { return 'n/a' }
    $value.ToString($format, [System.Globalization.CultureInfo]::InvariantCulture)
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('## LeanDoc performance')
$lines.Add('')
$lines.Add(('- LeanDoc: {0} ({1})' -f $version, $ExePath))
$lines.Add(('- Machine: {0}; {1}; {2} logical processors; {3} GiB' -f $machine.Computer, $machine.Processor, $machine.LogicalProcessors, $machine.MemoryGiB))
$lines.Add(('- Windows: {0}; WebView2 Runtime {1}' -f $machine.OperatingSystem, $machine.WebView2Runtime))
$lines.Add(('- Method: median of {0} launches after {1} warm-up, sampled {2} ms after the first page; private memory of the whole process tree; incomplete trees excluded.' -f $Iterations, $WarmupIterations, $SettleMilliseconds))
$lines.Add(('- Date: {0:yyyy-MM-dd}; run time {1:N0} s' -f (Get-Date), $clock.Elapsed.TotalSeconds))
$lines.Add('')
$lines.Add('| Scenario | Window visible (ms) | First page (ms) | Pages | Private memory (MiB) | Working set (MiB) | Processes | Excluded |')
$lines.Add('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
foreach ($result in $results) {
    $lines.Add(('| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} of {8} |' -f $result.Scenario,
        (Format-Number $result.WindowVisibleMs), (Format-Number $result.FirstPageMs),
        $(if ($null -ne $result.Pages) { $result.Pages } else { 'n/a' }),
        (Format-Number $result.PrivateMiB 'N1'), (Format-Number $result.WorkingSetMiB 'N1'),
        (Format-Number $result.Processes), $result.Excluded, $result.Launches))
}
$markdown = $lines -join [Environment]::NewLine
Write-Output ''
Write-Output $markdown

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $report = [ordered]@{
        SchemaVersion = 1
        LeanDoc = $version
        Executable = $ExePath
        Machine = $machine
        Iterations = $Iterations
        WarmupIterations = $WarmupIterations
        SettleMilliseconds = $SettleMilliseconds
        Results = @($results)
    }
    $json = $report | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputPath), $json,
        [System.Text.UTF8Encoding]::new($false))
    Write-Output ('Raw samples written to {0}' -f $OutputPath)
}
