[CmdletBinding()]
param(
    [string]$SourceDirectory,
    [switch]$OpenDefaultAppsSettings,
    [switch]$Quiet,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Centralized per-user identifiers keep registration and cleanup auditable.
$AppName = 'LeanDoc'
$ExeName = 'LeanDoc.exe'
$ProgId = 'LeanDoc.Document'
$Extensions = @('.docx', '.dotx', '.docm', '.dotm', '.doc', '.rtf', '.odt')
$FallbackVersion = '0.1.3'
$Capabilities = 'Software\LeanDoc\Capabilities'
$AppKey = 'HKCU:\Software\LeanDoc'
$Classes = 'HKCU:\Software\Classes'
$LocalData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$InstallDir = [IO.Path]::GetFullPath((Join-Path $LocalData 'Programs\LeanDoc')).TrimEnd('\')
$InstalledExe = Join-Path $InstallDir $ExeName
$ManifestPath = Join-Path $InstallDir 'install-manifest.json'
$ExistingInstall = Test-Path -LiteralPath $ManifestPath -PathType Leaf

function Resolve-Payload {
    param([string]$Requested)
    $Root = Split-Path -Parent $PSScriptRoot
    $Candidates = if ($Requested) {
        @($Requested)
    } else {
        @($Root, (Join-Path $Root 'dist'))
    }
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath (Join-Path $Candidate $ExeName) -PathType Leaf) {
            return [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Candidate).Path).TrimEnd('\')
        }
    }
    throw 'LeanDoc.exe was not found. Extract the release ZIP, build with scripts\build.ps1, or pass -SourceDirectory.'
}

function Test-PortableExecutable {
    param([string]$Path)
    $Stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try { return $Stream.ReadByte() -eq 0x4D -and $Stream.ReadByte() -eq 0x5A }
    finally { $Stream.Dispose() }
}

$Payload = Resolve-Payload $SourceDirectory
$RequiredPayload = @('LeanDoc.exe', 'WebView2Loader.dll', 'assets\reader.html', 'assets\reader.js', 'assets\reader.css')
foreach ($Relative in $RequiredPayload) {
    $Path = Join-Path $Payload $Relative
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw ('Required payload file is missing: {0}' -f $Path)
    }
}
foreach ($Binary in @('LeanDoc.exe', 'WebView2Loader.dll')) {
    if (-not (Test-PortableExecutable (Join-Path $Payload $Binary))) {
        throw ('{0} is not a Windows executable image.' -f $Binary)
    }
}

# Reads the default value of Software\Classes\<ext> in one hive and view.
function Get-HiveDefault {
    param([Microsoft.Win32.RegistryHive]$Hive, [Microsoft.Win32.RegistryView]$View, [string]$SubKey)
    $Base = $null
    $Key = $null
    try {
        $Base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
        $Key = $Base.OpenSubKey($SubKey, $false)
        if ($null -eq $Key) { return [pscustomobject]@{ Present = $false; Value = $null } }
        $Present = @($Key.GetValueNames()) -contains ''
        $Value = if ($Present) { [string]$Key.GetValue('', $null) } else { $null }
        return [pscustomobject]@{ Present = $Present; Value = $Value }
    } catch {
        return [pscustomobject]@{ Present = $false; Value = $null }
    } finally {
        if ($null -ne $Key) { $Key.Dispose() }
        if ($null -ne $Base) { $Base.Dispose() }
    }
}

# LeanDoc takes the per-user default for an extension only when nothing else
# owns it: no UserChoice, and no default value in HKCU or HKLM
# Software\Classes\<ext> (a deployed Word or LibreOffice often sets HKLM
# without any UserChoice). A HKCU value that is LeanDoc's own counts as free.
# Otherwise LeanDoc is only offered through Open With and Default Apps.
function Test-ExtensionUnclaimed {
    param([string]$Extension)
    $SubKey = 'Software\Classes\' + $Extension
    $UserChoice = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\' + $Extension + '\UserChoice'
    if (Test-Path -LiteralPath $UserChoice) { return $false }
    foreach ($View in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $Machine = Get-HiveDefault ([Microsoft.Win32.RegistryHive]::LocalMachine) $View $SubKey
        if ($Machine.Present -and $Machine.Value) { return $false }
    }
    $User = Get-HiveDefault ([Microsoft.Win32.RegistryHive]::CurrentUser) ([Microsoft.Win32.RegistryView]::Default) $SubKey
    if ($User.Present -and $User.Value -and $User.Value -ne $ProgId) { return $false }
    return $true
}

if ($ValidateOnly) {
    # Reads only. Nothing is copied and no registry value is written.
    $PayloadVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $Payload $ExeName)).ProductVersion
    if (-not $PayloadVersion) { $PayloadVersion = $FallbackVersion }
    Write-Output ('Validated LeanDoc {0} payload in {1}.' -f $PayloadVersion, $Payload)
    Write-Output ('An install would copy it to {0} and register {1} for Open With and Default Apps.' -f
        $InstallDir, ($Extensions -join ' '))
    Write-Output ('It would make LeanDoc the per-user default for an extension only when that extension has no ' +
        'UserChoice and no default in HKCU or HKLM Software\Classes. For every other extension it would only ' +
        'add LeanDoc to Open With and Default Apps.')
    foreach ($Extension in $Extensions) {
        if (Test-ExtensionUnclaimed $Extension) {
            Write-Output ('  {0}: no default exists; LeanDoc would become the per-user default.' -f $Extension)
        } else {
            Write-Output ('  {0}: another app is the default; LeanDoc would be offered in Open With and Default Apps only.' -f $Extension)
        }
    }
    Write-Output 'It would never write UserChoice, so Windows keeps every default-app choice.'
    exit 0
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

function Set-DefaultValue {
    param([string]$SubKey, [string]$Value)
    $Key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKey)
    if ($null -eq $Key) { throw 'Cannot write the per-user Classes key.' }
    try { $Key.SetValue('', $Value, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $Key.Dispose() }
}

function Ensure-RegKey {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
}

function Set-RegString {
    param([string]$Path, [string]$Name, [string]$Value)
    Ensure-RegKey $Path
    if ($Name) {
        New-ItemProperty -LiteralPath $Path -Name $Name -Value $Value -PropertyType String -Force | Out-Null
    } else {
        Set-Item -LiteralPath $Path -Value $Value
    }
}

function Register-Extension {
    param([string]$Extension)
    $SubKey = 'Software\Classes\' + $Extension
    $UserChoice = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\' + $Extension + '\UserChoice'
    $OpenWith = Join-Path (Join-Path $Classes $Extension) 'OpenWithProgids'
    Ensure-RegKey $OpenWith
    New-ItemProperty -LiteralPath $OpenWith -Name $ProgId -Value '' -PropertyType String -Force | Out-Null

    # Never alter or delete protected UserChoice. Write the direct Classes
    # default only when no app owns the extension (Test-ExtensionUnclaimed).
    if (Test-ExtensionUnclaimed $Extension) {
        $Old = Get-DefaultState $SubKey
        $State = Join-Path $AppKey 'InstallState'
        $Stem = $Extension.TrimStart('.')
        Ensure-RegKey $State
        $StateItem = Get-ItemProperty -LiteralPath $State
        $HadName = $Stem + '_HadPrevious'
        $PreviousName = $Stem + '_Previous'
        $HadProperty = $StateItem.PSObject.Properties[$HadName]
        $PreviousProperty = $StateItem.PSObject.Properties[$PreviousName]
        $RecordedSelfAsPrevious =
            $null -ne $HadProperty -and [bool]$HadProperty.Value -and
            $null -ne $PreviousProperty -and
            [string]$PreviousProperty.Value -eq $ProgId

        # Repair state left by an interrupted or older LeanDoc install. The
        # app's own ProgID is never a useful value to restore on uninstall.
        if ($ExistingInstall -and $Old.Present -and
            [string]$Old.Value -eq $ProgId -and
            ($null -eq $HadProperty -or $RecordedSelfAsPrevious)) {
            Set-RegString $State $PreviousName ''
            New-ItemProperty -LiteralPath $State -Name $HadName -Value 0 -PropertyType DWord -Force | Out-Null
        } elseif ($null -eq $HadProperty) {
            Set-RegString $State $PreviousName ([string]$Old.Value)
            New-ItemProperty -LiteralPath $State -Name $HadName -Value ([int]$Old.Present) -PropertyType DWord -Force | Out-Null
        }
        Set-DefaultValue $SubKey $ProgId
        return $true
    }
    return $false
}

# Notify Explorer after all registration changes are complete.
if (-not ('LeanDocSetup.Native' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace LeanDocSetup {
 public static class Native {
    [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(UInt32 e,UInt32 f,IntPtr a,IntPtr b);
    [DllImport("shlwapi.dll",CharSet=CharSet.Unicode)]
  public static extern UInt32 AssocQueryString(UInt32 f,UInt32 s,string a,string x,StringBuilder o,ref UInt32 n);
 }
}
'@
}

function Get-EffectiveExe {
    param([string]$Extension)
    $Buffer = [Text.StringBuilder]::new(2048)
    [uint32]$Length = $Buffer.Capacity
    $Result = [LeanDocSetup.Native]::AssocQueryString(0, 2, $Extension, 'open', $Buffer, [ref]$Length)
    if ($Result -eq 0) { return $Buffer.ToString() }
    return $null
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$OwnedFiles = [Collections.Generic.List[string]]::new()
foreach ($Name in @('LeanDoc.exe', 'WebView2Loader.dll', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md')) {
    $Source = Join-Path $Payload $Name
    if (Test-Path -LiteralPath $Source -PathType Leaf) {
        Copy-Item -LiteralPath $Source -Destination (Join-Path $InstallDir $Name) -Force
        $OwnedFiles.Add($Name)
    }
}

# The reader assets and the inspect tool are copied as trees, skipping links.
foreach ($Tree in @('assets', 'tools')) {
    $TreeRoot = Join-Path $Payload $Tree
    if (-not (Test-Path -LiteralPath $TreeRoot -PathType Container)) { continue }
    $TreePrefix = $TreeRoot.TrimEnd('\') + '\'
    foreach ($Item in Get-ChildItem -LiteralPath $TreeRoot -File -Recurse) {
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $Relative = $Tree + '\' + $Item.FullName.Substring($TreePrefix.Length)
        $Destination = Join-Path $InstallDir $Relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        Copy-Item -LiteralPath $Item.FullName -Destination $Destination -Force
        $OwnedFiles.Add($Relative)
    }
}

$UninstallSource = Join-Path $PSScriptRoot 'uninstall.ps1'
if (-not (Test-Path -LiteralPath $UninstallSource -PathType Leaf)) {
    throw 'installer\uninstall.ps1 is missing.'
}
Copy-Item -LiteralPath $UninstallSource -Destination (Join-Path $InstallDir 'uninstall.ps1') -Force
$OwnedFiles.Add('uninstall.ps1')

# This allow-list lets uninstall remove app-owned files without deleting an
# unknown file that the user later places in LeanDoc's directory.
$Manifest = [ordered]@{
    schemaVersion = 1
    applicationId = $AppName
    installLocation = $InstallDir
    files = @($OwnedFiles | Sort-Object -Unique)
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

$Quote = [char]34
$OpenCommand = $Quote + $InstalledExe + $Quote + ' -- ' + $Quote + '%1' + $Quote
Set-RegString $AppKey 'InstallLocation' $InstallDir
Set-RegString $AppKey 'ExecutablePath' $InstalledExe
Set-RegString (Join-Path $AppKey 'Capabilities') 'ApplicationName' $AppName
Set-RegString (Join-Path $AppKey 'Capabilities') 'ApplicationDescription' 'Read Word documents without opening an office suite.'
Set-RegString (Join-Path $AppKey 'Capabilities') 'ApplicationIcon' ($InstalledExe + ',0')
foreach ($Extension in $Extensions) {
    Set-RegString (Join-Path $AppKey 'Capabilities\FileAssociations') $Extension $ProgId
}
Set-RegString 'HKCU:\Software\RegisteredApplications' $AppName $Capabilities

$ProgPath = Join-Path $Classes $ProgId
Set-RegString $ProgPath '' 'Document'
Set-RegString (Join-Path $ProgPath 'DefaultIcon') '' ($InstalledExe + ',0')
Set-RegString (Join-Path $ProgPath 'shell\open') 'MultiSelectModel' 'Document'
Set-RegString (Join-Path $ProgPath 'shell\open\command') '' $OpenCommand

$ApplicationPath = Join-Path $Classes ('Applications\' + $ExeName)
Set-RegString $ApplicationPath 'FriendlyAppName' $AppName
Set-RegString (Join-Path $ApplicationPath 'shell\open\command') '' $OpenCommand
foreach ($Extension in $Extensions) {
    Set-RegString (Join-Path $ApplicationPath 'SupportedTypes') $Extension ''
}

$AppPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\LeanDoc.exe'
Set-RegString $AppPath '' $InstalledExe
Set-RegString $AppPath 'Path' $InstallDir

$Direct = [Collections.Generic.List[string]]::new()
foreach ($Extension in $Extensions) {
    if (Register-Extension $Extension) { $Direct.Add($Extension) }
}

$StartMenu = [Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)
$ShortcutPath = Join-Path $StartMenu 'Programs\LeanDoc.lnk'
$Shell = New-Object -ComObject WScript.Shell
try {
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $InstalledExe
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = 'Read Word documents with LeanDoc'
    $Shortcut.IconLocation = $InstalledExe + ',0'
    $Shortcut.Save()
} finally {
    if ($null -ne $Shell) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Shell)
    }
}

$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LeanDoc'
$InstalledUninstaller = Join-Path $InstallDir 'uninstall.ps1'
$UninstallCommand = $Quote + (Join-Path $PSHOME 'powershell.exe') + $Quote +
    ' -NoProfile -ExecutionPolicy Bypass -File ' + $Quote + $InstalledUninstaller + $Quote
$Version = [Diagnostics.FileVersionInfo]::GetVersionInfo($InstalledExe).ProductVersion
if (-not $Version) { $Version = $FallbackVersion }
Set-RegString $UninstallKey 'DisplayName' $AppName
Set-RegString $UninstallKey 'DisplayVersion' $Version
Set-RegString $UninstallKey 'DisplayIcon' ($InstalledExe + ',0')
Set-RegString $UninstallKey 'Publisher' 'Abdulfatah Bahbouh'
Set-RegString $UninstallKey 'InstallLocation' $InstallDir
Set-RegString $UninstallKey 'UninstallString' $UninstallCommand
Set-RegString $UninstallKey 'QuietUninstallString' ($UninstallCommand + ' -Quiet')
New-ItemProperty -LiteralPath $UninstallKey -Name 'NoModify' -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -LiteralPath $UninstallKey -Name 'NoRepair' -Value 1 -PropertyType DWord -Force | Out-Null

[LeanDocSetup.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 300
$Status = foreach ($Extension in $Extensions) {
    $Effective = Get-EffectiveExe $Extension
    $IsDefault = $false
    if ($Effective) {
        try {
            $IsDefault = [IO.Path]::GetFullPath($Effective).Equals(
                $InstalledExe, [StringComparison]::OrdinalIgnoreCase)
        } catch { $IsDefault = $false }
    }
    [pscustomobject]@{
        Extension = $Extension
        IsDefault = $IsDefault
        EffectiveExecutable = $Effective
    }
}
$Missing = @($Status | Where-Object { -not $_.IsDefault })
Write-Host ('LeanDoc installed to {0}' -f $InstallDir)
$Status | Format-Table -AutoSize | Out-Host

if ($Missing.Count -gt 0) {
    Write-Warning ('Windows still uses another app for: {0}. UserChoice was preserved.' -f ($Missing.Extension -join ', '))
    $Launch = $OpenDefaultAppsSettings.IsPresent
    if (-not $Launch -and -not $Quiet -and $Host.Name -eq 'ConsoleHost') {
        try {
            if (-not [Console]::IsInputRedirected) {
                $Launch = (Read-Host 'Open Windows Default Apps for LeanDoc? [y/N]') -match '^(?i:y|yes)$'
            }
        } catch { $Launch = $false }
    }
    if ($Launch) {
        try {
            Start-Process 'ms-settings:defaultapps?registeredAppUser=LeanDoc' | Out-Null
        } catch {
            Start-Process 'ms-settings:defaultapps' | Out-Null
        }
    } else {
        Write-Host 'Finish later in Windows Settings > Apps > Default apps > LeanDoc.'
    }
} else {
    Write-Host 'LeanDoc is the effective default for all registered document extensions.'
}
