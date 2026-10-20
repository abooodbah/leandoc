#!/usr/bin/env bash
# Checks the SPEC section 5 test hooks on a real host: --trace-timing prints
# every event in order with increasing times, and --exit-after-render=MS quits
# cleanly after the first rendered message. CTest runs it for Linux (under
# xvfb-run and a D-Bus session bus) and macOS:
#   bash tests/hosts/Test-TimingHooks.sh BUILD/leandoc smoke.docx
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: Test-TimingHooks.sh <leandoc> <document.docx>" >&2
  exit 2
fi
binary=$1
document=$2

# macOS has no timeout(1); CTest's own timeout covers it there.
limit=()
if command -v timeout >/dev/null 2>&1; then
  limit=(timeout 30)
fi

status=0
output=$(${limit[@]+"${limit[@]}"} "$binary" --trace-timing --exit-after-render=200 -- "$document") || status=$?
if [[ $status -ne 0 ]]; then
  echo "LeanDoc exited with $status instead of quitting cleanly." >&2
  exit 1
fi

lines=$(grep '^LEANDOC_TIMING ' <<<"$output" || true)
printf '%s\n' "$lines"
declare_ms() {
  local event=$1 line
  line=$(grep -m1 "^LEANDOC_TIMING $event " <<<"$lines" || true)
  if [[ -z $line ]]; then
    echo "Missing timing event: $event" >&2
    exit 1
  fi
  awk '{print $3}' <<<"$line"
}
before() {
  # The events form two chains that meet at "rendered": the window and web
  # view start, and the document read. A host may read the document before
  # its window exists (macOS NSDocument does), so the chains are not ordered
  # against each other.
  if (( $2 < $1 )); then
    echo "Timing event $4 ($2 ms) came before $3 ($1 ms)." >&2
    exit 1
  fi
}
process_start=$(declare_ms process-start)
window_visible=$(declare_ms window-visible)
webview_ready=$(declare_ms webview-ready)
document_requested=$(declare_ms document-requested)
package_served=$(declare_ms package-served)
rendered=$(declare_ms rendered)
before "$process_start" "$window_visible" process-start window-visible
before "$window_visible" "$webview_ready" window-visible webview-ready
before "$process_start" "$document_requested" process-start document-requested
before "$document_requested" "$package_served" document-requested package-served
before "$webview_ready" "$package_served" webview-ready package-served
before "$package_served" "$rendered" package-served rendered
grep -Eq '^LEANDOC_TIMING package-served [0-9]+ tab=1 generation=1 coreMs=[0-9]+ bytes=[1-9][0-9]*$' <<<"$lines" ||
  { echo "package-served lacks core time or bytes." >&2; exit 1; }
grep -Eq '^LEANDOC_TIMING rendered [0-9]+ tab=1 generation=1 pages=[1-9][0-9]* readerMs=[0-9]+$' <<<"$lines" ||
  { echo "rendered lacks pages or reader time." >&2; exit 1; }

# Without the flags the host prints nothing of the kind.
quiet=$(${limit[@]+"${limit[@]}"} "$binary" --smoke-test "$document" 2>/dev/null || true)
if grep -q '^LEANDOC_TIMING ' <<<"$quiet"; then
  echo "Timing lines appeared without --trace-timing." >&2
  exit 1
fi
echo "LeanDoc test hooks check passed."
