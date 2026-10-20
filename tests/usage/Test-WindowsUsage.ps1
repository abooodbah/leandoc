[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$OutputDirectory = 'artifacts/usage-windows'
)

# The Windows subset of the usage tasks, through the real LeanDoc on WebView2.
# Windows has no --test-script hook, so the subset is what the launch hooks
# can observe:
#   U-01  a document passed on the command line shows its first page
#         (--trace-timing reports `rendered` with its page count).
#   U-04  five documents opened one after another (as from Explorer) end in
#         one LeanDoc process; the running window reports `rendered` for
#         each of them, and the fifth is not slower than twice the first.
#   U-07  every security fixture: --smoke-test renders the ones the core
#         accepts and exits 1 for the ones it rejects; never a crash, never
#         a hang (20 s).
#   U-08  the other kinds (.doc, encrypted, .odt, .rtf, a renamed .xlsx, an
#         empty ZIP, text named .docx): --smoke-test exits 1 within 20 s,
#         the fallback page instead of a crash.
# Writes usage-windows.json and usage-windows.md; exits 1 on a failure.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $testsRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force

if ([string]::IsNullOrWhiteSpace($ExePath)) { $ExePath = Join-Path $repoRoot 'dist\LeanDoc.exe' }
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
$out = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
New-Item -ItemType Directory -Path $out -Force | Out-Null
$fixturesRoot = Join-Path $testsRoot 'fixtures'
$expected = Get-Content -LiteralPath (Join-Path $fixturesRoot 'expected.json') -Raw | ConvertFrom-Json
$renderable = @('docx', 'docm', 'dotx', 'dotm')
$results = [ordered]@{}

function Add-Result([string]$Id, [string]$Task, [bool]$Passed, [string]$Detail) {
    $results[$Id] = [pscustomobject]@{ task = $Task; result = $(if ($Passed) { 'pass' } else { 'fail' }); detail = $Detail }
    Write-Host ('{0} {1}: {2}' -f $Id, $(if ($Passed) { 'PASS' } else { 'FAIL' }), $Detail)
}

function Start-TimedLeanDoc([string[]]$Documents) {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $ExePath
    $quoted = @($Documents | ForEach-Object { '"{0}"' -f [System.IO.Path]::GetFullPath($_) })
    $info.Arguments = '--trace-timing -- ' + ($quoted -join ' ')
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.WorkingDirectory = Split-Path -Parent $ExePath
    [System.Diagnostics.Process]::Start($info)
}

function Read-RenderedLines([System.Diagnostics.Process]$Process, [int]$Count, [int]$TimeoutSeconds) {
    $lines = [System.Collections.Generic.List[string]]::new()
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ($lines.Count -lt $Count -and [DateTime]::UtcNow -lt $deadline) {
        $task = $Process.StandardOutput.ReadLineAsync()
        if (-not $task.Wait([Math]::Max(1, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds))) { break }
        $line = $task.Result
        if ($null -eq $line) { break }
        if ($line -like 'LEANDOC_TIMING rendered *') { $lines.Add($line) }
    }
    , $lines
}

# U-01 -----------------------------------------------------------------------
$report = Join-Path $out 'emailed-report.docx'
Copy-Item -LiteralPath (Join-Path $testsRoot 'hosts\fixtures\smoke.docx') -Destination $report -Force
[void](Wait-WebView2Idle -TimeoutSeconds 30)
$process = Start-TimedLeanDoc @($report)
try {
    $rendered = Read-RenderedLines $process 1 30
    Add-Result 'U-01' 'Open a document from the command line' ($rendered.Count -eq 1) `
        $(if ($rendered.Count) { $rendered[0] } else { 'no rendered message within 30 s' })
} finally {
    Stop-LeanDocTestProcessTree -RootProcess $process
}

# U-04 -----------------------------------------------------------------------
$documents = @()
foreach ($index in 1..5) {
    $path = Join-Path $out ('attachment-{0}.docx' -f $index)
    Copy-Item -LiteralPath (Join-Path $testsRoot 'hosts\fixtures\smoke.docx') -Destination $path -Force
    $documents += $path
}
[void](Wait-WebView2Idle -TimeoutSeconds 30)
$primary = Start-TimedLeanDoc @($documents[0])
try {
    $times = @()
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $first = Read-RenderedLines $primary 1 30
    $times += [Math]::Round($clock.Elapsed.TotalMilliseconds)
    $forwardersOk = $true
    foreach ($path in $documents[1..4]) {
        $clock.Restart()
        $forwarder = Start-LeanDocProcess -ExePath $ExePath -DocumentPaths @($path)
        if (-not $forwarder.WaitForExit(15000) -or $forwarder.ExitCode -ne 0) { $forwardersOk = $false }
        $next = Read-RenderedLines $primary 1 20
        if ($next.Count -ne 1) { $forwardersOk = $false }
        $times += [Math]::Round($clock.Elapsed.TotalMilliseconds)
    }
    $processes = @(Get-LeanDocProcessesByPath -ExePath $ExePath).Count
    $passed = $first.Count -eq 1 -and $forwardersOk -and $processes -eq 1 -and $times[4] -le [Math]::Max(2 * $times[0], 1000)
    Add-Result 'U-04' 'Open five attachments in a row' $passed `
        ('launch to rendered (ms): {0}; {1} LeanDoc process(es)' -f ($times -join ', '), $processes)
} finally {
    Stop-LeanDocTestProcessTree -RootProcess $primary
}

# U-07 and U-08 ---------------------------------------------------------------
foreach ($group in @(@{ Id = 'U-07'; Task = 'Open each security fixture'; Folder = 'security' },
                     @{ Id = 'U-08'; Task = 'Open other kinds of files'; Folder = 'kinds' })) {
    $rows = @()
    $failed = @()
    foreach ($property in $expected.PSObject.Properties) {
        if (-not $property.Name.StartsWith($group.Folder + '/')) { continue }
        $file = Join-Path $fixturesRoot ($property.Name -replace '/', '\')
        $wantsRender = [bool]$property.Value.ok -and $renderable -contains [string]$property.Value.kind
        [void](Wait-WebView2Idle -TimeoutSeconds 30)
        try {
            $smoke = Invoke-LeanDocSmoke -ExePath $ExePath -DocumentPath $file -TimeoutSeconds 20
            $want = if ($wantsRender) { 0 } else { 1 }
            if ($smoke.ExitCode -ne $want) { $failed += ('{0} exit {1}, expected {2}' -f $property.Name, $smoke.ExitCode, $want) }
            $rows += ('{0} {1} ({2} ms)' -f (Split-Path -Leaf $file), $(if ($smoke.ExitCode -eq 0) { 'rendered' } else { 'fallback' }), $smoke.Milliseconds)
        } catch {
            $failed += ('{0}: {1}' -f $property.Name, $_.Exception.Message)
        }
    }
    Add-Result $group.Id $group.Task ($failed.Count -eq 0 -and $rows.Count -gt 0) `
        ($(if ($failed.Count) { 'problems: ' + ($failed -join '; ') + '; ' } else { '' }) + ($rows -join ', '))
}

$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $out 'usage-windows.json') -Encoding utf8
$lines = @('| ID | Task | Result | Detail |', '| --- | --- | --- | --- |')
foreach ($entry in $results.GetEnumerator()) {
    $lines += ('| {0} | {1} | {2} | {3} |' -f $entry.Key, $entry.Value.task, $entry.Value.result, ($entry.Value.detail -replace '\|', '/'))
}
Set-Content -LiteralPath (Join-Path $out 'usage-windows.md') -Value ($lines -join "`n") -Encoding utf8
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ($lines -join "`n") }
$failures = @($results.Values | Where-Object { $_.result -eq 'fail' })
if ($failures.Count) { throw ('{0} Windows usage task(s) failed.' -f $failures.Count) }
Write-Output 'Windows usage subset passed.'
