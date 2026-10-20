[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [ValidateSet('x64')]
    [string]$Platform = 'x64',

    [string]$BuildDirectory,

    [switch]$Clean,
    [switch]$SkipNpmRestore,
    [switch]$SkipTests
)

# Builds LeanDoc for Windows with CMake and MSVC, runs CTest, and stages the
# portable payload in dist\:
#   LeanDoc.exe, WebView2Loader.dll, assets\, tools\leandoc-inspect.exe,
#   installer\install.ps1, installer\uninstall.ps1, README.md, LICENSE,
#   THIRD_PARTY_NOTICES.md

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($BuildDirectory)) {
    $BuildDirectory = Join-Path $repoRoot 'build\windows'
}
$BuildDirectory = [System.IO.Path]::GetFullPath($BuildDirectory)
$distDirectory = Join-Path $repoRoot 'dist'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $($LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
    }
}

function Resolve-Tool {
    param([Parameter(Mandatory = $true)][string[]]$Names, [string]$Hint)
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command) { return $command.Source }
    }
    throw ('{0} was not found. {1}' -f ($Names -join ' or '), $Hint)
}

function Reset-SafeDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $Path))
    if (-not $resolvedParent.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear a directory outside the repository root: $Path"
    }
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Path | Out-Null
}

function Copy-RequiredFile {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Required build output was not found: $Source"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Find-BuiltFile {
    param([Parameter(Mandatory = $true)][string]$Name)
    $found = @(Get-ChildItem -LiteralPath $BuildDirectory -Recurse -File -Filter $Name |
        Where-Object { $_.FullName -match ('[\\/]' + $Configuration + '[\\/]') -or
                       $_.DirectoryName -eq $BuildDirectory } |
        Sort-Object LastWriteTimeUtc -Descending)
    if ($found.Count -eq 0) {
        throw "The build did not produce $Name under $BuildDirectory."
    }
    return $found[0].FullName
}

if ($Clean) {
    foreach ($generated in @($BuildDirectory, $distDirectory)) {
        if (Test-Path -LiteralPath $generated) {
            $resolved = [System.IO.Path]::GetFullPath($generated)
            if (-not $resolved.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar,
                    [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to clean a path outside the repository: $resolved"
            }
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}

$node = Resolve-Tool -Names @('node.exe', 'node') -Hint 'Install Node.js 20 or newer.'
$cmake = Resolve-Tool -Names @('cmake.exe', 'cmake') -Hint 'Install CMake 3.22 or newer, or use a Visual Studio Developer PowerShell.'

Push-Location $repoRoot
try {
    if (-not $SkipNpmRestore) {
        $npm = Resolve-Tool -Names @('npm.cmd', 'npm') -Hint 'Install Node.js 20 or newer, or pass -SkipNpmRestore.'
        Invoke-CheckedCommand -FilePath $npm -ArgumentList @('ci', '--ignore-scripts', '--no-audit', '--no-fund')
    }

    $sdk = & (Join-Path $PSScriptRoot 'Get-WebView2Sdk.ps1') | Select-Object -Last 1

    # The static C runtime keeps LeanDoc.exe free of the Visual C++
    # redistributable, as LeanMark does. It must be set before any target.
    Invoke-CheckedCommand -FilePath $cmake -ArgumentList @(
        '-S', $repoRoot,
        '-B', $BuildDirectory,
        '-A', $Platform,
        '-DBUILD_TESTING=ON',
        '-DLEANDOC_ENABLE_GUI_TESTS=ON',
        '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded$<$<CONFIG:Debug>:Debug>',
        "-DLEANDOC_WEBVIEW2_SDK=$sdk"
    )
    Invoke-CheckedCommand -FilePath $cmake -ArgumentList @(
        '--build', $BuildDirectory, '--config', $Configuration, '--parallel')
    if (-not $SkipTests) {
        $ctest = Join-Path (Split-Path -Parent $cmake) 'ctest.exe'
        if (-not (Test-Path -LiteralPath $ctest -PathType Leaf)) {
            $ctest = Resolve-Tool -Names @('ctest.exe', 'ctest') -Hint 'CTest ships with CMake.'
        }
        Invoke-CheckedCommand -FilePath $ctest -ArgumentList @(
            '--test-dir', $BuildDirectory, '-C', $Configuration, '--output-on-failure')
    }
} finally {
    Pop-Location
}

# Recreate dist on every successful build so stale files never reach a package.
Reset-SafeDirectory -Path $distDirectory
$exe = Find-BuiltFile -Name 'LeanDoc.exe'
Copy-RequiredFile -Source $exe -Destination (Join-Path $distDirectory 'LeanDoc.exe')
Copy-RequiredFile -Source (Join-Path (Split-Path -Parent $exe) 'WebView2Loader.dll') `
    -Destination (Join-Path $distDirectory 'WebView2Loader.dll')
Copy-RequiredFile -Source (Find-BuiltFile -Name 'leandoc-inspect.exe') `
    -Destination (Join-Path $distDirectory 'tools\leandoc-inspect.exe')
Invoke-CheckedCommand -FilePath $node -ArgumentList @(
    (Join-Path $repoRoot 'scripts\stage-runtime-assets.mjs'),
    (Join-Path $distDirectory 'assets'))

# Distribution documents are required: a release carries its terms and the
# notices for bundled dependencies.
Copy-RequiredFile -Source (Join-Path $repoRoot 'README.md') -Destination (Join-Path $distDirectory 'README.md')
Copy-RequiredFile -Source (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $distDirectory 'LICENSE')
# The optional per-user installer sits beside the executable as in the ZIP,
# so dist\ can be installed and tested as it is.
foreach ($installerName in @('install.ps1', 'uninstall.ps1')) {
    Copy-RequiredFile -Source (Join-Path $repoRoot ('installer\' + $installerName)) `
        -Destination (Join-Path $distDirectory ('installer\' + $installerName))
}
$notices = Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md'
if (-not (Test-Path -LiteralPath $notices -PathType Leaf)) {
    # Until the root file exists, CMake joins docs/notices/*.md.
    $notices = Join-Path $BuildDirectory 'generated\THIRD_PARTY_NOTICES.md'
    Write-Warning 'THIRD_PARTY_NOTICES.md is missing; staging the notices joined from docs/notices.'
}
Copy-RequiredFile -Source $notices -Destination (Join-Path $distDirectory 'THIRD_PARTY_NOTICES.md')

$stagedFiles = @(Get-ChildItem -LiteralPath $distDirectory -Recurse -File)
$stagedBytes = ($stagedFiles | Measure-Object -Property Length -Sum).Sum
Write-Host ('LeanDoc {0} {1} staged {2} files ({3:N2} MiB) in {4}' -f
    $Configuration, $Platform, $stagedFiles.Count, ($stagedBytes / 1MB), $distDirectory)
