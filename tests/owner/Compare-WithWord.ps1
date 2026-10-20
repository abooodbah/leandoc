[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$DocumentPath,
    [string]$ExePath,
    [ValidateRange(1, 20)][int]$Iterations = 5,
    [ValidateRange(500, 30000)][int]$SettleMilliseconds = 2000
)

# Opens the same documents in LeanDoc and in Microsoft Word and prints one
# Markdown table: time to the first page, pages, and private memory of each
# application's whole process tree, as medians over Iterations launches.
#
# Word is driven through COM with Visible = $true, so it does the same work it
# does for a person. Each document opens read-only, is never converted or
# exported (no ExportAsFixedFormat), and Word closes without saving. Close
# every Word and LeanDoc window first: COM would otherwise attach to a running
# Word and its memory would include other documents.
#   pwsh -File tests\owner\Compare-WithWord.ps1 -DocumentPath C:\Docs\report.docx

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
if (@(Get-Process WINWORD -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'Close Microsoft Word first. A running Word would serve the COM calls and skew its memory.'
}
if (@(Get-Process LeanDoc -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'Close every LeanDoc window first.'
}
try {
    $probe = New-Object -ComObject Word.Application
    $wordVersion = $probe.Version
    $probe.Quit(0)
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($probe)
} catch {
    throw 'Microsoft Word is not installed or cannot be started through COM.'
}
Start-Sleep -Seconds 2

function Get-WordTreeSample {
    $words = @(Get-Process WINWORD -ErrorAction SilentlyContinue)
    $private = [int64]0; $working = [int64]0; $count = 0
    foreach ($word in $words) {
        foreach ($processId in (Get-LeanDocProcessTreeIds -RootProcessId $word.Id)) {
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($null -eq $process) { continue }
            $private += [int64]$process.PrivateMemorySize64
            $working += [int64]$process.WorkingSet64
            $count += 1
        }
    }
    [pscustomobject]@{ PrivateBytes = $private; WorkingSetBytes = $working; ProcessCount = $count }
}

function Measure-WordOpen([string]$path) {
    # wdDoNotSaveChanges = 0; wdStatisticPages = 2.
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $word = New-Object -ComObject Word.Application
    $word.Visible = $true
    $word.DisplayAlerts = 0
    $document = $null
    try {
        # Documents.Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
        $document = $word.Documents.Open($path, $false, $true, $false)
        $pages = $document.ComputeStatistics(2)
        $openedMs = $clock.Elapsed.TotalMilliseconds
        Start-Sleep -Milliseconds $SettleMilliseconds
        $sample = Get-WordTreeSample
        [pscustomobject]@{
            FirstPageMs = [Math]::Round($openedMs)
            Pages = $pages
            PrivateMiB = [Math]::Round($sample.PrivateBytes / 1MB, 2)
            WorkingSetMiB = [Math]::Round($sample.WorkingSetBytes / 1MB, 2)
        }
    } finally {
        if ($null -ne $document) {
            $document.Close(0)
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)
        }
        $word.Quit(0)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while (@(Get-Process WINWORD -ErrorAction SilentlyContinue).Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 250
        }
    }
}

$machine = Get-LeanDocMachineSummary
$version = (Get-Item -LiteralPath $ExePath).VersionInfo.ProductVersion
$rows = [System.Collections.Generic.List[object]]::new()
foreach ($document in $DocumentPath) {
    $full = [System.IO.Path]::GetFullPath($document)
    Assert-True (Test-Path -LiteralPath $full -PathType Leaf) "Document is missing: $full"
    $name = [System.IO.Path]::GetFileName($full)
    $lean = [System.Collections.Generic.List[object]]::new()
    $word = [System.Collections.Generic.List[object]]::new()
    for ($index = 0; $index -le $Iterations; $index += 1) {
        $warmup = $index -eq 0
        Write-Host ('{0}: {1}' -f $name, $(if ($warmup) { 'warm-up' } else { "round $index of $Iterations" }))
        [void](Wait-WebView2Idle -TimeoutSeconds 30)
        $launch = Measure-LeanDocLaunch -ExePath $ExePath -DocumentPaths @($full) -SettleMilliseconds $SettleMilliseconds
        if (-not $warmup -and $launch.Complete) { $lean.Add($launch) }
        $opened = Measure-WordOpen $full
        if (-not $warmup) { $word.Add($opened) }
    }
    foreach ($pair in @(@('LeanDoc', $lean), @('Word', $word))) {
        $items = @($pair[1])
        $rows.Add([pscustomobject]@{
            Document = $name
            Application = $pair[0]
            Runs = $items.Count
            FirstPageMs = Get-LeanDocMedian ([double[]]@($items | ForEach-Object { $_.FirstPageMs }))
            Pages = if ($items.Count -gt 0) { $items[0].Pages } else { $null }
            PrivateMiB = Get-LeanDocMedian ([double[]]@($items | ForEach-Object { $_.PrivateMiB }))
            WorkingSetMiB = Get-LeanDocMedian ([double[]]@($items | ForEach-Object { $_.WorkingSetMiB }))
        })
    }
}

$culture = [System.Globalization.CultureInfo]::InvariantCulture
Write-Output ''
Write-Output '## LeanDoc and Microsoft Word'
Write-Output ''
Write-Output ('- LeanDoc {0}; Microsoft Word {1}' -f $version, $wordVersion)
Write-Output ('- Machine: {0}; {1}; {2} GiB; {3}' -f $machine.Computer, $machine.Processor, $machine.MemoryGiB, $machine.OperatingSystem)
Write-Output ('- Method: median of {0} rounds after one warm-up. LeanDoc first page is its "rendered" message from process start. Word first page is from starting Word through COM to Documents.Open returning, with Word visible. Memory is private bytes of each application''s process tree {1} ms later.' -f $Iterations, $SettleMilliseconds)
Write-Output ''
Write-Output '| Document | Application | First page (ms) | Pages | Private memory (MiB) | Working set (MiB) | Runs |'
Write-Output '| --- | --- | ---: | ---: | ---: | ---: | ---: |'
foreach ($row in $rows) {
    Write-Output ('| {0} | {1} | {2} | {3} | {4} | {5} | {6} |' -f $row.Document, $row.Application,
        $row.FirstPageMs.ToString('N0', $culture), $row.Pages,
        $row.PrivateMiB.ToString('N1', $culture), $row.WorkingSetMiB.ToString('N1', $culture), $row.Runs)
}
