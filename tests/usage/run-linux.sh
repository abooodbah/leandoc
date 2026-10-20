#!/usr/bin/env bash
# Runs a LeanDoc Linux harness under its own Xvfb display (2560 x 1600) and
# D-Bus session bus, with the environment the CTest smoke tests use:
#   bash tests/usage/run-linux.sh python3 tests/perf/run_perf.py
# Xvfb has no DRI3, so WebKit's compositing is off and GTK renders with Mesa's
# software GL; both are recorded in the results.
set -euo pipefail
export WEBKIT_DISABLE_COMPOSITING_MODE=${WEBKIT_DISABLE_COMPOSITING_MODE:-1}
export GTK_A11Y=${GTK_A11Y:-none}
export NO_AT_BRIDGE=1
exec dbus-run-session -- xvfb-run -a -s "-screen 0 2560x1600x24 -nolisten tcp" "$@"
