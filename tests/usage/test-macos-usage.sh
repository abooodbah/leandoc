#!/usr/bin/env bash
# The macOS subset of the usage tasks, through the real LeanDoc on WKWebView.
# macOS has no --test-script hook, so the subset is what the launch hooks can
# observe:
#   U-01  a document passed on the command line shows its first page
#         (--trace-timing reports `rendered`, --exit-after-render quits).
#   U-07  every security fixture: --smoke-test renders the ones the core
#         accepts and exits 1 for the ones it rejects; no crash, no hang.
#   U-08  the other kinds (.doc, encrypted, .odt, .rtf, a renamed .xlsx, an
#         empty ZIP, text named .docx): --smoke-test exits 1, the fallback.
#   bash tests/usage/test-macos-usage.sh build/macos/.../LeanDoc.app [OUT]
set -uo pipefail

app=${1:?LeanDoc.app}
out=${2:-artifacts/usage-macos}
binary="$app/Contents/MacOS/LeanDoc"
mkdir -p "$out"
summary="$out/usage-macos.md"
printf '| ID | Task | Result | Detail |\n| --- | --- | --- | --- |\n' > "$summary"
failures=0

record() {
  printf '| %s | %s | %s | %s |\n' "$1" "$2" "$3" "$4" >> "$summary"
  echo "$1 $3: $4"
  [[ $3 == pass ]] || failures=$((failures + 1))
}

run_with_timeout() {
  local seconds=$1
  shift
  "$@" &
  local pid=$!
  ( sleep "$seconds"; kill -9 "$pid" 2>/dev/null ) &
  local watchdog=$!
  wait "$pid"
  local status=$?
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return "$status"
}

# U-01
log=$(mktemp)
run_with_timeout 30 "$binary" --trace-timing --exit-after-render=500 -- "$PWD/tests/hosts/fixtures/smoke.docx" > "$log" 2>&1
status=$?
line=$(grep '^LEANDOC_TIMING rendered ' "$log" | head -1)
if [[ $status -eq 0 && -n $line ]]; then
  record U-01 "Open a document from the command line" pass "$line"
else
  record U-01 "Open a document from the command line" fail "exit $status; $(tail -3 "$log" | tr '\n' ' ')"
fi
rm -f "$log"

# U-07 and U-08: expected.json says which fixtures the core accepts.
for group in security kinds; do
  if [[ $group == security ]]; then id=U-07; task="Open each security fixture"; else id=U-08; task="Open other kinds of files"; fi
  rows=""
  problems=""
  while IFS=$'\t' read -r relative wanted; do
    start=$(date +%s)
    run_with_timeout 25 "$binary" --smoke-test "$PWD/tests/fixtures/$relative" > /dev/null 2>&1
    status=$?
    seconds=$(( $(date +%s) - start ))
    name=$(basename "$relative")
    if [[ $status -eq 0 ]]; then state=rendered; else state=fallback; fi
    rows+="$name $state (${seconds} s), "
    if [[ $status -ne $wanted ]]; then problems+="$name exit $status, expected $wanted; "; fi
  done < <(python3 - "$group" <<'PY'
import json, sys
group = sys.argv[1]
expected = json.load(open("tests/fixtures/expected.json", encoding="utf-8"))
for path, data in sorted(expected.items()):
    if path.startswith(group + "/"):
        ok = data["ok"] and data["kind"] in ("docx", "docm", "dotx", "dotm")
        print(f"{path}\t{0 if ok else 1}")
PY
)
  if [[ -z $problems && -n $rows ]]; then
    record "$id" "$task" pass "${rows%, }"
  else
    record "$id" "$task" fail "${problems}${rows%, }"
  fi
done

[[ -n ${GITHUB_STEP_SUMMARY:-} ]] && cat "$summary" >> "$GITHUB_STEP_SUMMARY"
if (( failures )); then
  echo "$failures macOS usage task(s) failed."
  exit 1
fi
echo "macOS usage subset passed."
