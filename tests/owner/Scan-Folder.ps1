[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$InspectPath,
    [ValidateRange(1, 120)][int]$TimeoutSeconds = 10
)

# Runs leandoc-inspect over every supported file in a private folder and its
# subfolders and prints only what is safe to share: the file name, its kind,
# the result, and the feature counts. It never prints paths, titles, authors,
# headings, or any document text, and it never writes into the folder.
#   pwsh -File tests\owner\Scan-Folder.ps1 -Path "$env:USERPROFILE\Documents"

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $testsRoot

if ([string]::IsNullOrWhiteSpace($InspectPath)) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\LeanDoc\tools\leandoc-inspect.exe'),
        (Join-Path $repoRoot 'dist\tools\leandoc-inspect.exe'))
    $InspectPath = @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })[0]
    if ([string]::IsNullOrWhiteSpace($InspectPath)) {
        throw 'leandoc-inspect.exe was not found. Pass -InspectPath; it ships in the ZIP under tools\.'
    }
}
$InspectPath = [System.IO.Path]::GetFullPath($InspectPath)
$root = [System.IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Folder not found: $root" }

$extensions = @('.docx', '.dotx', '.docm', '.dotm', '.doc', '.rtf', '.odt')
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() -and -not $_.Name.StartsWith('~$') })

$clock = [System.Diagnostics.Stopwatch]::StartNew()
$rows = [System.Collections.Generic.List[object]]::new()
foreach ($file in $files) {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $InspectPath
    # A full Windows path never starts with '-', so it cannot read as an option.
    $startInfo.ArgumentList.Add($file.FullName)
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = Split-Path -Parent $InspectPath
    $fileClock = [System.Diagnostics.Stopwatch]::StartNew()
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $null = $process.StandardError.ReadToEndAsync()
    $result = 'crash'
    $kind = ''
    $features = ''
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill()
        $result = 'hang'
    } else {
        $process.WaitForExit()
        $line = @($outputTask.GetAwaiter().GetResult() -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') }) | Select-Object -Last 1
        if ($null -ne $line) {
            try {
                $report = $line | ConvertFrom-Json
                $kind = [string]$report.kind
                $result = if ($report.ok) { 'ok' } else { [string]$report.errorCode }
                $features = (@($report.features) | ForEach-Object { '{0} {1}' -f $_.code, $_.count }) -join ', '
            } catch { $result = 'bad-json' }
        } elseif ($process.ExitCode -ne 0) {
            $result = 'exit {0}' -f $process.ExitCode
        }
    }
    $rows.Add([pscustomobject]@{
        File = $file.Name
        Kind = $kind
        Result = $result
        Milliseconds = [Math]::Round($fileClock.Elapsed.TotalMilliseconds)
        Features = $features
    })
}

Write-Output ''
Write-Output ('## leandoc-inspect over {0} files' -f $rows.Count)
Write-Output ''
Write-Output ('Run time {0:N0} s. Only file names, kinds, results, and feature counts are shown.' -f $clock.Elapsed.TotalSeconds)
Write-Output ''
Write-Output '| File | Kind | Result | ms | Features |'
Write-Output '| --- | --- | --- | ---: | --- |'
foreach ($row in $rows) {
    $name = $row.File.Replace('|', '/')
    Write-Output ('| {0} | {1} | {2} | {3} | {4} |' -f $name, $row.Kind, $row.Result, $row.Milliseconds, $row.Features)
}
Write-Output ''
Write-Output '### Summary'
Write-Output ''
foreach ($group in ($rows | Group-Object Result | Sort-Object Count -Descending)) {
    Write-Output ('- {0}: {1}' -f $group.Name, $group.Count)
}
$slow = @($rows | Where-Object { $_.Milliseconds -gt 2000 })
Write-Output ('- slower than 2 s: {0}' -f $slow.Count)
