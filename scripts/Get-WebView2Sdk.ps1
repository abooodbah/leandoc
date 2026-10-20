[CmdletBinding()]
param(
    [string]$Destination
)

# Downloads the pinned Microsoft.Web.WebView2 NuGet package once, checks its
# SHA-256, and extracts the native SDK to obj\webview2\<version>. The build
# uses its headers, WebView2Loader.dll.lib, and WebView2Loader.dll.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Version = '1.0.4078.44'
$ExpectedSha256 = 'dc4d1d9168df26b830398303e50210b6e1729f6ce5a7ac69d2c766852f489962'
$PackageUrl = 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{0}/microsoft.web.webview2.{0}.nupkg' -f $Version

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $repoRoot ('obj\webview2\{0}' -f $Version)
}
$Destination = [System.IO.Path]::GetFullPath($Destination)
$marker = Join-Path $Destination 'build\native\include\WebView2.h'
if (Test-Path -LiteralPath $marker -PathType Leaf) {
    Write-Host ('WebView2 SDK {0} is ready in {1}' -f $Version, $Destination)
    return $Destination
}

$downloadRoot = Join-Path $repoRoot 'obj\downloads'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
$package = Join-Path $downloadRoot ('microsoft.web.webview2.{0}.nupkg' -f $Version)
if (-not (Test-Path -LiteralPath $package -PathType Leaf)) {
    $partial = $package + '.partial'
    Invoke-WebRequest -Uri $PackageUrl -OutFile $partial -UseBasicParsing
    Move-Item -LiteralPath $partial -Destination $package -Force
}

$actual = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256) {
    Remove-Item -LiteralPath $package -Force
    throw ('The WebView2 package hash {0} does not match the pinned {1}.' -f $actual, $ExpectedSha256)
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$staging = $Destination + '.partial'
if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null
$archive = [System.IO.Compression.ZipFile]::OpenRead($package)
try {
    $stagingPrefix = $staging.TrimEnd('\') + '\'
    foreach ($entry in $archive.Entries) {
        # Only the native SDK and the licence files are needed.
        $name = $entry.FullName
        if (-not ($name.StartsWith('build/native/') -or $name -in @('LICENSE.txt', 'NOTICE.txt'))) {
            continue
        }
        if ($name.EndsWith('/')) { continue }
        $target = [System.IO.Path]::GetFullPath((Join-Path $staging $name))
        if (-not $target.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw ('Refusing a package entry outside the SDK folder: {0}' -f $name)
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
} finally {
    $archive.Dispose()
}
if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
}
Move-Item -LiteralPath $staging -Destination $Destination
Write-Host ('Extracted WebView2 SDK {0} to {1}' -f $Version, $Destination)
return $Destination
