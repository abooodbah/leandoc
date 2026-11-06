[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$NewExe,
    [Parameter(Mandatory = $true)][string]$OldExe,
    [int]$Rounds = 6,
    [int]$Runs = 5,
    [string]$OutputDirectory = 'artifacts/compare-open'
)

# Launch to first page for two builds on one runner, alternating, with an
# A/A pair (the new build twice per round) to show the runner's own noise.
# Each round launches each build $Runs times with report-3 and report-300
# and keeps the median; the summary gives the median and the spread of the
# round medians. Test figures, not product claims.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $testsRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force
$out = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
$docs = Join-Path $out 'documents'
New-Item -ItemType Directory -Path $docs -Force | Out-Null
& python (Join-Path $PSScriptRoot 'make_report.py') $docs | Out-Host

function Measure-Launch([string]$Exe, [string]$Document) {
    [void](Wait-WebView2Idle -TimeoutSeconds 30)
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Exe
    $info.Arguments = '--trace-timing -- "{0}"' -f $Document
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.WorkingDirectory = Split-Path -Parent $Exe
    $process = [System.Diagnostics.Process]::Start($info)
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        while ([DateTime]::UtcNow -lt $deadline) {
            $line = $process.StandardOutput.ReadLine()
            if ($null -eq $line) { break }
            if ($line -match '^LEANDOC_TIMING rendered (\d+)') { return [double]$Matches[1] }
        }
        return $null
    } finally {
        Stop-LeanDocTestProcessTree -RootProcess $process
        Start-Sleep -Milliseconds 500
    }
}

function Median([double[]]$values) {
    $sorted = @($values | Sort-Object)
    if ($sorted.Count -eq 0) { return $null }
    $sorted[[int][Math]::Floor(($sorted.Count - 1) / 2)]
}

$builds = [ordered]@{ 'v0.1.4' = $OldExe; 'main' = $NewExe; 'main again' = $NewExe }
$results = @{}
foreach ($name in $builds.Keys) { foreach ($doc in 'report-3', 'report-300') { $results["$name|$doc"] = [System.Collections.Generic.List[double]]::new() } }
for ($round = 1; $round -le $Rounds; $round += 1) {
    $order = @($builds.Keys)
    if ($round % 2 -eq 0) { [array]::Reverse($order) }
    foreach ($name in $order) {
        foreach ($doc in 'report-3', 'report-300') {
            $times = @(1..$Runs | ForEach-Object { Measure-Launch $builds[$name] (Join-Path $docs "$doc.docx") } | Where-Object { $null -ne $_ })
            $median = Median $times
            $results["$name|$doc"].Add($median)
            Write-Host ('round {0} {1} {2}: median {3} ms of {4}' -f $round, $name, $doc, $median, ($times -join ', '))
        }
    }
}
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('| Build | Document | Median of round medians (ms) | Lowest | Highest |')
$lines.Add('| --- | --- | ---: | ---: | ---: |')
foreach ($key in $results.Keys | Sort-Object) {
    $values = [double[]]$results[$key]
    $parts = $key -split '\|'
    $lines.Add(('| {0} | {1} | {2} | {3} | {4} |' -f $parts[0], $parts[1], (Median $values), ($values | Measure-Object -Minimum).Minimum, ($values | Measure-Object -Maximum).Maximum))
}
$machine = Get-LeanDocMachineSummary
Write-Output ('COMPARE machine: {0}, WebView2 {1}, {2} rounds of {3} launches' -f $machine.Processor, $machine.WebView2Runtime, $Rounds, $Runs)
$lines | ForEach-Object { Write-Output ('COMPARE ' + $_) }
