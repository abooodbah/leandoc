[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [string]$DocumentPath,
    [ValidateRange(1, 20)][int]$Iterations = 3
)

# Compares LeanDoc's WebView2 browser-argument profiles on this machine: the
# shipped arguments, the same with the GPU kept, and no extra arguments. Each
# launch uses Measure-LeanDocLaunch (full process tree, after the first page).
# CI runs it on windows-latest to record the decision in
# docs/architecture/hosts.md; runner figures are for comparison only.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force
if ([string]::IsNullOrWhiteSpace($DocumentPath)) {
    $DocumentPath = Join-Path $PSScriptRoot 'fixtures\smoke.docx'
}

$rows = [System.Collections.Generic.List[string]]::new()
$rows.Add('| Profile | First page (ms) | Private memory (MiB) | Working set (MiB) | Processes | Complete |')
$rows.Add('| --- | ---: | ---: | ---: | ---: | ---: |')
foreach ($profile in @('default', 'gpu', 'plain')) {
    $launches = @()
    for ($index = 0; $index -le $Iterations; $index += 1) {
        [void](Wait-WebView2Idle -TimeoutSeconds 30)
        $launch = Measure-LeanDocLaunch -ExePath $ExePath -DocumentPaths @($DocumentPath) `
            -Environment @{ LEANDOC_BROWSER_PROFILE = $profile }
        if ($index -gt 0) { $launches += $launch }
        Start-Sleep -Milliseconds 500
    }
    $complete = @($launches | Where-Object { $_.Complete })
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $format = { param($values, $pattern) $m = Get-LeanDocMedian ([double[]]@($values)); if ([double]::IsNaN($m)) { 'n/a' } else { $m.ToString($pattern, $culture) } }
    $rows.Add(('| {0} | {1} | {2} | {3} | {4} | {5} of {6} |' -f $profile,
        (& $format ($complete | ForEach-Object { $_.FirstPageMs }) 'N0'),
        (& $format ($complete | ForEach-Object { $_.PrivateMiB }) 'N1'),
        (& $format ($complete | ForEach-Object { $_.WorkingSetMiB }) 'N1'),
        (& $format ($complete | ForEach-Object { $_.ProcessCount }) 'N0'),
        $complete.Count, $launches.Count))
}
$machine = Get-LeanDocMachineSummary
$header = 'WebView2 {0} on {1}, {2} logical processors; median of {3} launches after one warm-up.' -f `
    $machine.WebView2Runtime, $machine.OperatingSystem, $machine.LogicalProcessors, $Iterations
$table = $rows -join "`n"
Write-Output $header
Write-Output $table
if ($env:GITHUB_ACTIONS -eq 'true') {
    $message = ($header + "`n" + $table).Replace('%', '%25').Replace("`r", '').Replace("`n", '%0A')
    Write-Output ('::notice title=WebView2 browser arguments::{0}' -f $message)
}
