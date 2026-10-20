#!/usr/bin/env bash
# L-03: the macOS preview ZIP as a person downloads it. Unzips it into a fresh
# folder, verifies the ad-hoc signature deeply and strictly, checks that the
# executable carries both arm64 and x86_64, and runs --smoke-test from the
# unzipped app (the runner's own architecture slice).
#   bash tests/hosts/Test-MacPackage.sh release/LeanDoc-v0.1.0-macos-universal-preview.zip
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: Test-MacPackage.sh <package.zip>" >&2
  exit 2
fi
archive=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
fixture=$(cd tests/hosts/fixtures && pwd)/smoke.docx
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

ditto -x -k "$archive" "$work"
app=$(find "$work" -maxdepth 2 -name 'LeanDoc.app' -type d | head -1)
[[ -n $app ]] || { echo "No LeanDoc.app in the ZIP." >&2; exit 1; }

codesign --verify --deep --strict --verbose=2 "$app"
codesign --display --verbose=2 "$app" 2>&1 | grep -E '^(Identifier|Format|Signature|CodeDirectory)' || true

archs=$(lipo -archs "$app/Contents/MacOS/LeanDoc")
echo "Architectures: $archs"
[[ $archs == *arm64* && $archs == *x86_64* ]] || { echo "The executable is not universal." >&2; exit 1; }
for library in "$app"/Contents/MacOS/* ; do
  [[ -f $library && -x $library ]] || continue
  lipo -archs "$library" | grep -q arm64 || { echo "$library lacks arm64" >&2; exit 1; }
done

output=$("$app/Contents/MacOS/LeanDoc" --smoke-test "$fixture" 2>&1) || {
  echo "$output" | tail -20; echo "The unzipped app failed its smoke test." >&2; exit 1; }
echo "$output" | tail -3
echo "LeanDoc macOS package check passed: signature, both architectures, and smoke from the ZIP."
