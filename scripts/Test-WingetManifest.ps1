[CmdletBinding()]
param(
    [string]$ManifestPath
)

# Runs winget validate on LeanDoc's winget manifests when winget is present.
# GitHub's Windows Server runners may not include winget; then the check is
# skipped with a notice, and the manifests must be validated on a Windows 11
# machine before the winget pull request.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $version = [string](Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw |
        ConvertFrom-Json).version
    $ManifestPath = Join-Path $repoRoot ('packaging\winget\abooodbah.LeanDoc\{0}' -f $version)
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Container)) {
    throw "The winget manifest folder is missing: $ManifestPath"
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($null -eq $winget) {
    Write-Output '::notice title=winget validate skipped::winget is not installed on this runner image. Run winget validate --manifest on a Windows 11 machine before the winget pull request.'
    return
}

& $winget.Source --version
& $winget.Source validate --manifest $ManifestPath --disable-interactivity
$code = $LASTEXITCODE
# 0 is valid. 0x8A150068 (APPINSTALLER_CLI_ERROR_MANIFEST_VALIDATION_WARNING)
# means valid with warnings; a client older than the 1.12.0 schema warns that
# it does not know the schema header, which the winget-pkgs pipeline accepts.
$validationWarning = -1978335192  # 0x8A150068 as a signed 32-bit exit code
if ($code -eq $validationWarning) {
    Write-Output '::warning title=winget validate::The manifests are valid with warnings (see the log). An older winget client warns about the 1.12.0 schema header.'
} elseif ($code -ne 0) {
    throw "winget validate failed with exit code $code."
}
Write-Output "winget validate passed for $ManifestPath"
