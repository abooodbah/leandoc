[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$OutputDirectory = 'artifacts/visual/windows'
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
$saved = Get-ItemProperty -LiteralPath $settingsKey -ErrorAction SilentlyContinue

try {
    foreach ($theme in @('light', 'dark')) {
        foreach ($view in @('page', 'reading')) {
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
                    while (-not $rendered -and [DateTime]::UtcNow -lt $deadline) {
                        $line = $process.StandardOutput.ReadLine()
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
                    $bitmap = New-Object System.Drawing.Bitmap $width, $height
                    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
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
if ($count -lt $fixtures.Count * 4) { throw 'Some fixtures were not captured.' }
