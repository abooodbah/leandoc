#!/usr/bin/env bash
# UI-01 on macOS: every feature fixture in page and reading view, light and
# dark, from the real LeanDoc on WKWebView. Theme and view are set with
# `defaults write` before each launch (restored afterwards); the launch waits
# for the reader's rendered message (--trace-timing) and captures the screen.
# Files are named <fixture>--<view>-<theme>.png for build_sheets.py.
#   bash tests/visual/capture-macos.sh build/macos/.../LeanDoc.app artifacts/visual/macos
set -euo pipefail

app=${1:?LeanDoc.app}
out=${2:-artifacts/visual/macos}
binary="$app/Contents/MacOS/LeanDoc"
domain=io.github.abooodbah.LeanDoc
mkdir -p "$out"
saved_theme=$(defaults read "$domain" LeanDocTheme 2>/dev/null || true)
saved_view=$(defaults read "$domain" LeanDocView 2>/dev/null || true)
restore() {
  if [[ -n $saved_theme ]]; then defaults write "$domain" LeanDocTheme "$saved_theme"; else defaults delete "$domain" LeanDocTheme 2>/dev/null || true; fi
  if [[ -n $saved_view ]]; then defaults write "$domain" LeanDocView "$saved_view"; else defaults delete "$domain" LeanDocView 2>/dev/null || true; fi
}
trap restore EXIT

count=0
for theme in light dark; do
  for view in page reading; do
    defaults write "$domain" LeanDocTheme "$theme"
    defaults write "$domain" LeanDocView "$view"
    for fixture in tests/fixtures/features/*.docx; do
      name=$(basename "$fixture" .docx)
      log=$(mktemp)
      "$binary" --trace-timing --exit-after-render=5000 -- "$fixture" > "$log" 2>&1 &
      pid=$!
      for _ in $(seq 1 300); do
        grep -q '^LEANDOC_TIMING rendered ' "$log" && break
        sleep 0.1
      done
      if grep -q '^LEANDOC_TIMING rendered ' "$log"; then
        sleep 1.5
        screencapture -x -o "$out/${name}--${view}-${theme}.png" && count=$((count + 1))
      else
        echo "$name: no rendered message" >&2
        tail -5 "$log" >&2
      fi
      wait "$pid" 2>/dev/null || true
      rm -f "$log"
    done
  done
done
echo "$count macOS screenshots in $out"
