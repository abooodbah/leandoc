Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Dependency-free helpers for Windows PowerShell 5.1 and PowerShell 7. All
# registry and native API helpers below are read-only.

function Assert-True {
    param([bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
    if (-not $Condition) { throw [System.InvalidOperationException]::new($Message) }
}

function Assert-Equal {
    param([AllowNull()]$Actual, [AllowNull()]$Expected,
          [Parameter(Mandatory = $true)][string]$Message)
    if ($Actual -ne $Expected) {
        throw [System.InvalidOperationException]::new(
            ('{0} Expected <{1}> but found <{2}>.' -f $Message, $Expected, $Actual))
    }
}

function Assert-Match {
    param([string]$Text, [string]$Pattern,
          [Parameter(Mandatory = $true)][string]$Message)
    if ($Text -notmatch $Pattern) { throw [System.InvalidOperationException]::new($Message) }
}

function Assert-NotMatch {
    param([string]$Text, [string]$Pattern,
          [Parameter(Mandatory = $true)][string]$Message)
    if ($Text -match $Pattern) { throw [System.InvalidOperationException]::new($Message) }
}

function Read-TextFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    Assert-True (Test-Path -LiteralPath $Path -PathType Leaf) "Required file is missing: $Path"
    [System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($Path))
}

function Write-TestPass {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ('PASS  ' + $Message) -ForegroundColor Green
}

function Write-TestNote {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ('INFO  ' + $Message) -ForegroundColor Cyan
}

function Get-RegistryValueState {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('CurrentUser', 'LocalMachine')][string]$Hive,
        [Parameter(Mandatory = $true)][string]$SubKey,
        [AllowEmptyString()][string]$Name = ''
    )
    $root = if ($Hive -eq 'CurrentUser') {
        [Microsoft.Win32.Registry]::CurrentUser
    } else {
        [Microsoft.Win32.Registry]::LocalMachine
    }
    $key = $root.OpenSubKey($SubKey, $false)
    if ($null -eq $key) {
        return [pscustomobject]@{ KeyExists = $false; Exists = $false; Value = $null; Kind = $null }
    }
    try {
        $exists = @($key.GetValueNames()) -contains $Name
        [pscustomobject]@{
            KeyExists = $true
            Exists = $exists
            Value = if ($exists) { $key.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
            Kind = if ($exists) { $key.GetValueKind($Name) } else { $null }
        }
    } finally { $key.Dispose() }
}

function Initialize-LeanDocNativeHelpers {
    if ('LeanDoc.Tests.NativeMethods' -as [type]) { return }
    # Toolhelp avoids WMI/CIM. AssocQueryString resolves the effective Shell
    # handler rather than guessing from one registry location.
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace LeanDoc.Tests
{
    public static class NativeMethods
    {
        private const uint TH32CS_SNAPPROCESS = 0x00000002;
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct PROCESSENTRY32
        {
            public uint dwSize; public uint cntUsage; public uint th32ProcessID;
            public UIntPtr th32DefaultHeapID; public uint th32ModuleID;
            public uint cntThreads; public uint th32ParentProcessID;
            public int pcPriClassBase; public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int GetClassNameW(IntPtr window, StringBuilder className, int maximumCount);
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr window);
        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
        public static extern int AssocQueryStringW(uint flags, uint associationString,
            string association, string extra, StringBuilder output, ref uint characterCount);
        public static Dictionary<int, int> GetParentProcessMap()
        {
            IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == new IntPtr(-1))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                Dictionary<int, int> result = new Dictionary<int, int>();
                PROCESSENTRY32 entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (Process32FirstW(snapshot, ref entry))
                {
                    do
                    {
                        result[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                        entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                    } while (Process32NextW(snapshot, ref entry));
                }
                return result;
            }
            finally { CloseHandle(snapshot); }
        }
    }
}
"@
}

function Get-LeanDocProcessTreeIds {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)
    Initialize-LeanDocNativeHelpers
    $parentMap = [LeanDoc.Tests.NativeMethods]::GetParentProcessMap()
    $found = [System.Collections.Generic.HashSet[int]]::new()
    [void]$found.Add($RootProcessId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($entry in $parentMap.GetEnumerator()) {
            if ($found.Contains([int]$entry.Value) -and $found.Add([int]$entry.Key)) {
                $changed = $true
            }
        }
    }
    @($found)
}

function Start-LeanDocProcess {
    param(
        [Parameter(Mandatory = $true)][string]$ExePath,
        [Parameter(Mandatory = $true)][string[]]$DocumentPaths
    )
    $resolvedExe = [System.IO.Path]::GetFullPath($ExePath)
    Assert-True (Test-Path -LiteralPath $resolvedExe -PathType Leaf) "LeanDoc executable is missing: $resolvedExe"
    foreach ($document in $DocumentPaths) {
        Assert-True (Test-Path -LiteralPath $document -PathType Leaf) "Test document is missing: $document"
        Assert-True (-not $document.Contains('"')) "A Windows test path unexpectedly contains a quote: $document"
    }
    $quotedDocuments = @($DocumentPaths | ForEach-Object {
        '"{0}"' -f ([System.IO.Path]::GetFullPath($_))
    })
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedExe
    $startInfo.Arguments = '-- ' + ($quotedDocuments -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.WorkingDirectory = Split-Path -Parent $resolvedExe
    $process = [System.Diagnostics.Process]::Start($startInfo)
    Assert-True ($null -ne $process) 'Windows did not return a process for LeanDoc.'
    $process
}

function Wait-LeanDocWindow {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 20
    )
    Initialize-LeanDocNativeHelpers
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "LeanDoc exited before creating a window (exit code $($Process.ExitCode))."
        }
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero -and
            [LeanDoc.Tests.NativeMethods]::IsWindowVisible($Process.MainWindowHandle)) {
            return $Process.MainWindowHandle
        }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "LeanDoc did not create a visible main window within $TimeoutSeconds seconds."
}

function Get-LeanDocWindowClass {
    param([Parameter(Mandatory = $true)][IntPtr]$WindowHandle)
    Initialize-LeanDocNativeHelpers
    $buffer = [System.Text.StringBuilder]::new(256)
    $length = [LeanDoc.Tests.NativeMethods]::GetClassNameW($WindowHandle, $buffer, $buffer.Capacity)
    Assert-True ($length -gt 0) 'GetClassNameW failed for the LeanDoc window.'
    $buffer.ToString()
}

function Stop-LeanDocTestProcessTree {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$RootProcess,
        [int]$GraceSeconds = 3
    )
    # Never stop by image name. Only the exact PID tree created by this test is
    # eligible for cleanup, leaving unrelated LeanDoc/WebView2 sessions alone.
    $ownedIds = @(Get-LeanDocProcessTreeIds -RootProcessId $RootProcess.Id)
    try {
        $RootProcess.Refresh()
        if (-not $RootProcess.HasExited -and $RootProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            [void]$RootProcess.CloseMainWindow()
            [void]$RootProcess.WaitForExit($GraceSeconds * 1000)
        }
    } catch { Write-Verbose "Graceful LeanDoc close failed: $($_.Exception.Message)" }
    # Give WebView2 time to flush and release its shared user-data directory.
    # Force-killing the browser immediately can make the next measured launch
    # wait on stale profile locks and corrupt the startup sample.
    $childDeadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        $stillRunning = @($ownedIds | Where-Object {
            $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue)
        })
        if ($stillRunning.Count -gt 0) { Start-Sleep -Milliseconds 100 }
    } while ($stillRunning.Count -gt 0 -and [DateTime]::UtcNow -lt $childDeadline)
    $ownedIds = @($ownedIds + (Get-LeanDocProcessTreeIds -RootProcessId $RootProcess.Id) | Sort-Object -Unique)
    foreach ($processId in ($ownedIds | Sort-Object -Descending)) {
        if ($null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-LeanDocProcessSample {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)
    $ids = @(Get-LeanDocProcessTreeIds -RootProcessId $RootProcessId)
    $workingSet = [int64]0; $privateBytes = [int64]0
    $handles = 0; $threads = 0; $cpuSeconds = 0.0; $liveIds = @()
    foreach ($processId in $ids) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) { continue }
        try {
            $process.Refresh()
            $workingSet += [int64]$process.WorkingSet64
            $privateBytes += [int64]$process.PrivateMemorySize64
            $handles += [int]$process.HandleCount
            $threads += [int]$process.Threads.Count
            $cpuSeconds += [double]$process.TotalProcessorTime.TotalSeconds
            $liveIds += [int]$process.Id
        } catch { }
    }
    [pscustomobject]@{
        TimestampUtc = [DateTime]::UtcNow.ToString('o')
        ProcessIds = @($liveIds)
        ProcessCount = @($liveIds).Count
        WorkingSetBytes = $workingSet
        PrivateBytes = $privateBytes
        HandleCount = $handles
        ThreadCount = $threads
        CpuSeconds = $cpuSeconds
    }
}

function Resolve-EffectiveAssociationExecutable {
    param([string]$Extension = '.docx')
    Initialize-LeanDocNativeHelpers
    # ASSOCF_VERIFY = 0x40; ASSOCSTR_EXECUTABLE = 2.
    [uint32]$characters = 0
    [void][LeanDoc.Tests.NativeMethods]::AssocQueryStringW(
        0x40, 2, $Extension, 'open', $null, [ref]$characters)
    if ($characters -eq 0) { return $null }
    $output = [System.Text.StringBuilder]::new([int]$characters)
    $result = [LeanDoc.Tests.NativeMethods]::AssocQueryStringW(
        0x40, 2, $Extension, 'open', $output, [ref]$characters)
    if ($result -ne 0) { return $null }
    $output.ToString()
}

function Invoke-LeanDocSmoke {
    # Runs LeanDoc.exe --smoke-test FILE and waits for it. LeanDoc is a GUI
    # program, so it is started with redirected standard error, which is
    # where it writes its PASS or FAIL line.
    param(
        [Parameter(Mandatory = $true)][string]$ExePath,
        [Parameter(Mandatory = $true)][string]$DocumentPath,
        [int]$TimeoutSeconds = 40,
        [hashtable]$Environment = @{}
    )
    $resolvedExe = [System.IO.Path]::GetFullPath($ExePath)
    $resolvedDocument = [System.IO.Path]::GetFullPath($DocumentPath)
    Assert-True (Test-Path -LiteralPath $resolvedExe -PathType Leaf) "LeanDoc executable is missing: $resolvedExe"
    Assert-True (Test-Path -LiteralPath $resolvedDocument -PathType Leaf) "Smoke document is missing: $resolvedDocument"
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedExe
    $startInfo.Arguments = '--smoke-test "{0}"' -f $resolvedDocument
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = Split-Path -Parent $resolvedExe
    foreach ($name in $Environment.Keys) {
        $startInfo.EnvironmentVariables[$name] = [string]$Environment[$name]
    }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $errorTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-LeanDocTestProcessTree -RootProcess $process
        throw "LeanDoc --smoke-test did not exit within $TimeoutSeconds seconds."
    }
    $process.WaitForExit()
    [pscustomobject]@{
        ExitCode = $process.ExitCode
        Output = $errorTask.GetAwaiter().GetResult().Trim()
        Milliseconds = [Math]::Round($clock.Elapsed.TotalMilliseconds)
    }
}

function Get-LeanDocProcessesByPath {
    param([Parameter(Mandatory = $true)][string]$ExePath)
    $resolved = [System.IO.Path]::GetFullPath($ExePath)
    @(Get-Process LeanDoc -ErrorAction SilentlyContinue | Where-Object {
        try { $_.MainModule.FileName -ieq $resolved } catch { $false }
    })
}

function Wait-WebView2Idle {
    # A new launch can attach to a still-exiting WebView2 browser on the same
    # user-data folder and look nearly empty. Wait until no msedgewebview2
    # process uses LeanDoc's folder before a measured launch.
    param([int]$TimeoutSeconds = 30)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $busy = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
            Where-Object { [string]$_.CommandLine -match '(?i)\\LeanDoc\\WebView2' })
        if ($busy.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Get-LeanDocMachineSummary {
    # The machine details every published figure must name.
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $cpu = @(Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue)[0]
    $system = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $runtime = $null
    foreach ($key in @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
        $value = Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue
        if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace($value.pv)) { $runtime = $value.pv; break }
    }
    [pscustomobject]@{
        Computer = if ($null -ne $system) { '{0} {1}' -f $system.Manufacturer, $system.Model } else { 'unknown' }
        Processor = if ($null -ne $cpu) { $cpu.Name.Trim() } else { 'unknown' }
        LogicalProcessors = [Environment]::ProcessorCount
        MemoryGiB = if ($null -ne $system) { [Math]::Round($system.TotalPhysicalMemory / 1GB, 1) } else { 0 }
        OperatingSystem = if ($null -ne $os) { '{0} {1} (build {2})' -f $os.Caption, $os.Version, $os.BuildNumber } else { [Environment]::OSVersion.VersionString }
        WebView2Runtime = if ($null -ne $runtime) { $runtime } else { 'not found' }
        PowerShell = $PSVersionTable.PSVersion.ToString()
    }
}

function Get-LeanDocMedian {
    param([double[]]$Values)
    if ($null -eq $Values -or $Values.Count -eq 0) { return [double]::NaN }
    $sorted = @($Values | Sort-Object)
    $middle = [int][Math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 1) { return [double]$sorted[$middle] }
    ([double]$sorted[$middle - 1] + [double]$sorted[$middle]) / 2.0
}

function Measure-LeanDocLaunch {
    # One launch with the SPEC section 5 hooks: --trace-timing for the event
    # times and --exit-after-render so LeanDoc closes itself after the memory
    # sample. The memory is the private bytes and working set of LeanDoc.exe
    # and every descendant WebView2 process, sampled SettleMilliseconds after
    # the first rendered message (or after webview-ready with no document).
    # A launch whose tree has fewer than three processes (host, browser,
    # renderer) is marked Complete = $false and must be excluded.
    param(
        [Parameter(Mandatory = $true)][string]$ExePath,
        [string[]]$DocumentPaths = @(),
        [int]$SettleMilliseconds = 2000,
        [int]$SampleCount = 5,
        [int]$SampleIntervalMilliseconds = 200,
        [int]$TimeoutSeconds = 60,
        [hashtable]$Environment = @{}
    )
    $resolvedExe = [System.IO.Path]::GetFullPath($ExePath)
    Assert-True (Test-Path -LiteralPath $resolvedExe -PathType Leaf) "LeanDoc executable is missing: $resolvedExe"
    $quoted = @($DocumentPaths | ForEach-Object {
        $full = [System.IO.Path]::GetFullPath($_)
        Assert-True (Test-Path -LiteralPath $full -PathType Leaf) "Document is missing: $full"
        Assert-True (-not $full.Contains('"')) "A document path unexpectedly contains a quote: $full"
        '"{0}"' -f $full
    })
    $exitAfter = $SettleMilliseconds + $SampleCount * $SampleIntervalMilliseconds + 3000
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedExe
    $arguments = @('--trace-timing')
    if ($quoted.Count -gt 0) {
        $arguments += ('--exit-after-render={0}' -f $exitAfter)
        $arguments += '--'
        $arguments += $quoted
    }
    $startInfo.Arguments = $arguments -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.WorkingDirectory = Split-Path -Parent $resolvedExe
    foreach ($name in $Environment.Keys) {
        $startInfo.EnvironmentVariables[$name] = [string]$Environment[$name]
    }

    $events = [ordered]@{}
    $details = @{}
    $process = [System.Diagnostics.Process]::Start($startInfo)
    Assert-True ($null -ne $process) 'Windows did not return a process for LeanDoc.'
    $complete = $false
    $failure = $null
    $sample = $null
    $selfExit = $false
    $exitCode = $null
    try {
        $target = if ($quoted.Count -gt 0) { 'rendered' } else { 'webview-ready' }
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        $pending = $process.StandardOutput.ReadLineAsync()
        while (-not $events.Contains($target)) {
            if ([DateTime]::UtcNow -gt $deadline) { $failure = "no $target event within $TimeoutSeconds s"; break }
            if (-not $pending.Wait(100)) { continue }
            $line = $pending.Result
            if ($null -eq $line) { $failure = "LeanDoc exited before $target"; break }
            if ($line -match '^LEANDOC_TIMING (\S+) (\d+)(?: (.*))?$' -and -not $events.Contains($Matches[1])) {
                $events[$Matches[1]] = [int64]$Matches[2]
                $details[$Matches[1]] = [string]$Matches[3]
            }
            $pending = $process.StandardOutput.ReadLineAsync()
        }
        if ($null -eq $failure) {
            Start-Sleep -Milliseconds $SettleMilliseconds
            $samples = @()
            for ($index = 0; $index -lt $SampleCount; $index += 1) {
                $samples += Get-LeanDocProcessSample -RootProcessId $process.Id
                Start-Sleep -Milliseconds $SampleIntervalMilliseconds
            }
            $sample = $samples | Sort-Object PrivateBytes -Descending | Select-Object -First 1
            $complete = (@($samples | Where-Object { $_.ProcessCount -lt 3 }).Count -eq 0)
            if (-not $complete) { $failure = 'incomplete process tree' }
        }
    } finally {
        if ($quoted.Count -gt 0 -and $null -eq $failure) {
            $selfExit = $process.WaitForExit($exitAfter + 10000)
            if ($selfExit) { $exitCode = $process.ExitCode }
        }
        Stop-LeanDocTestProcessTree -RootProcess $process
    }
    $pages = $null
    if ($details.Contains('rendered') -and $details['rendered'] -match 'pages=(\d+)') { $pages = [int]$Matches[1] }
    [pscustomobject]@{
        Complete = $complete
        Failure = $failure
        ExitedOnItsOwn = $selfExit
        ExitCode = $exitCode
        Events = $events
        WindowVisibleMs = if ($events.Contains('window-visible')) { $events['window-visible'] } else { $null }
        WebViewReadyMs = if ($events.Contains('webview-ready')) { $events['webview-ready'] } else { $null }
        FirstPageMs = if ($events.Contains('rendered')) { $events['rendered'] } else { $null }
        Pages = $pages
        PrivateMiB = if ($null -ne $sample) { [Math]::Round($sample.PrivateBytes / 1MB, 2) } else { $null }
        WorkingSetMiB = if ($null -ne $sample) { [Math]::Round($sample.WorkingSetBytes / 1MB, 2) } else { $null }
        ProcessCount = if ($null -ne $sample) { $sample.ProcessCount } else { 0 }
    }
}

Export-ModuleMember -Function @(
    'Invoke-LeanDocSmoke', 'Get-LeanDocProcessesByPath', 'Wait-WebView2Idle',
    'Assert-True', 'Assert-Equal', 'Assert-Match', 'Assert-NotMatch',
    'Read-TextFile', 'Write-TestPass', 'Write-TestNote',
    'Get-RegistryValueState', 'Get-LeanDocProcessTreeIds',
    'Start-LeanDocProcess', 'Wait-LeanDocWindow', 'Get-LeanDocWindowClass',
    'Stop-LeanDocTestProcessTree', 'Get-LeanDocProcessSample',
    'Resolve-EffectiveAssociationExecutable', 'Get-LeanDocMachineSummary',
    'Get-LeanDocMedian', 'Measure-LeanDocLaunch'
)
