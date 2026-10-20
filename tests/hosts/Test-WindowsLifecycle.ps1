[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ZipPath
)

# L-02: the Windows release ZIP through its whole life on a clean runner
# account: extract, smoke from the extracted folder, install.ps1, the Open
# With and Default Apps registration, a smoke from the installed copy, a first
# real launch (which creates the WebView2 folder), uninstall.ps1, and then the
# registry and the files as they were before. Changes HKCU and
# %LOCALAPPDATA%; run it on a CI runner, not on a desktop you use.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force

$extensions = @('.docx', '.dotx', '.docm', '.dotm', '.doc', '.rtf', '.odt')
$fixture = Join-Path $testsRoot 'hosts\fixtures\smoke.docx'
$local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installDir = Join-Path $local 'Programs\LeanDoc'
$dataDir = Join-Path $local 'LeanDoc'
$shortcut = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)) 'Programs\LeanDoc.lnk'

# Everything LeanDoc may touch, as text, so before and after compare exactly.
function Get-State {
    $lines = [System.Collections.Generic.List[string]]::new()
    $keys = @('Software\LeanDoc', 'Software\Classes\LeanDoc.Document',
        'Software\Classes\Applications\LeanDoc.exe', 'Software\RegisteredApplications',
        'Software\Microsoft\Windows\CurrentVersion\App Paths\LeanDoc.exe',
        'Software\Microsoft\Windows\CurrentVersion\Uninstall\LeanDoc')
    foreach ($extension in $extensions) {
        $keys += "Software\Classes\$extension"
        $keys += "Software\Classes\$extension\OpenWithProgids"
    }
    foreach ($key in $keys) {
        $handle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key, $false)
        if ($null -eq $handle) { $lines.Add("HKCU\$key (absent)"); continue }
        try {
            foreach ($name in ($handle.GetValueNames() | Sort-Object)) {
                $lines.Add(('HKCU\{0} [{1}] = {2}' -f $key, $name, $handle.GetValue($name)))
            }
            $lines.Add(('HKCU\{0} subkeys: {1}' -f $key, (($handle.GetSubKeyNames() | Sort-Object) -join ',')))
        } finally { $handle.Dispose() }
    }
    foreach ($path in @($installDir, $dataDir, $shortcut)) {
        $lines.Add(('{0}: {1}' -f $path, (Test-Path -LiteralPath $path)))
    }
    $lines
}

# Earlier steps of the same CI job run the portable build, which writes its
# settings and WebView2 folder. L-02 starts from a clean account, so those
# traces go first; the uninstall must then leave the account exactly so.
[void](Wait-WebView2Idle -TimeoutSeconds 30)
foreach ($trace in @('HKCU:\Software\LeanDoc', $dataDir)) {
    if (Test-Path -LiteralPath $trace) {
        Write-TestNote "Removing a trace of an earlier portable run: $trace"
        Remove-Item -LiteralPath $trace -Recurse -Force
    }
}
$before = @(Get-State)
Assert-True (-not (Test-Path -LiteralPath $installDir)) "A previous install exists at $installDir."

$extract = Join-Path ([System.IO.Path]::GetTempPath()) ('leandoc-zip-' + [Guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $ZipPath -DestinationPath $extract
$extractedExe = @(Get-ChildItem -LiteralPath $extract -Recurse -Filter LeanDoc.exe)[0].FullName
$payload = Split-Path -Parent $extractedExe
# The first launch of a fresh copy also creates its WebView2 user data
# folder. Wait for WebView2 processes of earlier steps to exit first; a
# first launch that still times out is recorded and tried once more.
[void](Wait-WebView2Idle -TimeoutSeconds 30)
$smoke = Invoke-LeanDocSmoke -ExePath $extractedExe -DocumentPath $fixture
if ($smoke.ExitCode -ne 0 -and $smoke.Output -match 'timed out') {
    Write-TestNote ('first smoke from the extracted ZIP timed out after {0} ms: {1}; trying again' -f $smoke.Milliseconds, $smoke.Output)
    [void](Wait-WebView2Idle -TimeoutSeconds 30)
    $smoke = Invoke-LeanDocSmoke -ExePath $extractedExe -DocumentPath $fixture
}
Assert-Equal $smoke.ExitCode 0 ("Smoke from the extracted ZIP failed: " + $smoke.Output)
Write-TestPass ('extracted ZIP renders the smoke fixture ({0} ms)' -f $smoke.Milliseconds)

$installer = @(Get-ChildItem -LiteralPath $extract -Recurse -Filter install.ps1)[0].FullName
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -SourceDirectory $payload -Quiet | Out-Host
Assert-Equal $LASTEXITCODE 0 'install.ps1 failed.'
$installedExe = Join-Path $installDir 'LeanDoc.exe'
Assert-True (Test-Path -LiteralPath $installedExe) 'LeanDoc.exe was not installed.'
Assert-True (Test-Path -LiteralPath $shortcut) 'The Start menu shortcut is missing.'
foreach ($extension in $extensions) {
    $openWith = Get-RegistryValueState -Hive CurrentUser -SubKey "Software\Classes\$extension\OpenWithProgids" -Name 'LeanDoc.Document'
    Assert-True $openWith.Exists "Open With is missing for $extension."
    $capability = Get-RegistryValueState -Hive CurrentUser -SubKey 'Software\LeanDoc\Capabilities\FileAssociations' -Name $extension
    Assert-Equal ([string]$capability.Value) 'LeanDoc.Document' "Default Apps capability is missing for $extension."
}
$registered = Get-RegistryValueState -Hive CurrentUser -SubKey 'Software\RegisteredApplications' -Name 'LeanDoc'
Assert-True $registered.Exists 'LeanDoc is not in RegisteredApplications.'
Write-TestPass 'install.ps1 registered Open With and Default Apps for every extension'

$smoke = Invoke-LeanDocSmoke -ExePath $installedExe -DocumentPath $fixture
Assert-Equal $smoke.ExitCode 0 ("Smoke from the installed copy failed: " + $smoke.Output)
# A real launch creates the WebView2 user-data folder that uninstall removes.
$process = Start-LeanDocProcess -ExePath $installedExe -DocumentPaths @($fixture)
try {
    [void](Wait-LeanDocWindow -Process $process)
    Start-Sleep -Seconds 3
} finally {
    Stop-LeanDocTestProcessTree -RootProcess $process
}
Assert-True (Test-Path -LiteralPath (Join-Path $dataDir 'WebView2')) 'The WebView2 folder was not created by a launch.'
[void](Wait-WebView2Idle -TimeoutSeconds 30)
Write-TestPass 'the installed copy renders and runs'

$uninstaller = Join-Path $installDir 'uninstall.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uninstaller -Quiet | Out-Host
Assert-Equal $LASTEXITCODE 0 'uninstall.ps1 failed.'
$after = @(Get-State)
$difference = @(Compare-Object -ReferenceObject $before -DifferenceObject $after)
if ($difference.Count -gt 0) {
    $difference | Format-Table -AutoSize | Out-String | Write-Host
    throw 'Registry or files differ from the state before the install.'
}
Write-TestPass 'uninstall.ps1 restored the registry and removed every file, including the WebView2 folder'
Remove-Item -LiteralPath $extract -Recurse -Force
