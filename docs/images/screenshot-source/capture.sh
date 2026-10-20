#!/usr/bin/env bash
# Captures a real screenshot of the Linux build for the README and the site.
# Based on tests/hosts/Capture-LinuxScreenshot.sh, with one difference: once
# the first page has rendered, the window is resized to fill the virtual
# screen with xdotool (Xvfb has no window manager), and the capture is
# cropped to the window. Needs Xvfb, xdotool, ImageMagick, and a D-Bus session
# bus:
#   dbus-run-session -- bash docs/images/screenshot-source/capture.sh \
#     build/site/leandoc DOCUMENT.docx OUT.png [WIDTHxHEIGHT] [light|dark] [page|reading]
# Set LEANDOC_ASSETS_DIR to the staged reader assets of that build. Set
# CAPTURE_CLICK=X,Y to click one point of the window before the capture, for
# example to open the fidelity bar's details.
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: capture.sh <leandoc> <document> <out.png> [WxH] [light|dark] [page|reading]" >&2
  exit 2
fi
binary=$1
document=$2
output=$3
size=${4:-1440x900}
theme=${5:-light}
view=${6:-page}
width=${size%x*}
height=${size#*x}

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
printf '[Reader]\nTheme=%s\nView=%s\nRecent=\n' "$theme" "$view" > "$work/config/leandoc/settings.ini"

DISPLAY=$display XDG_CONFIG_HOME="$work/config" GTK_A11Y=none \
  WEBKIT_DISABLE_COMPOSITING_MODE=${WEBKIT_DISABLE_COMPOSITING_MODE:-1} \
  "$binary" --trace-timing --exit-after-render=15000 -- "$document" > "$work/trace.txt" 2>/dev/null &
app=$!
for _ in $(seq 1 150); do
  grep -q '^LEANDOC_TIMING rendered ' "$work/trace.txt" && break
  sleep 0.1
done
grep -q '^LEANDOC_TIMING rendered ' "$work/trace.txt" || {
  echo "The reader never reported a rendered document." >&2
  exit 1
}

window=$(DISPLAY=$display xdotool search --sync --onlyvisible --pid "$app" | head -n 1)
DISPLAY=$display xdotool windowmove "$window" 0 0 windowsize "$window" "$width" "$height"
# Let the reader lay out again at the new size, and fonts and images settle.
sleep 3
if [[ -n ${CAPTURE_CLICK:-} ]]; then
  DISPLAY=$display xdotool mousemove --window "$window" "${CAPTURE_CLICK%,*}" "${CAPTURE_CLICK#*,}" click 1
  # Move the pointer off the controls so no hover state is captured.
  sleep 0.5
  DISPLAY=$display xdotool mousemove "$((width - 2))" "$((height - 2))"
  sleep 1
fi
geometry=$(DISPLAY=$display xdotool getwindowgeometry --shell "$window")
eval "$geometry"
DISPLAY=$display import -window root -crop "${WIDTH}x${HEIGHT}+${X}+${Y}" +repage "$output"
cat "$work/trace.txt"
echo "Saved $output (${WIDTH}x${HEIGHT})"
