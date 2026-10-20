[CmdletBinding()]
param([switch]$Quiet)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppName = 'LeanDoc'
$ExeName = 'LeanDoc.exe'
$ProgId = 'LeanDoc.Document'
$Extensions = @('.docx', '.dotx', '.docm', '.dotm', '.doc', '.rtf', '.odt')
$Capabilities = 'Software\LeanDoc\Capabilities'
$AppKey = 'HKCU:\Software\LeanDoc'
$Classes = 'HKCU:\Software\Classes'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LeanDoc'
$LocalData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$InstallDir = [IO.Path]::GetFullPath((Join-Path $LocalData 'Programs\LeanDoc')).TrimEnd('\')
$InstalledExe = Join-Path $InstallDir $ExeName

function Get-RegString {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $Property = (Get-ItemProperty -LiteralPath $Path).PSObject.Properties[$Name]
    if ($null -ne $Property) { return [string]$Property.Value }
    return $null
}

function Get-DefaultState {
    param([string]$SubKey)
    $Key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey, $false)
    if ($null -eq $Key) { return [pscustomobject]@{ Present = $false; Value = $null } }
    try {
        $Present = @($Key.GetValueNames()) -contains ''
        $Value = if ($Present) { $Key.GetValue('', $null) } else { $null }
        [pscustomobject]@{ Present = $Present; Value = $Value }
    } finally { $Key.Dispose() }
}

function Set-Or-RemoveDefault {
    param([string]$SubKey, [bool]$Present, [string]$Value)
    $Key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKey)
    if ($null -eq $Key) { throw 'Cannot write the per-user Classes key.' }
    try {
        if ($Present) {
            $Key.SetValue('', $Value, [Microsoft.Win32.RegistryValueKind]::String)
        } else {
            $Key.DeleteValue('', $false)
        }
    } finally { $Key.Dispose() }
}

# A registry value can be tampered with. File deletion is allowed only at the
# documented, fully resolved per-user install directory.
$Recorded = Get-RegString $AppKey 'InstallLocation'
if (-not $Recorded) { $Recorded = Get-RegString $UninstallKey 'InstallLocation' }
if ($Recorded) {
    $Resolved = [IO.Path]::GetFullPath($Recorded).TrimEnd('\')
    if (-not $Resolved.Equals($InstallDir, [StringComparison]::OrdinalIgnoreCase)) {
        throw ('Refusing unexpected install path: {0}' -f $Resolved)
    }
}
if (Test-Path -LiteralPath $InstallDir) {
    $Attributes = (Get-Item -LiteralPath $InstallDir -Force).Attributes
    if ($Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw ('Refusing reparse-point install path: {0}' -f $InstallDir)
    }
}

$StatePath = Join-Path $AppKey 'InstallState'
foreach ($Extension in $Extensions) {
    $SubKey = 'Software\Classes\' + $Extension
    $Current = Get-DefaultState $SubKey
    if ($Current.Present -and [string]$Current.Value -eq $ProgId) {
        $Stem = $Extension.TrimStart('.')
        $HadPrevious = $false
        $Previous = ''
        if (Test-Path -LiteralPath $StatePath) {
            $State = Get-ItemProperty -LiteralPath $StatePath
            $HadProperty = $State.PSObject.Properties[$Stem + '_HadPrevious']
            $PreviousProperty = $State.PSObject.Properties[$Stem + '_Previous']
            if ($null -ne $HadProperty) { $HadPrevious = [bool]$HadProperty.Value }
            if ($null -ne $PreviousProperty) { $Previous = [string]$PreviousProperty.Value }
        }
        Set-Or-RemoveDefault $SubKey $HadPrevious $Previous
    }
}

# Removes a per-user key only when nothing is left in it: no values, no
# default, and no subkeys. An install may have created it; an empty key
# carries no setting of anyone else's.
function Remove-EmptyUserKey {
    param([string]$SubKey)
    $Key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey, $false)
    if ($null -eq $Key) { return }
    try {
        $Empty = $Key.ValueCount -eq 0 -and $Key.SubKeyCount -eq 0
    } finally { $Key.Dispose() }
    if ($Empty) {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($SubKey, $false)
    }
}

foreach ($Extension in $Extensions) {
    # Remove only LeanDoc's value from the shared OpenWithProgids key.
    $OpenWith = Join-Path (Join-Path $Classes $Extension) 'OpenWithProgids'
    if (Test-Path -LiteralPath $OpenWith) {
        $Item = Get-ItemProperty -LiteralPath $OpenWith
        if ($null -ne $Item.PSObject.Properties[$ProgId]) {
            Remove-ItemProperty -LiteralPath $OpenWith -Name $ProgId -Force
        }
    }
    Remove-EmptyUserKey ('Software\Classes\' + $Extension + '\OpenWithProgids')
    Remove-EmptyUserKey ('Software\Classes\' + $Extension)
}

$RegisteredApps = 'HKCU:\Software\RegisteredApplications'
if ((Get-RegString $RegisteredApps $AppName) -eq $Capabilities) {
    Remove-ItemProperty -LiteralPath $RegisteredApps -Name $AppName -Force
}
Remove-EmptyUserKey 'Software\RegisteredApplications'

# These keys use LeanDoc-specific names and are wholly app-owned. The app key
# also holds the reader's theme, view, and recent files.
$OwnedKeys = @(
    (Join-Path $Classes $ProgId),
    (Join-Path $Classes 'Applications\LeanDoc.exe'),
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\LeanDoc.exe',
    $UninstallKey,
    $AppKey
)
foreach ($Key in $OwnedKeys) {
    if (Test-Path -LiteralPath $Key) {
        Remove-Item -LiteralPath $Key -Recurse -Force
    }
}

# Remove the shortcut only when it still targets this exact installation.
$StartMenu = [Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)
$ShortcutPath = Join-Path $StartMenu 'Programs\LeanDoc.lnk'
if (Test-Path -LiteralPath $ShortcutPath -PathType Leaf) {
    $Shell = New-Object -ComObject WScript.Shell
    try {
        $Target = $Shell.CreateShortcut($ShortcutPath).TargetPath
        if ($Target -and [IO.Path]::GetFullPath($Target).Equals(
            $InstalledExe, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $ShortcutPath -Force
        } else {
            Write-Warning ('Kept a shortcut that no longer targets LeanDoc: {0}' -f $ShortcutPath)
        }
    } finally {
        if ($null -ne $Shell) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Shell)
        }
    }
}

function Resolve-OwnedFile {
    param([string]$Relative)
    if (-not $Relative -or [IO.Path]::IsPathRooted($Relative)) { return $null }
    $Full = [IO.Path]::GetFullPath((Join-Path $InstallDir $Relative))
    if (-not $Full.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    $Cursor = $Full
    while ($Cursor.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $Cursor) {
            if ((Get-Item -LiteralPath $Cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                return $null
            }
        }
        if ($Cursor -eq $InstallDir) { break }
        $Cursor = Split-Path -Parent $Cursor
    }
    return $Full
}

$ManifestPath = Join-Path $InstallDir 'install-manifest.json'
$OwnedFiles = @()
$ValidManifest = $false
if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
    try {
        $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        $ManifestLocation = [IO.Path]::GetFullPath([string]$Manifest.installLocation).TrimEnd('\')
        $ValidManifest = ([int]$Manifest.schemaVersion -eq 1) -and
            ([string]$Manifest.applicationId -eq $AppName) -and
            $ManifestLocation.Equals($InstallDir, [StringComparison]::OrdinalIgnoreCase)
        if ($ValidManifest) { $OwnedFiles = @($Manifest.files) }
    } catch {
        Write-Warning 'Invalid install manifest; using the narrow fallback file list.'
    }
}
if (-not $ValidManifest) {
    $OwnedFiles = @(
        'LeanDoc.exe', 'WebView2Loader.dll', 'uninstall.ps1',
        'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'tools\leandoc-inspect.exe'
    )
}

Set-Location -LiteralPath $LocalData
foreach ($Relative in @($OwnedFiles | Sort-Object -Unique)) {
    $Owned = Resolve-OwnedFile ([string]$Relative)
    if ($Owned -and (Test-Path -LiteralPath $Owned -PathType Leaf)) {
        Remove-Item -LiteralPath $Owned -Force
    }
}
if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
    Remove-Item -LiteralPath $ManifestPath -Force
}

$OwnedDirectories = @($OwnedFiles | ForEach-Object {
    $Parent = Split-Path -Parent ([string]$_)
    if ($Parent) { $Parent }
} | Sort-Object { ([string]$_).Length } -Descending -Unique)
foreach ($Relative in $OwnedDirectories) {
    $Owned = Resolve-OwnedFile ([string]$Relative)
    if ($Owned -and (Test-Path -LiteralPath $Owned -PathType Container) -and
        $null -eq (Get-ChildItem -LiteralPath $Owned -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $Owned -Force
    }
}
if ((Test-Path -LiteralPath $InstallDir) -and
    $null -eq (Get-ChildItem -LiteralPath $InstallDir -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $InstallDir -Force
}

# LeanDoc.exe keeps one WebView2 user-data folder per user at
# %LOCALAPPDATA%\LeanDoc\WebView2 (src/windows/App.cpp). Remove exactly that
# folder, never through a link: a reparse point at the folder or its parent
# is refused, and a link inside it is removed as a link, not followed.
function Remove-TreeWithoutFollowing {
    param([string]$Directory)
    foreach ($Entry in [IO.Directory]::EnumerateFileSystemEntries($Directory)) {
        $EntryAttributes = [IO.File]::GetAttributes($Entry)
        $IsDirectory = [bool]($EntryAttributes -band [IO.FileAttributes]::Directory)
        if ($EntryAttributes -band [IO.FileAttributes]::ReparsePoint) {
            if ($IsDirectory) { [IO.Directory]::Delete($Entry, $false) }
            else { [IO.File]::Delete($Entry) }
        } elseif ($IsDirectory) {
            Remove-TreeWithoutFollowing $Entry
            [IO.Directory]::Delete($Entry, $false)
        } else {
            if ($EntryAttributes -band [IO.FileAttributes]::ReadOnly) {
                [IO.File]::SetAttributes($Entry, $EntryAttributes -band (-bnot [IO.FileAttributes]::ReadOnly))
            }
            [IO.File]::Delete($Entry)
        }
    }
}

$DataDir = [IO.Path]::GetFullPath((Join-Path $LocalData 'LeanDoc')).TrimEnd('\')
$WebViewDir = Join-Path $DataDir 'WebView2'
foreach ($Candidate in @($DataDir, $WebViewDir)) {
    if ((Test-Path -LiteralPath $Candidate) -and
        ((Get-Item -LiteralPath $Candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw ('Refusing reparse-point data path: {0}' -f $Candidate)
    }
}
if (Test-Path -LiteralPath $WebViewDir -PathType Container) {
    try {
        Remove-TreeWithoutFollowing $WebViewDir
        [IO.Directory]::Delete($WebViewDir, $false)
    } catch {
        Write-Warning ('Could not remove {0}; close LeanDoc and run the uninstaller again. {1}' -f
            $WebViewDir, $_.Exception.Message)
    }
}
if ((Test-Path -LiteralPath $DataDir -PathType Container) -and
    $null -eq (Get-ChildItem -LiteralPath $DataDir -Force | Select-Object -First 1)) {
    [IO.Directory]::Delete($DataDir, $false)
}

if (-not ('LeanDocRemove.Native' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace LeanDocRemove {
 public static class Native {
    [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(UInt32 e,UInt32 f,IntPtr a,IntPtr b);
 }
}
'@
}
[LeanDocRemove.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
if (-not $Quiet) {
    Write-Host 'LeanDoc registration and installer-owned files were removed.'
    Write-Host 'Windows UserChoice values were not changed.'
}
