[CmdletBinding()]
param(
    [string]$DistPath,
    [switch]$Smoke,
    [switch]$Runtime,
    [switch]$Registry,
    [switch]$RequireDefaultAssociation,
    [ValidateRange(1, 200)][double]$MaxDistributionMiB = 40
)

# Windows checks for LeanDoc, modelled on LeanMark's Test-LeanMark.ps1:
#   always   static invariants of the host and installer sources, the dist
#            payload allow-list, and install.ps1 -ValidateOnly
#   -Smoke   LeanDoc.exe --smoke-test on a document and on a fallback file
#   -Runtime tabs: a two-file launch and a forwarded later launch share one window
#   -Registry read-only checks after a deliberate per-user install

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$testsRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$repoRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $testsRoot))
if ([string]::IsNullOrWhiteSpace($DistPath)) { $DistPath = Join-Path $repoRoot 'dist' }
$resolvedDist = [System.IO.Path]::GetFullPath($DistPath)
$fixtures = Join-Path $testsRoot 'hosts\fixtures'
$extensions = @('.docx', '.dotx', '.docm', '.dotm', '.doc', '.rtf', '.odt')
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force

function Test-PeHeader {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try { return $stream.ReadByte() -eq 0x4D -and $stream.ReadByte() -eq 0x5A }
    finally { $stream.Dispose() }
}

function Test-StaticInvariants {
    $app = Read-TextFile (Join-Path $repoRoot 'src\windows\App.cpp')
    $main = Read-TextFile (Join-Path $repoRoot 'src\windows\main.cpp')
    $editor = Read-TextFile (Join-Path $repoRoot 'src\windows\Editor.cpp')
    $platform = Read-TextFile (Join-Path $repoRoot 'src\windows\Platform.cpp')
    $manifestTemplate = Read-TextFile (Join-Path $repoRoot 'src\windows\LeanDoc.manifest.in')
    $installer = Read-TextFile (Join-Path $repoRoot 'installer\install.ps1')
    $uninstaller = Read-TextFile (Join-Path $repoRoot 'installer\uninstall.ps1')
    $hosts = Read-TextFile (Join-Path $repoRoot 'cmake\Hosts.cmake')

    $manifestText = $manifestTemplate.Replace('@PROJECT_VERSION@', '0.0.0')
    try { [void]([xml]$manifestText) }
    catch { throw "LeanDoc.manifest.in is not well-formed XML: $($_.Exception.Message)" }
    Assert-Match $manifestText 'level\s*=\s*"asInvoker"' 'LeanDoc must run as the current user without elevation.'
    Assert-Match $manifestText 'PerMonitorV2' 'The application manifest must keep per-monitor DPI awareness.'
    Assert-Match $manifestText '<longPathAware[^>]*>\s*true\s*</longPathAware>' 'Long Windows paths must stay enabled.'
    Write-TestPass 'well-formed, non-elevating, DPI-aware application manifest'

    Assert-Match $app 'kAppHost\[\]\s*=\s*L"app\.leandoc\.invalid"' 'The app origin changed unexpectedly.'
    Assert-Match $app 'kAppFilter\[\]\s*=\s*L"https://app\.leandoc\.invalid/\*"' 'The host must answer the whole app origin.'
    Assert-Match $app 'kPackagePrefix\[\]\s*=\s*"https://app\.leandoc\.invalid/pkg/"' 'Packages must be served under /pkg/ of the app origin.'
    Assert-NotMatch $app 'SetVirtualHostNameToFolderMapping' 'No folder may be mapped into the web view.'
    Assert-Match $app 'AddWebResourceRequestedFilter\(kAppFilter' 'App requests must go through the host.'
    Assert-Match $app 'core::IsPathWithin\(std::filesystem::path\(assetDirectory_\)' 'Assets must stay inside the assets folder.'
    Assert-Match $app 'segment == "\." \|\| segment == "\.\."' 'Dot segments must be refused.'
    Assert-Match $app 'tab != packageTab_ \|\| generation != packageGeneration_ \|\| tab != activeTab_' 'Only the active package may be served.'
    Assert-Match $app 'respond\(nullptr, 404' 'Unknown package paths must answer 404.'
    Assert-Match $app 'X-Content-Type-Options: nosniff' 'Package responses must not be sniffed.'
    foreach ($guard in @(
        'put_AreDevToolsEnabled\(FALSE\)',
        'put_AreDefaultScriptDialogsEnabled\(FALSE\)',
        'add_NavigationStarting',
        'add_NewWindowRequested',
        'put_Handled\(TRUE\)',
        'add_PermissionRequested',
        'COREWEBVIEW2_PERMISSION_STATE_DENY',
        'add_DownloadStarting',
        'get_Source\(&rawSource\)'
    )) { Assert-Match $app $guard "WebView2 guard is missing: $guard" }
    Assert-Match $app '(?s)add_DownloadStarting.*?put_Cancel\(TRUE\)' 'WebView2 downloads must be cancelled.'
    Assert-Match $app 'SetCurrentProcessExplicitAppUserModelID\(L"LeanDoc\.Reader"\)' 'The AppUserModelID must stay stable.'
    Assert-Match $app 'ShellExecuteW\(window_, L"open", wide\.c_str\(\), nullptr' 'Links must use ShellExecuteW directly, never a command shell.'
    Assert-Match $app 'LeanDoc opens web and email links only' 'Only web and mail links may open.'
    Assert-Match $app 'PostWebMessageAsJson' 'Host messages must arrive through chrome.webview.'
    Write-TestPass 'WebView2 origin, package, navigation, permission, download, and link guards'

    Assert-Match $main 'CommandLineToArgvW' 'Windows command lines must use the system parser.'
    Assert-Match $main 'argument\s*==\s*L"--"' 'The option terminator must be supported for dash-prefixed file names.'
    Assert-Match $main 'argument\s*==\s*L"--smoke-test"' 'The smoke test option must exist.'
    Assert-Match $main 'CreateMutexW' 'A second launch must find the running reader through its mutex.'
    Assert-Match $main 'QueryFullProcessImageNameW' 'Forwarding must stay within the same executable path.'
    Assert-Match $main 'AllowSetForegroundWindow' 'The forwarding launch must pass on its right to take the foreground.'
    Assert-Match $main 'WM_COPYDATA' 'Documents must be forwarded with WM_COPYDATA.'
    Assert-Match $app 'data->dwData != kOpenDocumentsCopyData' 'Forwarded requests must carry the LeanDoc marker.'
    Assert-Match $app 'kMaximumForwardedPaths' 'Forwarded requests must be bounded.'
    Write-TestPass 'command-line parsing and single-window forwarding of later launches'

    Assert-Match $editor 'CreateProcessW\(' 'Editors must start through CreateProcessW.'
    Assert-Match $editor 'BuildCommandLine\(\{executable, path\}\)' 'Editors must get a quoted argument vector.'
    Assert-NotMatch $editor '(?i)cmd\.exe|cmd /c|_wsystem|\bsystem\(' 'Editors must never start through a command shell.'
    Assert-Match $editor 'WINWORD\.EXE' 'Word must be found through App Paths.'
    Assert-Match $editor 'Word\.Document\.12' 'Word must also be found through its ProgID.'
    Assert-Match $editor 'soffice\.exe' 'LibreOffice must be found.'
    Assert-Match $editor 'ASSOCSTR_FRIENDLYAPPNAME' 'The default app needs its friendly name.'
    Assert-Match $platform 'FILE_SHARE_READ \| FILE_SHARE_WRITE \| FILE_SHARE_DELETE' 'Files must be read without blocking editors.'
    Assert-Match $platform 'core::OpenDocumentBytes' 'The host must hand bytes to the core.'
    Write-TestPass 'open-in-editor resolution and argument-vector launch'

    Assert-Match $app 'put_EnableTrackingPrevention\(FALSE\)' 'Tracking prevention stays off; the reader loads no third-party content.'
    Assert-Match $app 'put_IsReputationCheckingRequired\(FALSE\)' 'SmartScreen checks stay off; the reader blocks downloads and navigation.'
    Assert-Match $app 'put_MemoryUsageTargetLevel' 'A minimized reader must ask WebView2 to trim memory.'
    Assert-Match $app 'TrySuspend' 'A minimized reader must suspend its renderer.'
    Assert-Match $app 'L"LeanDoc" / L"WebView2"' 'One WebView2 user-data folder per user must be used.'
    Assert-Match $hosts 'WebView2Loader\.dll' 'The loader DLL must ship beside LeanDoc.exe.'
    Write-TestPass 'WebView2 environment and memory policies'

    Assert-Match $installer '\$ProgId\s*=\s*''LeanDoc\.Document''' 'Installer ProgID is missing or inconsistent.'
    Assert-Match $installer '\$Capabilities\s*=\s*''Software\\LeanDoc\\Capabilities''' 'Installer capabilities path is missing.'
    Assert-Match $installer 'LocalApplicationData' 'Installation must target the current user LocalAppData.'
    Assert-Match $installer "'\.docx',\s*'\.dotx',\s*'\.docm',\s*'\.dotm',\s*'\.doc',\s*'\.rtf',\s*'\.odt'" 'Installer extension coverage differs from the spec.'
    Assert-Match $installer 'OpenWithProgids' 'Installer must register Open With candidacy.'
    Assert-Match $installer 'RegisteredApplications' 'Installer must register Default Apps capabilities.'
    Assert-Match $installer 'MultiSelectModel' 'Installer must declare a Shell multi-select model.'
    Assert-Match $installer 'SHChangeNotify' 'Installer must notify Explorer after association changes.'
    Assert-Match $installer 'registeredAppUser=LeanDoc' 'Installer must deep-link to the per-user Default Apps page.'
    Assert-Match $installer '\$OpenCommand\s*=.*'' -- ''' 'File associations must keep the option terminator.'
    Assert-Match $installer '(?s)if \(\$ValidateOnly\) \{.*?exit 0' 'install.ps1 must support -ValidateOnly.'
    Assert-True (
        $installer.IndexOf('if ($ValidateOnly)', [StringComparison]::Ordinal) -lt
        $installer.IndexOf('New-Item -ItemType Directory -Path $InstallDir', [StringComparison]::Ordinal)
    ) '-ValidateOnly must exit before anything is written.'
    Assert-NotMatch $installer '(?i)HKLM:|HKEY_LOCAL_MACHINE|SetUserFTA|\bDISM\b|\bftype\b|\bassoc(?:\.exe)?\b' 'The per-user installer contains a machine-wide or unsupported association mechanism.'
    $userChoiceLines = @($installer -split "`r?`n" | Where-Object {
        $_ -match '\$UserChoice' -and $_.TrimStart() -notmatch '^#'
    })
    Assert-True ($userChoiceLines.Count -gt 0) 'Installer must explicitly check the protected UserChoice boundary.'
    foreach ($line in $userChoiceLines) {
        Assert-Match $line '^\s*\$UserChoice\s*=|Test-Path\s+-LiteralPath\s+\$UserChoice' "UserChoice may only be declared or queried, never changed: $line"
    }
    Assert-NotMatch $uninstaller '(?i)HKLM:|HKEY_LOCAL_MACHINE|SetUserFTA|Explorer\\FileExts\\[^\r\n]*UserChoice' 'The uninstaller contains a machine-wide or protected UserChoice operation.'
    Assert-Match $uninstaller 'Remove only LeanDoc''s value from the shared OpenWithProgids key' 'Shared Open With cleanup must stay value-scoped.'
    Assert-Match $uninstaller 'Resolve-OwnedFile' 'Uninstall file deletion must pass through the owned-path resolver.'
    Assert-Match $uninstaller 'ReparsePoint' 'Uninstall must reject reparse-point traversal.'
    Assert-NotMatch $uninstaller '(?im)^\s*Remove-Item[^\r\n]*\$InstallDir[^\r\n]*-Recurse' 'Uninstall must never recursively delete the install directory.'
    foreach ($scriptCase in @(
        [pscustomobject]@{ Name = 'installer'; Text = $installer },
        [pscustomobject]@{ Name = 'uninstaller'; Text = $uninstaller }
    )) {
        $blocks = [regex]::Matches($scriptCase.Text, "(?s)Add-Type\s+-TypeDefinition\s+@'\s*(.*?)\s*'@")
        Assert-True ($blocks.Count -ge 1) "$($scriptCase.Name) must contain its Shell notification Add-Type block."
        foreach ($block in $blocks) {
            try { Add-Type -TypeDefinition $block.Groups[1].Value -ErrorAction Stop }
            catch { throw ("Embedded C# in {0} does not compile: {1}" -f $scriptCase.Name, $_.Exception.Message) }
        }
    }
    foreach ($script in @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'installer') -Filter '*.ps1') +
                        @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts') -Filter '*.ps1') +
                        @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tests\owner') -Filter '*.ps1')) {
        $tokens = $null
        $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors)
        Assert-Equal @($errors).Count 0 ("PowerShell parse errors in {0}: {1}" -f $script.Name, (@($errors) -join '; '))
    }
    Write-TestPass 'per-user installer, consent-preserving uninstaller, and script parsing'
}

function Test-Distribution {
    Assert-True (Test-Path -LiteralPath $resolvedDist -PathType Container) "Distribution is missing: $resolvedDist. Run scripts\build.ps1 first."
    $required = @(
        'LeanDoc.exe', 'WebView2Loader.dll', 'tools\leandoc-inspect.exe',
        'assets\reader.html', 'assets\reader.css', 'assets\reader.js',
        'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
        'installer\install.ps1', 'installer\uninstall.ps1'
    )
    foreach ($relative in $required) {
        $path = Join-Path $resolvedDist $relative
        Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "Required distribution file is missing: $relative"
        Assert-True ((Get-Item -LiteralPath $path).Length -gt 0) "Distribution file is empty: $relative"
    }
    foreach ($binary in @('LeanDoc.exe', 'WebView2Loader.dll', 'tools\leandoc-inspect.exe')) {
        Assert-True (Test-PeHeader (Join-Path $resolvedDist $binary)) "$binary does not have a PE MZ header."
    }

    # Every file must be on the allow-list: the executables, the documents,
    # and reader assets of web types. Nothing from a build tree may slip in.
    $prefix = $resolvedDist.TrimEnd('\') + '\'
    $files = @(Get-ChildItem -LiteralPath $resolvedDist -Recurse -File)
    $unexpected = @($files | ForEach-Object { $_.FullName.Substring($prefix.Length) } | Where-Object {
        $_ -notin @('LeanDoc.exe', 'WebView2Loader.dll', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
                    'tools\leandoc-inspect.exe', 'installer\install.ps1', 'installer\uninstall.ps1') -and
        $_ -notmatch '^assets\\[A-Za-z0-9._\\-]+\.(html|css|js|mjs|json|woff2|woff|ttf|svg|png)$'
    })
    Assert-Equal $unexpected.Count 0 ('Files outside the payload allow-list: ' + ($unexpected -join ', '))
    $bytes = [int64](($files | Measure-Object -Property Length -Sum).Sum)
    Assert-True ($bytes -le $MaxDistributionMiB * 1MB) ("Distribution is {0:N2} MiB, over the {1:N2} MiB gate." -f ($bytes / 1MB), $MaxDistributionMiB)
    foreach ($entryAsset in @('reader.html', 'reader.css', 'reader.js')) {
        $source = Join-Path (Join-Path $repoRoot 'assets') $entryAsset
        $staged = Join-Path (Join-Path $resolvedDist 'assets') $entryAsset
        Assert-Equal (Read-TextFile $staged) (Read-TextFile $source) "Staged $entryAsset differs from its source."
    }
    Write-TestPass ("complete, allow-listed distribution ({0} files, {1:N2} MiB)" -f $files.Count, ($bytes / 1MB))
}

function Get-InstallFootprint {
    $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    [pscustomobject]@{
        Directory = Test-Path -LiteralPath (Join-Path $localData 'Programs\LeanDoc')
        AppKey = (Get-RegistryValueState -Hive CurrentUser -SubKey 'Software\LeanDoc\Capabilities' -Name 'ApplicationName').KeyExists
        ProgId = (Get-RegistryValueState -Hive CurrentUser -SubKey 'Software\Classes\LeanDoc.Document' -Name '').KeyExists
        Uninstall = (Get-RegistryValueState -Hive CurrentUser -SubKey 'Software\Microsoft\Windows\CurrentVersion\Uninstall\LeanDoc' -Name 'DisplayName').KeyExists
    }
}

function Test-ValidateOnly {
    $before = Get-InstallFootprint | ConvertTo-Json -Compress
    # The copy inside the payload finds LeanDoc.exe one folder up, as in the ZIP.
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedDist 'installer\install.ps1') `
        -ValidateOnly 2>&1
    Assert-Equal $LASTEXITCODE 0 ("install.ps1 -ValidateOnly failed: " + ($output -join ' '))
    Assert-Match ($output -join "`n") 'Validated LeanDoc' 'install.ps1 -ValidateOnly did not report the payload.'
    $after = Get-InstallFootprint | ConvertTo-Json -Compress
    Assert-Equal $after $before 'install.ps1 -ValidateOnly changed files or the registry.'
    Write-TestPass 'install.ps1 -ValidateOnly accepts the payload and changes nothing'
}

function Test-Smoke {
    $exe = Join-Path $resolvedDist 'LeanDoc.exe'
    $result = Invoke-LeanDocSmoke -ExePath $exe -DocumentPath (Join-Path $fixtures 'smoke.docx')
    Write-TestNote ("smoke output: {0} ({1} ms)" -f $result.Output, $result.Milliseconds)
    Assert-Equal $result.ExitCode 0 'LeanDoc --smoke-test did not render the smoke document.'
    Assert-Match $result.Output 'PASS' 'The smoke test did not report PASS.'
    $fallback = Invoke-LeanDocSmoke -ExePath $exe -DocumentPath (Join-Path $fixtures 'plain.rtf')
    Assert-Equal $fallback.ExitCode 1 'A file without a renderable package must fail the smoke test.'
    Write-TestPass 'WebView2 smoke test renders a document and rejects a fallback file'

    # SPEC section 5 test hooks: --trace-timing reports every event and
    # --exit-after-render closes LeanDoc on its own after the first page.
    [void](Wait-WebView2Idle -TimeoutSeconds 30)
    $launch = Measure-LeanDocLaunch -ExePath $exe -DocumentPaths @(Join-Path $fixtures 'smoke.docx') `
        -SettleMilliseconds 500 -SampleCount 1
    Assert-True ($null -eq $launch.Failure) ("The timed launch failed: {0}" -f $launch.Failure)
    foreach ($event in @('process-start', 'window-visible', 'webview-ready',
            'document-requested', 'package-served', 'rendered')) {
        Assert-True $launch.Events.Contains($event) "--trace-timing did not report $event."
    }
    Assert-True ($launch.Events['webview-ready'] -ge $launch.Events['window-visible']) 'webview-ready came before window-visible.'
    Assert-True ($launch.Events['rendered'] -ge $launch.Events['package-served']) 'rendered came before package-served.'
    Assert-True ($launch.Pages -ge 1) 'The rendered event reported no pages.'
    Assert-True $launch.ExitedOnItsOwn '--exit-after-render did not close LeanDoc.'
    Assert-Equal $launch.ExitCode 0 'LeanDoc did not exit cleanly after --exit-after-render.'
    Write-TestNote ('timing: {0}' -f (($launch.Events.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value }) -join ' '))
    Write-TestPass ('--trace-timing reports every event and --exit-after-render exits ({0} processes, {1} MiB private)' -f $launch.ProcessCount, $launch.PrivateMiB)
}

function Wait-LeanDocTitle {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [int]$TimeoutSeconds = 15
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $Process.Refresh()
        if ($Process.MainWindowTitle -match $Pattern) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "The LeanDoc window title did not match '$Pattern'; it is '$($Process.MainWindowTitle)'."
}

function Test-RuntimeWindow {
    $exe = Join-Path $resolvedDist 'LeanDoc.exe'
    $first = Join-Path $fixtures 'smoke.docx'
    $second = Join-Path $fixtures 'second.docx'
    $multi = Start-LeanDocProcess -ExePath $exe -DocumentPaths @($first, $second)
    try {
        $window = Wait-LeanDocWindow -Process $multi
        Assert-Equal (Get-LeanDocWindowClass $window) 'LeanDoc.Reader.Window' 'Unexpected main-window class.'
        # Both files open as tabs of one window, and the last one is shown.
        Wait-LeanDocTitle -Process $multi -Pattern 'second\.docx - LeanDoc'
        Assert-Equal @(Get-LeanDocProcessesByPath -ExePath $exe).Count 1 'A two-path launch must open one window.'
        # A later launch hands its file to that window and exits.
        $forwarder = Start-LeanDocProcess -ExePath $exe -DocumentPaths @($first)
        Assert-True ($forwarder.WaitForExit(15000)) 'A later launch did not exit after handing over its file.'
        Assert-Equal $forwarder.ExitCode 0 'A forwarding launch must exit cleanly.'
        Wait-LeanDocTitle -Process $multi -Pattern 'smoke\.docx - LeanDoc'
        Assert-Equal @(Get-LeanDocProcessesByPath -ExePath $exe).Count 1 'A later launch must not leave a second reader running.'
        Write-TestPass 'multi-file and later launches share one window as tabs'
    } finally {
        Stop-LeanDocTestProcessTree -RootProcess $multi
    }
}

function Assert-RegistryString {
    param([string]$SubKey, [string]$Name, [string]$Expected)
    $state = Get-RegistryValueState -Hive CurrentUser -SubKey $SubKey -Name $Name
    $displayName = if ($Name) { $Name } else { '(Default)' }
    Assert-True $state.Exists "Registry value is missing: HKCU\$SubKey [$displayName]"
    Assert-Equal ([string]$state.Value) $Expected "Registry value differs: HKCU\$SubKey [$displayName]."
}

function Test-InstalledRegistry {
    $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    $installedExe = [System.IO.Path]::GetFullPath((Join-Path $localData 'Programs\LeanDoc\LeanDoc.exe'))
    Assert-True (Test-Path -LiteralPath $installedExe -PathType Leaf) "Installed executable is missing: $installedExe"
    $progKey = 'Software\Classes\LeanDoc.Document'
    Assert-RegistryString ($progKey + '\shell\open') 'MultiSelectModel' 'Document'
    Assert-RegistryString ($progKey + '\shell\open\command') '' ('"{0}" -- "%1"' -f $installedExe)
    Assert-RegistryString 'Software\RegisteredApplications' 'LeanDoc' 'Software\LeanDoc\Capabilities'
    Assert-RegistryString 'Software\LeanDoc\Capabilities' 'ApplicationName' 'LeanDoc'
    foreach ($extension in $extensions) {
        Assert-RegistryString 'Software\LeanDoc\Capabilities\FileAssociations' $extension 'LeanDoc.Document'
        $openWith = Get-RegistryValueState -Hive CurrentUser -SubKey ("Software\Classes\{0}\OpenWithProgids" -f $extension) -Name 'LeanDoc.Document'
        Assert-True $openWith.Exists "Open With registration is missing for $extension."
    }
    foreach ($machineKey in @('Software\LeanDoc', 'Software\Classes\LeanDoc.Document')) {
        $state = Get-RegistryValueState -Hive LocalMachine -SubKey $machineKey -Name ''
        Assert-True (-not $state.KeyExists) "Per-user install unexpectedly created HKLM\$machineKey."
    }
    if ($RequireDefaultAssociation) {
        $effective = Resolve-EffectiveAssociationExecutable -Extension '.docx'
        Assert-True (-not [string]::IsNullOrWhiteSpace($effective)) 'Windows did not resolve an effective executable for .docx.'
        Assert-Equal ([System.IO.Path]::GetFullPath($effective)) $installedExe 'LeanDoc is registered but is not the effective .docx default.'
    }
    Write-TestPass 'per-user installed registry state (read-only verification)'
}

try {
    Write-TestNote "Repository: $repoRoot"
    Write-TestNote "Distribution: $resolvedDist"
    Test-StaticInvariants
    Test-Distribution
    Test-ValidateOnly

    if ($RequireDefaultAssociation -and -not $Registry) {
        throw '-RequireDefaultAssociation requires -Registry.'
    }
    if ($Registry) { Test-InstalledRegistry }
    else { Write-TestNote 'Registry checks skipped. Add -Registry after running the per-user installer.' }
    if ($Smoke) { Test-Smoke }
    else { Write-TestNote 'WebView2 smoke test skipped. Add -Smoke to run it.' }
    if ($Runtime) { Test-RuntimeWindow }
    else { Write-TestNote 'Window and tab checks skipped. Add -Runtime to run them.' }
    Write-Host 'LeanDoc verification completed successfully.' -ForegroundColor Green
} catch {
    Write-Error ("LeanDoc verification failed: {0}" -f $_.Exception.Message)
    exit 1
}
