#!/usr/bin/env bash
# L-01: the .deb in a clean Ubuntu 24.04 container. Installs it with apt (so
# every dependency must resolve from the Ubuntu archive), launches the
# installed binary with --smoke-test under Xvfb, purges it, and checks that no
# file the package installed is left. CI runs it as root in a fresh
# ubuntu:24.04 container started with --privileged (WebKit's bwrap sandbox
# needs user namespaces):
#   docker run --rm --privileged -v "$PWD:/w" -w /w ubuntu:24.04 \
#     bash tests/hosts/Test-DebLifecycle.sh release/LeanDoc-v0.1.0-linux-x86_64.deb
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: Test-DebLifecycle.sh <package.deb>" >&2
  exit 2
fi
package=$(realpath -- "$1")
fixture=$(realpath -- tests/hosts/fixtures/smoke.docx)
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
echo "== install"
apt-get install -y --no-install-recommends "$package" > /tmp/install.log 2>&1 || {
  tail -40 /tmp/install.log; echo "The package did not install with its dependencies." >&2; exit 1; }
grep -E '^(Need to get|[0-9]+ newly installed)' /tmp/install.log || true
dpkg -s leandoc | grep -E '^(Package|Version|Status|Installed-Size):'
dpkg -L leandoc | sort > /tmp/leandoc-files.txt
echo "$(wc -l < /tmp/leandoc-files.txt) paths installed"
test -x /usr/bin/leandoc
test -f /usr/share/leandoc/assets/reader.html
test -f /usr/share/applications/io.github.abooodbah.leandoc.desktop
/usr/bin/leandoc --help

echo "== launch smoke (tools for the test only: Xvfb, D-Bus session)"
apt-get install -y --no-install-recommends xvfb xauth dbus-x11 > /tmp/tools.log 2>&1 || {
  tail -20 /tmp/tools.log; exit 1; }
export WEBKIT_DISABLE_COMPOSITING_MODE=1 GTK_A11Y=none
output=$(dbus-run-session -- xvfb-run -a /usr/bin/leandoc --smoke-test "$fixture" 2>&1) || {
  echo "$output" | tail -20; echo "The installed LeanDoc failed its smoke test." >&2; exit 1; }
echo "$output" | grep 'LeanDoc Linux smoke: PASS'

echo "== purge"
apt-get purge -y leandoc > /tmp/purge.log 2>&1 || { tail -20 /tmp/purge.log; exit 1; }
if dpkg -s leandoc > /dev/null 2>&1; then
  echo "dpkg still knows the package after purge." >&2
  exit 1
fi
left=()
while IFS= read -r path; do
  [[ -z $path || $path == "/." ]] && continue
  if [[ -f $path || -L $path ]]; then
    left+=("$path")
  elif [[ -d $path ]] && [[ $path == *leandoc* ]]; then
    left+=("$path/")
  fi
done < /tmp/leandoc-files.txt
if (( ${#left[@]} > 0 )); then
  printf 'Left after purge: %s\n' "${left[@]}" >&2
  exit 1
fi
echo "LeanDoc package lifecycle check passed: dependencies resolved, smoke passed, nothing left after purge."
