#!/usr/bin/env bash
# Opens the real GTK/WebKit host in Japanese and in Chinese.
#
#   Test-LinuxLanguage.sh <leandoc executable> <fixture.docx>
#
# Each case starts the host in smoke mode with a private XDG_CONFIG_HOME, a
# system language in LANGUAGE, and optionally a saved [Reader] Language. The
# host's smoke check fails unless the page shows the interface language the
# host resolved; this script checks that it is the expected one.
set -euo pipefail

if (($# != 2)); then
  printf '%s\n' 'Usage: Test-LinuxLanguage.sh <leandoc> <fixture.docx>' >&2
  exit 2
fi
executable=$1
fixture=$2
config=$(mktemp -d)
trap 'rm -rf "$config"' EXIT

run_case() {
  local name=$1 system=$2 saved=$3 expected=$4 output
  rm -rf "$config/leandoc"
  if [[ -n $saved ]]; then
    mkdir -p "$config/leandoc"
    printf '[Reader]\nLanguage=%s\n' "$saved" > "$config/leandoc/settings.ini"
  fi
  if ! output=$(XDG_CONFIG_HOME="$config" LANGUAGE="$system" LANG=C.UTF-8 LC_ALL= LC_MESSAGES= \
      "$executable" --smoke-test "$fixture" 2>&1); then
    printf 'FAIL %s: the smoke test failed\n%s\n' "$name" "$output" >&2
    exit 1
  fi
  if [[ $output != *"\"lang\":\"$expected\""* ]]; then
    printf 'FAIL %s: expected the page in %s\n%s\n' "$name" "$expected" "$output" >&2
    exit 1
  fi
  printf 'PASS %s\n' "$name"
}

run_case "a Japanese system opens in Japanese" ja "" ja
run_case "a Chinese (Taiwan) system keeps English, as in LeanMark" zh_TW "" en
run_case "a Simplified Chinese system opens in Simplified Chinese" zh_CN "" zh-CN
run_case "a French system opens in English" fr "" en
run_case "a saved Chinese choice overrides a Japanese system" ja zh-CN zh-CN
run_case "a saved English choice overrides a Chinese system" zh_CN en en

# Choosing a language in the settings panel saves it as [Reader] Language.
# Not in smoke mode, which never saves: the test script clicks the choice and
# quits, and the next launch must open in it.
rm -rf "$config/leandoc"
script="$config/choose.txt"
printf '%s\n' \
  "js document.querySelector('input[name=\"settings-language\"][value=\"ja\"]').click(); return document.documentElement.lang;" \
  'sleep 300' 'quit' > "$script"
if ! output=$(XDG_CONFIG_HOME="$config" LANGUAGE=en LANG=C.UTF-8 LC_ALL= LC_MESSAGES= \
    "$executable" --test-script "$script" 2>&1); then
  printf 'FAIL choosing Japanese: the scripted launch failed\n%s\n' "$output" >&2
  exit 1
fi
if ! grep -qx 'Language=ja' "$config/leandoc/settings.ini"; then
  printf 'FAIL choosing Japanese: expected Language=ja, saved:\n' >&2
  cat "$config/leandoc/settings.ini" >&2 || true
  exit 1
fi
printf 'PASS choosing Japanese in the settings panel saves it\n'
run_case "the saved choice is used on the next launch" en ja ja

printf '%s\n' 'LeanDoc Linux language checks passed.'
