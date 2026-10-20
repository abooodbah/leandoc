#!/usr/bin/env bash
# Takes a real screenshot of the Linux host under Xvfb after the reader reports
# its first rendered document. Needs Xvfb, ImageMagick's import, and a D-Bus
# session bus (run it inside dbus-run-session):
#   dbus-run-session -- bash tests/hosts/Capture-LinuxScreenshot.sh \
#     build/c/leandoc DOCUMENT.docx OUT.png [WIDTHxHEIGHT] [light|dark]
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: Capture-LinuxScreenshot.sh <leandoc> <document> <out.png> [WxH] [light|dark]" >&2
  exit 2
fi
binary=$1
document=$2
output=$3
size=${4:-1280x860}
theme=${5:-light}

work=$(mktemp -d "${TMPDIR:-/tmp}/leandoc-shot.XXXXXX")
cleanup() {
  [[ -n ${app:-} ]] && kill "$app" 2>/dev/null || true
  [[ -n ${server:-} ]] && kill "$server" 2>/dev/null || true
  rm -rf -- "$work"
}
trap cleanup EXIT

display=:$(( 90 + RANDOM % 100 ))
Xvfb "$display" -screen 0 "${size}x24" -nolisten tcp >/dev/null 2>&1 &
server=$!
sleep 1

mkdir -p "$work/config/leandoc"
printf '[Reader]\nTheme=%s\nView=page\nRecent=\n' "$theme" > "$work/config/leandoc/settings.ini"

# Xvfb has no DRI3, and WebKit's accelerated compositing then leaves the
# root-window capture on a stale frame, so the capture uses non-composited
# painting, as the CTest smoke tests do.
DISPLAY=$display XDG_CONFIG_HOME="$work/config" GTK_A11Y=none \
  WEBKIT_DISABLE_COMPOSITING_MODE=${WEBKIT_DISABLE_COMPOSITING_MODE:-1} \
  "$binary" --trace-timing --exit-after-render=4000 -- "$document" > "$work/trace.txt" 2>/dev/null &
app=$!
for _ in $(seq 1 150); do
  grep -q '^LEANDOC_TIMING rendered ' "$work/trace.txt" && break
  sleep 0.1
done
grep -q '^LEANDOC_TIMING rendered ' "$work/trace.txt" || {
  echo "The reader never reported a rendered document." >&2
  exit 1
}
# Let fonts and images settle before the capture.
sleep 1.5
DISPLAY=$display import -window root "$output"
cat "$work/trace.txt"
echo "Saved $output"
