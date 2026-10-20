#!/usr/bin/env python3
"""Regression checks of the Linux host, run by CTest under Xvfb and D-Bus.

    xvfb-run -a python3 tests/hosts/linux_regressions.py BUILD_DIR

1. Every fixture the core rejects or LeanDoc does not render (17 of them:
   security errors, legacy, encrypted, RTF, ODT, spreadsheet, empty, plain
   text) shows its own fallback page with the open-in-editor action.
2. The context menu on a link offers only copy actions, and choosing every
   remaining item fetches nothing (a local HTTP server sees no request).
3. A web process that keeps dying is reloaded at most three times a minute,
   then the document shows the renderer-stopped page.
4. A file name that is not valid UTF-8 opens, shows in the recent list, and
   opens again from there; a settings file with such a path keeps its list.
5. The keyboard keeps working: after Ctrl+Tab (which GTK uses to move the
   focus into a hidden widget) and after Tab past the last control, the
   next keys still reach the page.
"""

from __future__ import annotations

import http.server
import json
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "usage"))
sys.path.insert(0, str(ROOT / "tests" / "perf"))

from leandoc_driver import Build, Session, wait_for_no_leftovers, xdotool  # noqa: E402
import make_report  # noqa: E402

EXPECTED = json.loads((ROOT / "tests" / "fixtures" / "expected.json").read_text("utf-8"))
RENDERABLE = {"docx", "docm", "dotx", "dotm"}
failures = []


def check(condition, message):
    if not condition:
        failures.append(message)
        print(f"FAIL  {message}", flush=True)


def fallbacks(build):
    rejected = {path: data for path, data in EXPECTED.items()
                if not data["ok"] or data["kind"] not in RENDERABLE}
    with Session(build, []) as app:
        app.wait("document.documentElement.dataset.renderState === 'empty'")
        for relative, data in sorted(rejected.items()):
            path = ROOT / "tests" / "fixtures" / relative
            app.command(f"open {path}")
            app.wait("document.getElementById('fileName').textContent === " + json.dumps(path.name) +
                     " && document.documentElement.dataset.renderState !== 'loading'")
            state = app.js("""return {state: document.documentElement.dataset.renderState,
                code: document.getElementById('statePane').dataset.code || '',
                message: document.getElementById('stateMessage').textContent.trim(),
                editor: !document.getElementById('stateEditorButton').hidden};""")
            code = data["errorCode"] or data["kind"]
            check(state["state"] == "fallback", f"{relative}: fallback page, not {state['state']}")
            check(state["code"] == code, f"{relative}: code {state['code']} != {code}")
            check(len(state["message"]) > 10 and "Error" not in state["message"],
                  f"{relative}: readable message {state['message']!r}")
            check(state["editor"], f"{relative}: the open-in-editor action is offered")
    print(f"fallback pages: {len(rejected)} fixtures checked", flush=True)
    return len(rejected)


def context_menu(build):
    hits = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append(self.path)
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    work = Path(tempfile.mkdtemp(prefix="leandoc-menu-"))
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/probe"
        document = make_report.make_link_document(work / "menu.docx", [("A local link", url)])
        with Session(build, [document]) as app:
            app.wait_render()
            box = app.js("const r = document.querySelector('#docBody a').getBoundingClientRect();"
                         "return {x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2)};")
            window = app.window_id()
            xdotool("windowfocus", "--sync", window)
            menus = []
            for item in range(3):
                xdotool("mousemove", "--window", window, str(box["x"]), str(box["y"]))
                xdotool("click", "3")
                time.sleep(0.8)
                for _ in range(item + 1):
                    xdotool("key", "Down")
                    time.sleep(0.1)
                xdotool("key", "Return")
                time.sleep(1.0)
                xdotool("key", "Escape")
                menus = [line for line in app.lines if line.startswith("LEANDOC_EVENT context-menu")]
            location = app.eval("location.href")
        check(bool(menus), "the context menu opened")
        actions = {a for line in menus for a in line.split("actions=")[1].split(",") if a}
        # WebKitContextMenuAction values: 0 separator, 4 copy link, 14 copy,
        # 15 cut, 16 paste, 17 delete, 18 select all, 43 paste as plain text.
        check(actions <= {"0", "4", "14", "15", "16", "17", "18", "43"},
              f"only copy and edit actions remain: {sorted(actions)}")
        check(hits == [], f"no request reached the link target: {hits}")
        check(location == "leandoc://app/reader.html", "the reader did not navigate")
        print(f"context menu: actions {sorted(actions)}, requests {hits}", flush=True)
    finally:
        server.shutdown()
        shutil.rmtree(work, ignore_errors=True)


def crash_cap(build):
    fixture = ROOT / "tests" / "fixtures" / "features" / "tables.docx"
    with Session(build, [fixture]) as app:
        app.wait_render()
        states = []
        for attempt in range(5):
            web = [p["pid"] for p in app.memory().processes if p["exe"] == "WebKitWebProcess"]
            os.kill(web[0], signal.SIGKILL)
            time.sleep(3)
            try:
                states.append(app.eval("document.getElementById('statePane').dataset.code || "
                                       "document.documentElement.dataset.renderState"))
            except Exception:  # noqa: BLE001 - after the fifth crash nothing reloads
                states.append("no page")
        events = [line for line in app.lines if line.startswith("LEANDOC_EVENT web-process-terminated")]
    check(states[:3] == ["ready"] * 3, f"the first three crashes reload the document: {states}")
    check(states[3] == "renderer-stopped", f"the fourth shows the renderer-stopped page: {states}")
    check(states[4] == "no page" and len(events) == 5, f"the fifth is not reloaded: {states} {events}")
    print(f"crash cap: {states}", flush=True)


def non_utf8_names(build):
    work = tempfile.mkdtemp(prefix="leandoc-names-").encode()
    try:
        bad = os.path.join(work, b"caf\xe9 report.docx")
        shutil.copy(ROOT / "tests" / "fixtures" / "features" / "tables.docx", bad)
        config = Path(os.fsdecode(work)) / "config"
        (config / "leandoc").mkdir(parents=True)
        # An older settings file: plain paths, one of them not valid UTF-8.
        (config / "leandoc" / "settings.ini").write_bytes(
            b"[Reader]\nTheme=system\nView=page\nRecent=" + bad + b";/missing/notes.docx;\n")
        with Session(build, [], config_dir=config) as app:
            app.wait("document.documentElement.dataset.renderState === 'empty'")
            names = app.js("return [...document.querySelectorAll('.recent-name')].map((n) => n.textContent)")
            app.js("document.querySelector('.recent-item').click(); return 1")
            rendered = app.wait_render()
            title = app.eval("document.getElementById('fileName').textContent")
        stored = (config / "leandoc" / "settings.ini").read_bytes()
        check(len(names) == 2 and names[0].startswith("caf") and names[0].endswith(" report.docx"),
              f"the recent list keeps both entries: {names}")
        check('"failed":false' in rendered.result, "the non-UTF-8 file opens from the recent list")
        check(title.startswith("caf"), f"its display name is shown: {title!r}")
        check(b"file://" in stored and b"caf%E9%20report.docx" in stored,
              f"recent paths are stored as file URIs: {stored!r}")
        print(f"non-UTF-8 names: recent {names}, title {title!r}", flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def keyboard_focus(build):
    features = ROOT / "tests" / "fixtures" / "features"
    with Session(build, [features / "tables.docx", features / "notes.docx"]) as app:
        app.wait_render()
        app.wait("document.querySelectorAll('.tab').length === 2")
        window = app.window_id()
        xdotool("windowfocus", "--sync", window)
        time.sleep(0.3)
        app.js("window.__keys = 0; document.addEventListener('keydown', () => { window.__keys += 1; }, true); return 1")
        xdotool("key", "--clearmodifiers", "ctrl+Tab")
        app.wait_render()
        time.sleep(0.3)
        active = app.eval("document.getElementById('fileName').textContent")
        before = app.eval("window.__keys")
        for _ in range(3):
            xdotool("key", "--clearmodifiers", "Tab")
            time.sleep(0.15)
        after_ctrl_tab = app.eval("window.__keys") - before
        # Tab from the document area, the last control, comes round to the
        # first control instead of leaving the page.
        app.js("document.getElementById('docScroller').focus(); return 1")
        xdotool("key", "--clearmodifiers", "Tab")
        time.sleep(0.2)
        wrapped = app.eval("document.activeElement.id")
        xdotool("key", "--clearmodifiers", "Tab")
        time.sleep(0.2)
        next_control = app.eval("document.activeElement.id")
    check(active == "tables.docx", f"Ctrl+Tab switches the tab: {active}")
    check(after_ctrl_tab == 3, f"after Ctrl+Tab every key still reaches the page: {after_ctrl_tab} of 3")
    check(wrapped == "findInput" and next_control == "viewPage",
          f"Tab wraps from the last control to the first: {wrapped}, then {next_control}")
    print(f"keyboard focus: {after_ctrl_tab} of 3 keys after Ctrl+Tab, wrap to {wrapped}", flush=True)


def main():
    build = Build.find(sys.argv[1] if len(sys.argv) > 1 else None)
    os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
    for step in (fallbacks, context_menu, crash_cap, non_utf8_names, keyboard_focus):
        wait_for_no_leftovers()
        try:
            step(build)
        except Exception as error:  # noqa: BLE001
            check(False, f"{step.__name__}: {type(error).__name__}: {error}")
    if failures:
        print(f"{len(failures)} Linux regression check(s) failed.")
        return 1
    print("LeanDoc Linux regression checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
