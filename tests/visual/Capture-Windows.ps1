[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$OutputDirectory = 'artifacts/visual/windows',
    # CI captures one theme and view per runner: about 90 launches on one
    # runner could exhaust its desktop heap (0xC0000142).
    [ValidateSet('light', 'dark')]
    [string[]]$Themes = @('light', 'dark'),
    [ValidateSet('page', 'reading')]
    [string[]]$Views = @('page', 'reading')
)

# UI-01 on Windows: every feature fixture in page and reading view, light and
# dark, captured from the real LeanDoc window on WebView2. Theme and view are
# set in HKCU\Software\LeanDoc before each launch (restored afterwards), the
# launch waits for the reader's rendered message (--trace-timing), and the
# window is copied from the screen. Files are named like the Linux ones,
# <fixture>--<view>-<theme>.png, for tests/visual/build_sheets.py.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $testsRoot
Import-Module (Join-Path $testsRoot 'TestSupport.psm1') -Force
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LeanDocCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][LeanDocCapture]::SetProcessDPIAware()

if ([string]::IsNullOrWhiteSpace($ExePath)) { $ExePath = Join-Path $repoRoot 'dist\LeanDoc.exe' }
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
$out = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
New-Item -ItemType Directory -Path $out -Force | Out-Null
$fixtures = @(Get-ChildItem -LiteralPath (Join-Path $testsRoot 'fixtures\features') -Filter *.docx | Sort-Object Name)
$settingsKey = 'HKCU:\Software\LeanDoc'
# A LeanDoc of the same path left running by an earlier step would take every
# launch as a later one (single instance). Close it first.
foreach ($left in @(Get-LeanDocProcessesByPath -ExePath $ExePath)) {
    Write-Warning ('Stopping LeanDoc process {0} left by an earlier step.' -f $left.Id)
    Stop-LeanDocTestProcessTree -RootProcess $left
}
$saved = Get-ItemProperty -LiteralPath $settingsKey -ErrorAction SilentlyContinue

try {
    foreach ($theme in $Themes) {
        foreach ($view in $Views) {
            New-Item -Path $settingsKey -Force | Out-Null
            Set-ItemProperty -LiteralPath $settingsKey -Name Theme -Value $theme
            Set-ItemProperty -LiteralPath $settingsKey -Name View -Value $view
            foreach ($fixture in $fixtures) {
                [void](Wait-WebView2Idle -TimeoutSeconds 30)
                $info = [System.Diagnostics.ProcessStartInfo]::new()
                $info.FileName = $ExePath
                $info.Arguments = ('--trace-timing --exit-after-render=6000 -- "{0}"' -f $fixture.FullName)
                $info.UseShellExecute = $false
                $info.RedirectStandardOutput = $true
                $process = [System.Diagnostics.Process]::Start($info)
                try {
                    $deadline = [DateTime]::UtcNow.AddSeconds(40)
                    $rendered = $false
                    # Never block on the pipe: a launch that hangs must not
                    # hold the step until the job times out.
                    while (-not $rendered -and [DateTime]::UtcNow -lt $deadline) {
                        $read = $process.StandardOutput.ReadLineAsync()
                        $left = [Math]::Max(1, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
                        if (-not $read.Wait($left)) { break }
                        $line = $read.Result
                        if ($null -eq $line) { break }
                        $rendered = $line -like 'LEANDOC_TIMING rendered *'
                    }
                    if (-not $rendered) { Write-Warning ('{0}: no rendered message' -f $fixture.Name); continue }
                    $window = Wait-LeanDocWindow -Process $process
                    [void][LeanDocCapture]::MoveWindow($window, 0, 0, 1280, 860, $true)
                    [void][LeanDocCapture]::SetForegroundWindow($window)
                    Start-Sleep -Milliseconds 1500
                    $rect = New-Object LeanDocCapture+RECT
                    [void][LeanDocCapture]::GetWindowRect($window, [ref]$rect)
                    $width = $rect.Right - $rect.Left
                    $height = $rect.Bottom - $rect.Top
                    # A light capture that comes out nearly black caught the
                    # window before WebView2 painted it; take it again.
                    for ($attempt = 1; $attempt -le 3; $attempt++) {
                        $bitmap = New-Object System.Drawing.Bitmap $width, $height
                        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
                        if ($theme -ne 'light') { break }
                        # GetPixel is slow from PowerShell: a coarse grid is enough.
                        $sum = 0.0; $count = 0
                        for ($y = 5; $y -lt $height; $y += 64) {
                            for ($x = 5; $x -lt $width; $x += 64) {
                                $pixel = $bitmap.GetPixel($x, $y)
                                $sum += 0.2126 * $pixel.R + 0.7152 * $pixel.G + 0.0722 * $pixel.B
                                $count++
                            }
                        }
                        if ($count -eq 0 -or ($sum / $count) -ge 100 -or $attempt -eq 3) { break }
                        Write-Warning ('{0} {1}-{2}: capture {3} was dark (mean {4:N0}); taking it again' -f $fixture.Name, $view, $theme, $attempt, ($sum / $count))
                        $graphics.Dispose()
                        $bitmap.Dispose()
                        Start-Sleep -Milliseconds 1500
                    }
                    $path = Join-Path $out ('{0}--{1}-{2}.png' -f $fixture.BaseName, $view, $theme)
                    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
                    $graphics.Dispose()
                    $bitmap.Dispose()
                    Write-Host ('captured {0}' -f (Split-Path -Leaf $path))
                } finally {
                    Stop-LeanDocTestProcessTree -RootProcess $process
                }
            }
        }
    }
} finally {
    if ($null -ne $saved) {
        foreach ($name in @('Theme', 'View')) {
            if ($saved.PSObject.Properties[$name]) { Set-ItemProperty -LiteralPath $settingsKey -Name $name -Value $saved.$name }
        }
    }
}
$count = @(Get-ChildItem -LiteralPath $out -Filter *.png).Count
Write-Output ('{0} Windows screenshots in {1}' -f $count, $out)
if ($count -lt $fixtures.Count * $Themes.Count * $Views.Count) { throw 'Some fixtures were not captured.' }
