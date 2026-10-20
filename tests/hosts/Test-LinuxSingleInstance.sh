#!/usr/bin/env bash
# Checks that a second launch hands its file to the running window and exits,
# and that the running window opens it as a tab. Run under a display and a
# D-Bus session bus, as CTest does:
#   xvfb-run -a bash tests/hosts/Test-LinuxSingleInstance.sh BUILD/leandoc A.docx B.docx
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: Test-LinuxSingleInstance.sh <leandoc> <first.docx> <second.docx>" >&2
  exit 2
fi
binary=$1
first=$(realpath -- "$2")
second=$(realpath -- "$3")

config=$(mktemp -d "${TMPDIR:-/tmp}/leandoc-single.XXXXXX")
cleanup() {
  if [[ -n ${primary:-} ]]; then
    kill "$primary" 2>/dev/null || true
    wait "$primary" 2>/dev/null || true
  fi
  rm -rf -- "$config"
}
trap cleanup EXIT
export XDG_CONFIG_HOME=$config
settings="$config/leandoc/settings.ini"

# Each shown document is recorded first in the recent list, which makes the
# primary window's state visible to this script without any test hook.
wait_for_recent() {
  local expected=$1
  for _ in $(seq 1 150); do
    if [[ -f $settings ]] && grep -qF "Recent=${expected};" "$settings"; then
      return 0
    fi
    sleep 0.1
  done
  echo "The running window did not show $expected." >&2
  [[ -f $settings ]] && cat "$settings" >&2
  return 1
}

"$binary" "$first" &
primary=$!
wait_for_recent "$first"

start=$(date +%s)
timeout 15 "$binary" "$second"
elapsed=$(( $(date +%s) - start ))
if (( elapsed > 10 )); then
  echo "The second launch took ${elapsed}s to hand over its file." >&2
  exit 1
fi
wait_for_recent "$second"

kill -0 "$primary" || { echo "The running window exited." >&2; exit 1; }
running=$(pgrep -c -f -- "^$binary " || true)
if [[ $running -ne 1 ]]; then
  echo "Expected one LeanDoc process, found $running." >&2
  exit 1
fi
echo "LeanDoc Linux single-instance check passed."
