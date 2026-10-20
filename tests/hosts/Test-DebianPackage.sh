#!/usr/bin/env bash
# Checks a built LeanDoc .deb: name, architecture, discovered GTK and WebKitGTK
# dependencies, the required payload, nothing outside /usr, the checksum
# sidecar, and valid desktop and AppStream metadata when the validators exist.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash tests/hosts/Test-DebianPackage.sh <LeanDoc.deb>" >&2
  exit 2
fi

package=$1
[[ -f "$package" ]] || { echo "Package not found: $package" >&2; exit 1; }

fail() {
  echo "$1" >&2
  exit 1
}

name=$(dpkg-deb -f "$package" Package)
architecture=$(dpkg-deb -f "$package" Architecture)
dependencies=$(dpkg-deb -f "$package" Depends)
contents=$(dpkg-deb -c "$package")

[[ "$name" == "leandoc" ]] || fail "Unexpected Debian package name: $name"
[[ "$architecture" == "amd64" ]] || fail "Unexpected Debian architecture: $architecture"
grep -Eq 'libgtk-4-[^, ]*' <<<"$dependencies" ||
  fail "GTK 4 runtime dependency was not discovered: $dependencies"
grep -Eq 'libwebkitgtk-6\.0-[^, ]*' <<<"$dependencies" ||
  fail "WebKitGTK 6.0 runtime dependency was not discovered: $dependencies"

for required in \
  './usr/bin/leandoc' \
  './usr/share/leandoc/assets/reader.html' \
  './usr/share/leandoc/assets/reader.css' \
  './usr/share/leandoc/assets/reader.js' \
  './usr/share/applications/io.github.abooodbah.leandoc.desktop' \
  './usr/share/metainfo/io.github.abooodbah.leandoc.metainfo.xml' \
  './usr/share/icons/hicolor/256x256/apps/io.github.abooodbah.leandoc.png' \
  './usr/share/icons/hicolor/512x512/apps/io.github.abooodbah.leandoc.png' \
  './usr/share/icons/hicolor/scalable/apps/io.github.abooodbah.leandoc.svg' \
  './usr/share/doc/LeanDoc/LICENSE' \
  './usr/share/doc/LeanDoc/THIRD_PARTY_NOTICES.md'
do
  grep -Fq " $required" <<<"$contents" || fail "Debian package is missing $required"
done

# Every path stays under /usr; a package never writes /etc, /opt, or a home.
outside=$(awk '{print $6}' <<<"$contents" | grep -Ev '^\./(usr/.*)?$' || true)
[[ -z "$outside" ]] || fail "Debian package installs outside /usr: $outside"

sidecar="$package.sha256"
if [[ -f "$sidecar" ]]; then
  (cd "$(dirname -- "$package")" && sha256sum -c "$(basename -- "$sidecar")" >/dev/null) ||
    fail "The .sha256 sidecar does not match $package"
fi

extract=$(mktemp -d "${TMPDIR:-/tmp}/leandoc-deb.XXXXXX")
trap 'rm -rf -- "$extract"' EXIT
dpkg-deb -x "$package" "$extract"
if command -v desktop-file-validate >/dev/null; then
  desktop-file-validate "$extract/usr/share/applications/io.github.abooodbah.leandoc.desktop"
fi
if command -v appstreamcli >/dev/null; then
  appstreamcli validate --no-net --pedantic \
    "$extract/usr/share/metainfo/io.github.abooodbah.leandoc.metainfo.xml"
fi

echo "LeanDoc Debian package checks passed."
