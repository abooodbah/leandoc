#!/usr/bin/env python3
"""Usage tasks U-01 to U-15 from docs/TEST_PLAN.md on the real Linux host.

Each task drives the real GTK window the way a person would: launches from
the command line (as a file manager does), second launches, real keyboard
and mouse input through XTEST (xdotool), the clipboard (xclip), file edits
from the shell, and the host's own drop handler. Run it under its own
display and session bus:

    bash tests/usage/run-linux.sh python3 tests/usage/run_usage.py
    bash tests/usage/run-linux.sh python3 tests/usage/run_usage.py --only U-02,U-05

Editors and browsers are stand-ins: small recorder programs registered in an
isolated XDG data folder, so a task can check what LeanDoc asked the desktop
to open without starting anything real. Writes usage-linux.json,
usage-linux.md, and one screenshot per task to --out; exits 1 on a failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "tests" / "perf"))

from leandoc_driver import Build, HostError, Session, sample_tree, wait_for_no_leftovers, xdotool  # noqa: E402
import make_report  # noqa: E402

FEATURES = ROOT / "tests" / "fixtures" / "features"
SECURITY = ROOT / "tests" / "fixtures" / "security"
KINDS = ROOT / "tests" / "fixtures" / "kinds"
EXPECTED = json.loads((ROOT / "tests" / "fixtures" / "expected.json").read_text("utf-8"))
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class Failure(AssertionError):
    pass


def check(condition, message):
    if not condition:
        raise Failure(message)


# Stand-in desktop ------------------------------------------------------------

class FakeDesktop:
    """An isolated XDG data and config folder with recorder applications.

    Each recorder appends its arguments to launched.txt. `editors` adds a
    `libreoffice` on PATH; `default_docx` registers a default handler for
    .docx; `browser` registers https, http, and mailto handlers."""

    def __init__(self, *, editors=False, default_docx=False, browser=True):
        self.root = Path(tempfile.mkdtemp(prefix="leandoc-desktop-"))
        self.share = self.root / "share"
        self.apps = self.share / "applications"
        self.apps.mkdir(parents=True)
        os.symlink("/usr/share/mime", self.share / "mime")
        self.config = self.root / "config"
        self.config.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "launched.txt"
        self.recorder = self.root / "record.sh"
        self.recorder.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >> "{self.log}"\n')
        self.recorder.chmod(0o755)
        defaults = []
        if browser:
            self.app("browser", "x-scheme-handler/https;x-scheme-handler/http;x-scheme-handler/mailto;",
                     "%u")
            defaults += [f"x-scheme-handler/{scheme}=browser.desktop"
                         for scheme in ("https", "http", "mailto")]
        if default_docx:
            self.app("writer", DOCX_TYPE + ";", "%f")
            defaults.append(f"{DOCX_TYPE}=writer.desktop")
        (self.config / "mimeapps.list").write_text(
            "[Default Applications]\n" + "\n".join(defaults) + "\n")
        if editors:
            editor = self.bin / "libreoffice"
            editor.write_text(f'#!/bin/sh\nexec "{self.recorder}" libreoffice "$@"\n')
            editor.chmod(0o755)

    def app(self, name, mime, field):
        (self.apps / f"{name}.desktop").write_text(
            f"[Desktop Entry]\nType=Application\nName={name}\n"
            f"Exec={self.recorder} {name} {field}\nMimeType={mime}\n")

    def env(self):
        return {"XDG_DATA_DIRS": str(self.share), "XDG_DATA_HOME": str(self.root / "home"),
                "PATH": f"{self.bin}:/usr/bin/false-path-only"}

    def launched(self, wait=0.0):
        deadline = time.monotonic() + wait
        while True:
            lines = self.log.read_text().splitlines() if self.log.exists() else []
            if lines or time.monotonic() >= deadline:
                return lines
            time.sleep(0.1)

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


# Helpers -----------------------------------------------------------------------

def session(build, documents=(), **kwargs):
    wait_for_no_leftovers()
    desktop = kwargs.pop("desktop", None)
    if desktop is not None:
        kwargs.setdefault("config_dir", desktop.config)
        kwargs["env"] = {**desktop.env(), **kwargs.get("env", {})}
    return Session(build, documents, **kwargs)


def focus(app):
    window = app.window_id()
    xdotool("windowfocus", "--sync", window)
    return window


def click_element(app, selector, window=None, button="1"):
    box = app.js(f"""const node = document.querySelector({json.dumps(selector)});
        if (!node) return null; node.scrollIntoView({{block: 'center'}});
        const r = node.getBoundingClientRect();
        return {{x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + r.height / 2)}};""")
    check(box is not None, f"{selector} exists")
    window = window or app.window_id()
    xdotool("mousemove", "--window", window, str(box["x"]), str(box["y"]))
    time.sleep(0.15)
    xdotool("click", button)
    return box


def key(*keys, delay=0.15):
    for name in keys:
        xdotool("key", "--clearmodifiers", name)
        time.sleep(delay)


def scroll_top(app):
    return app.eval("document.getElementById('docScroller').scrollTop")


def wait_state(app, state, timeout_ms=30000):
    app.wait(f"document.documentElement.dataset.renderState === '{state}'", timeout_ms=timeout_ms)


def windows_of(app):
    result = subprocess.run(["xdotool", "search", "--onlyvisible", "--pid", str(app.pid)],
                            capture_output=True, text=True)
    return result.stdout.split()


def tree_names(app):
    return [p["exe"] for p in sample_tree(app.pid).processes]


def clipboard():
    result = subprocess.run(["xclip", "-o", "-selection", "clipboard"], capture_output=True,
                            text=True, timeout=10)
    return result.stdout


# Tasks ---------------------------------------------------------------------------

TASKS = {}


def task(test_id, title):
    def register(function):
        TASKS[test_id] = (title, function)
        return function
    return register


@task("U-01", "Open an emailed report from the command line")
def u01(ctx):
    report = ctx.docs["report-3"]
    with session(ctx.build, [report]) as app:
        rendered = app.wait_render(timeout=30)
        state = app.state()
        visible = app.js("""const page = document.querySelector('#docBody section.docx');
            const r = page.getBoundingClientRect();
            return r.top < innerHeight && r.bottom > 0 && r.height > 300;""")
        windows = windows_of(app)
        ctx.shot(app, "U-01")
        check(state["state"] == "ready", f"render state is {state['state']}")
        check(visible, "the first page is visible in the window")
        check(state["fileName"] == "report-3.docx", f"file name shown: {state['fileName']}")
        check("3 pages" in state["fileMeta"], f"page count shown: {state['fileMeta']}")
        check(state["status"] == "", f"no prompt or message: {state['status']!r}")
        check(len(windows) == 1, f"one window and no dialog: {len(windows)} windows")
        return f"first page {rendered.ms} ms after the reader was ready; meta '{state['fileMeta']}'"


@task("U-02", "Read a 20-page document to the end with the keyboard only")
def u02(ctx):
    with session(ctx.build, [ctx.docs["report-20"]]) as app:
        app.wait_render(timeout=30)
        focus(app)
        time.sleep(0.3)
        positions = {"start": scroll_top(app)}
        outline = lambda: app.eval(  # noqa: E731
            "(document.querySelector('#outlineList [aria-current]') || {}).textContent || ''")
        sections = [outline()]
        for name in ("Page_Down", "Page_Down", "space", "Down", "Down"):
            key(name)
            positions[name + str(len(positions))] = scroll_top(app)
        sections.append(outline())
        key("End")
        time.sleep(0.4)
        end = app.js("const s = document.getElementById('docScroller');"
                     "return {top: s.scrollTop, max: s.scrollHeight - s.clientHeight};")
        sections.append(outline())
        key("Up")
        up = scroll_top(app)
        key("Home")
        time.sleep(0.4)
        home = scroll_top(app)
        sections.append(outline())
        ctx.shot(app, "U-02")
        values = list(positions.values())
        check(all(later > earlier for earlier, later in zip(values, values[1:])),
              f"Page Down, Space, and Down each move down: {positions}")
        check(abs(end["top"] - end["max"]) <= 2, f"End reaches the end: {end}")
        check(up < end["top"], "Up moves up from the end")
        check(home == 0, f"Home returns to the top: {home}")
        check(sections[1] != sections[0] or sections[2] != sections[0],
              f"the outline follows the position: {sections}")
        check(sections[-1] == sections[0], f"the outline returns to the first section: {sections}")
        return f"positions {positions}, end {end['top']}, outline {sections[0]!r} to {sections[2]!r}"


@task("U-03", "Open in the editor, and Word for the web without one")
def u03(ctx):
    notes = []
    report = ctx.docs["report-3"]
    desktop = FakeDesktop(editors=True)
    try:
        with session(ctx.build, [report], desktop=desktop) as app:
            app.wait_render()
            label = app.eval("document.getElementById('editorButton').textContent")
            check(label == "Open in LibreOffice", f"label with LibreOffice on PATH: {label}")
            focus(app)
            key("ctrl+shift+e")
            launched = desktop.launched(wait=5)
            check(launched and launched[-1] == f"libreoffice {report}",
                  f"LibreOffice started with the file: {launched}")
            notes.append(f"LibreOffice: {launched[-1]}")
    finally:
        desktop.close()

    desktop = FakeDesktop(default_docx=True)
    try:
        with session(ctx.build, [report], desktop=desktop) as app:
            app.wait_render()
            label = app.eval("document.getElementById('editorButton').textContent")
            check(label == "Open in writer", f"label with only a default .docx app: {label}")
            click_element(app, "#editorButton")
            launched = desktop.launched(wait=5)
            check(launched and launched[-1] == f"writer {report}", f"default app started: {launched}")
            notes.append(f"default app: {launched[-1]}")
    finally:
        desktop.close()

    desktop = FakeDesktop()
    try:
        with session(ctx.build, [report], desktop=desktop) as app:
            app.wait_render()
            label = app.eval("document.getElementById('editorButton').textContent")
            check(label == "Open Word for the web", f"label with no editor: {label}")
            click_element(app, "#editorButton")
            launched = desktop.launched(wait=5)
            app.wait("!document.getElementById('statusToast').hidden")
            toast = app.eval("document.getElementById('statusToast').textContent")
            ctx.shot(app, "U-03")
            check(launched and launched[-1] == "browser https://www.office.com/launch/word",
                  f"the browser opened Word for the web: {launched}")
            check("Upload the file there" in toast, f"the explanation toast: {toast}")
            notes.append(f"no editor: {launched[-1]}; toast '{toast}'")
    finally:
        desktop.close()
    return "; ".join(notes)


@task("U-04", "Open five attachments in a row from the file manager")
def u04(ctx):
    files = ctx.docs["five"]
    with session(ctx.build, [files[0]]) as app:
        first = app.wait_timing("rendered")[0]
        handoffs = []
        for index, path in enumerate(files[1:], start=2):
            started = time.monotonic()
            result = subprocess.run([str(ctx.build.binary), "--", str(path)], env=app.environment(),
                                    capture_output=True, timeout=20)
            check(result.returncode == 0, f"launch {index} exits cleanly")
            event = app.wait_timing("rendered", count=index)
            handoffs.append(round((event[1]["_arrived"] - started) * 1000))
        tabs = app.eval("document.querySelectorAll('.tab').length")
        names = tree_names(app)
        leandoc_processes = int(subprocess.run(
            ["pgrep", "-c", "-x", "leandoc"], capture_output=True, text=True).stdout.strip() or 0)
        windows = windows_of(app)
        ctx.shot(app, "U-04")
        check(tabs == 5, f"five tabs: {tabs}")
        check(len(windows) == 1, f"one window: {len(windows)}")
        check(names.count("leandoc") == 1 and names.count("WebKitWebProcess") == 1,
              f"one process tree with one web process: {sorted(names)}")
        check(handoffs[-1] <= max(handoffs[0] * 1.5, handoffs[0] + 150),
              f"the fifth opens as fast as the second: {handoffs}")
        return (f"first page {first} ms after launch; later launches to rendered {handoffs} ms; "
                f"{leandoc_processes} leandoc process(es) on the machine")


FIND_STATE = """const i = document.getElementById('findInput');
return {count: document.getElementById('findCount').textContent, value: i.value,
  focused: document.activeElement === i,
  highlights: (window.CSS && CSS.highlights && CSS.highlights.get('leandoc-find')) ?
    CSS.highlights.get('leandoc-find').size : document.querySelectorAll('mark.ld-find').length};"""


@task("U-05", "Find a phrase, step through matches, switch views, find again, Escape")
def u05(ctx):
    with session(ctx.build, [ctx.docs["report-20"]]) as app:
        app.wait_render()
        focus(app)
        key("ctrl+f")
        xdotool("type", "--delay", "40", "station")
        time.sleep(0.4)
        first = app.js(FIND_STATE)
        key("Return")
        second = app.js(FIND_STATE)
        key("F3")
        third = app.js(FIND_STATE)
        key("shift+F3")
        back = app.js(FIND_STATE)
        page_total = first["count"].split("/")[-1]
        # In the find field Ctrl+Shift+V pastes as plain text, so the reader
        # clicks Reading, then finds again by typing the phrase anew.
        click_element(app, "#viewReading")
        app.wait_render()
        carried = app.js(FIND_STATE)
        key("ctrl+f")
        xdotool("type", "--delay", "40", "station")
        time.sleep(0.4)
        reading = app.js(FIND_STATE)
        view = app.eval("document.documentElement.dataset.view")
        ctx.shot(app, "U-05")
        app.js("document.getElementById('findInput').focus(); return 1")
        key("Escape")
        cleared = app.js(FIND_STATE)
        check(first["count"].startswith("1/") and int(page_total) > 10,
              f"the first match is selected with a count: {first}")
        check(second["count"].startswith("2/") and third["count"].startswith("3/"),
              f"Enter and F3 step forward: {second['count']}, {third['count']}")
        check(back["count"].startswith("2/"), f"Shift+F3 steps back: {back['count']}")
        check(view == "reading", f"switched to reading view: {view}")
        check(carried["count"].split("/")[-1] == page_total,
              f"the search carries over to reading view: {carried['count']}")
        check(reading["count"].split("/")[-1] == page_total,
              f"same count in reading view: {page_total} and {reading['count']}")
        check(cleared["count"] == "" and cleared["value"] == "" and cleared["highlights"] == 0,
              f"Escape clears: {cleared}")
        return f"'station': page view {first['count']}, reading view {reading['count']}"


@task("U-06", "Jump through a long report with the navigation pane")
def u06(ctx):
    with session(ctx.build, [ctx.docs["report-60"]]) as app:
        app.wait_render(timeout=60)
        entries = app.eval("document.querySelectorAll('#outlineList a').length")
        # The reader keeps a 16 px scroll margin above a heading it jumps to.
        result = app.js("""
            const links = [...document.querySelectorAll('#outlineList a')];
            const scroller = document.getElementById('docScroller');
            const bad = [];
            for (let i = 0; i < links.length; i += 1) {
              links[i].click();
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              const target = document.querySelector(`[data-ld-target="${i}"]`);
              const top = target ? target.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null;
              const current = document.querySelector('#outlineList [aria-current]');
              const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2;
              if (!target || target.textContent.trim() !== links[i].textContent.trim() ||
                  (!atEnd && (top < -1 || top > 24)) || current !== links[i]) {
                bad.push({i, text: links[i].textContent, top, current: current && current.textContent});
              }
            }
            return {count: links.length, bad};""", timeout=180)
        scrolled = app.js("""
            const scroller = document.getElementById('docScroller');
            const links = [...document.querySelectorAll('#outlineList a')];
            const out = [];
            for (const ratio of [0.1, 0.5, 0.9]) {
              scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * ratio;
              await new Promise((r) => setTimeout(r, 120));
              const current = document.querySelector('#outlineList [aria-current]');
              const index = links.indexOf(current);
              const target = document.querySelector(`[data-ld-target="${index}"]`);
              const next = document.querySelector(`[data-ld-target="${index + 1}"]`);
              const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
              const nextTop = next ? next.getBoundingClientRect().top - scroller.getBoundingClientRect().top : 1e9;
              out.push({ratio, current: current.textContent, ok: top <= scroller.clientHeight * 0.25 + 1 &&
                nextTop > Math.max(48, scroller.clientHeight * 0.25)});
            }
            return out;""")
        ctx.shot(app, "U-06")
        check(entries > 60, f"the outline lists the headings: {entries}")
        check(not result["bad"], f"every heading lands at its paragraph: {result['bad'][:5]}")
        check(all(item["ok"] for item in scrolled), f"the current section follows scrolling: {scrolled}")
        return f"{result['count']} headings checked; scrolling highlights {[s['current'] for s in scrolled]}"


SECURITY_RENDERS = {
    "remote-template.docx": "a remote template (not fetched)",
    "remote-image.docx": "remote images (not fetched)",
    "include-field.docx": "external content (not fetched)",
    "dde.docx": "DDE fields (not run)",
    "macro.docm": "macros (not run)",
    "activex.docx": "1 ActiveX control",
    "ole.docx": "1 embedded object",
    "altchunk.docx": "1 imported content block",
    "embedded-fonts.docx": "embedded fonts (system fonts used)",
    "hyperlinks.docx": None,
    "svg-image.docx": None,
}


@task("U-07", "Open each security fixture")
def u07(ctx):
    rows = []
    paths = sorted(SECURITY.iterdir())
    with session(ctx.build, []) as app:
        wait_state(app, "empty")
        for path in paths:
            app.command(f"open {path}")
            app.wait("['ready','fallback','failed'].includes(document.documentElement.dataset.renderState)"
                     " && document.getElementById('fileName').textContent === " + json.dumps(path.name))
            state = app.js("""const root = document.documentElement;
                return {state: root.dataset.renderState, bar: document.getElementById('fidelityBar').hidden ? '' :
                  document.getElementById('fidelityText').textContent,
                  code: document.getElementById('statePane').dataset.code || '',
                  message: document.getElementById('stateMessage').textContent,
                  offOrigin: performance.getEntriesByType('resource').filter((e) =>
                    !e.name.startsWith(location.origin) && !/^(blob|data):/.test(e.name)).length};""")
            expected = EXPECTED[f"security/{path.name}"]
            rows.append((path.name, state))
            if path.name in ("hyperlinks.docx", "remote-image.docx"):
                ctx.shot(app, f"U-07-{path.stem}")
            check(state["offOrigin"] == 0, f"{path.name}: nothing fetched outside the app")
            check(len(windows_of(app)) == 1, f"{path.name}: no dialog")
            if expected["ok"] and expected["kind"] in ("docx", "docm"):
                check(state["state"] == "ready", f"{path.name}: renders ({state})")
                phrase = SECURITY_RENDERS.get(path.name)
                if phrase:
                    check(phrase in state["bar"], f"{path.name}: the bar names the risk: {state['bar']!r}")
                elif not expected["features"]:
                    check(state["bar"] == "", f"{path.name}: no bar without features")
            else:
                check(state["state"] == "fallback", f"{path.name}: fallback page ({state['state']})")
                code = expected["errorCode"] or expected["kind"]
                check(state["code"] == code, f"{path.name}: fallback code {state['code']} != {code}")
    return f"{len(rows)} fixtures: " + ", ".join(f"{name} {state['state']}" for name, state in rows)


@task("U-08", "Open a .doc, an encrypted file, an .odt, a renamed .xlsx, and a 0-byte file")
def u08(ctx):
    work = Path(tempfile.mkdtemp(prefix="leandoc-u08-"))
    try:
        cases = {
            "legacy.doc": (SECURITY / "legacy.doc", "legacy-doc", "Word 97-2003"),
            "protected.docx": (SECURITY / "encrypted.docx", "encrypted-ooxml", "password protected"),
            "minutes.odt": (KINDS / "minimal.odt", "odt", "OpenDocument"),
            "budget.docx": (KINDS / "spreadsheet.xlsx", "missing-main-part", "Word document part"),
            "empty.docx": (None, None, None),
        }
        rows = []
        with session(ctx.build, []) as app:
            wait_state(app, "empty")
            for name, (source, code, phrase) in cases.items():
                target = work / name
                if source:
                    shutil.copy(source, target)
                else:
                    target.write_bytes(b"")
                app.command(f"open {target}")
                app.wait("document.getElementById('fileName').textContent === " + json.dumps(name) +
                         " && document.documentElement.dataset.renderState !== 'loading'")
                state = app.js("""return {state: document.documentElement.dataset.renderState,
                    code: document.getElementById('statePane').dataset.code || '',
                    message: document.getElementById('stateMessage').textContent,
                    editor: !document.getElementById('stateEditorButton').hidden,
                    editorLabel: document.getElementById('stateEditorButton').textContent};""")
                rows.append((name, state))
                ctx.shot(app, f"U-08-{target.stem}")
                check(state["state"] == "fallback", f"{name}: fallback page, not {state['state']}")
                if code:
                    check(state["code"] == code, f"{name}: code {state['code']} != {code}")
                    check(phrase in state["message"], f"{name}: message {state['message']!r}")
                else:
                    check(state["message"].strip() != "", f"{name}: a readable message")
                check(state["editor"] and state["editorLabel"], f"{name}: the open-in-editor action")
        return "; ".join(f"{n}: {s['code']} '{s['message']}'" for n, s in rows)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# List paragraphs carry an indent and a marker, so only plain paragraphs are
# checked for flush-right text; lists are checked for direction. (The driver
# joins a script onto one line, so scripts carry no // comments.)
ARABIC_CHECK = """
const body = document.getElementById('docBody');
const ps = [...body.querySelectorAll('p')];
const rtl = ps.filter((p) => /[\\u0600-\\u06ff]/.test(p.textContent) && p.textContent.trim());
const plain = rtl.filter((p) => !/docx-num-/.test(p.className) && !p.closest('td'));
const rightAligned = plain.filter((p) => {
  const range = document.createRange(); range.selectNodeContents(p);
  const t = range.getBoundingClientRect(), b = p.getBoundingClientRect();
  return getComputedStyle(p).direction === 'rtl' && (Math.abs(t.right - b.right) < 4 || t.width > b.width - 8);
}).length;
const lists = rtl.filter((p) => /docx-num-/.test(p.className)).map((p) => {
  const before = getComputedStyle(p, '::before');
  return {dir: getComputedStyle(p).direction, marker: before.content};
});
const tables = [...body.querySelectorAll('table')].map((t) => getComputedStyle(t).direction);
return {paragraphs: rtl.length, plain: plain.length, rightAligned, lists, tables,
  outline: [...document.querySelectorAll('#outlineList a')].map((a) => a.textContent)};
"""


@task("U-09", "Read the Arabic fixtures and a mixed Arabic and English report")
def u09(ctx):
    work = Path(tempfile.mkdtemp(prefix="leandoc-u09-"))
    try:
        named = work / "تقرير المسح.docx"
        shutil.copy(FEATURES / "mixed-direction.docx", named)
        files = [FEATURES / "arabic.docx", FEATURES / "arabic-list.docx",
                 FEATURES / "arabic-table.docx", named]
        notes = []
        with session(ctx.build, [files[0]]) as app:
            app.wait_render()
            for path in files:
                if path != files[0]:
                    app.command(f"open {path}")
                    app.wait_render()
                result = app.js(ARABIC_CHECK)
                key_name = path.name if path.parent == FEATURES else "features/mixed-direction.docx"
                expected = EXPECTED.get(f"features/{path.name}") or EXPECTED["features/mixed-direction.docx"]
                outline = [entry[1] for entry in expected["outline"]]
                check(result["paragraphs"] > 0, f"{path.name}: Arabic paragraphs")
                if expected["rightToLeft"]:
                    check(result["rightAligned"] == result["plain"],
                          f"{path.name}: every Arabic paragraph is right aligned: {result}")
                check(all(item["dir"] == "rtl" for item in result["lists"]),
                      f"{path.name}: Arabic lists are mirrored: {result['lists']}")
                if "table" in path.name:
                    check(result["tables"] == ["rtl"], f"{path.name}: the table is mirrored")
                check(result["outline"] == outline, f"{path.name}: outline {result['outline']}")
                word = next(w for w in " ".join(expected["text"]).split() if any("؀" <= c <= "ۿ" for c in w))
                app.js("const i = document.getElementById('findInput'); i.value = " + json.dumps(word) +
                       "; i.dispatchEvent(new Event('input')); return 1")
                count = app.eval("document.getElementById('findCount').textContent")
                check(count and count != "0", f"{path.name}: find '{word}' gives {count!r}")
                app.js("const i = document.getElementById('findInput'); i.value = ''; "
                       "i.dispatchEvent(new Event('input')); return 1")
                notes.append(f"{key_name}: {result['paragraphs']} RTL paragraphs, find '{word}' {count}")
            # One character at a time: the first Arabic letter must be drawn
            # left of the final "x", so the name is not reversed around ".docx".
            title = app.js("""const n = document.getElementById('fileName'); const text = n.firstChild;
                const box = (i) => { const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1);
                  return r.getBoundingClientRect(); };
                return {text: n.textContent, firstRight: box(0).right,
                  lastLeft: box(text.textContent.length - 1).left, window: document.title};""")
            ctx.shot(app, "U-09")
            check(title["text"] == named.name, f"the file name is shown as written: {title['text']}")
            check(title["lastLeft"] > title["firstRight"], f"'.docx' stays at the end of the name: {title}")
        return "; ".join(notes)
    finally:
        shutil.rmtree(work, ignore_errors=True)


@task("U-10", "Drop a supported file, then an unsupported one")
def u10(ctx):
    work = Path(tempfile.mkdtemp(prefix="leandoc-u10-"))
    try:
        text_file = work / "notes.txt"
        text_file.write_text("plain text")
        with session(ctx.build, [ctx.docs["report-3"]]) as app:
            app.wait_render()
            dropped = app.command(f"drop {FEATURES / 'tables.docx'}")
            app.wait_render()
            tabs = app.eval("document.querySelectorAll('.tab').length")
            name = app.eval("document.getElementById('fileName').textContent")
            refused = app.command(f"drop {text_file}")
            app.wait("!document.getElementById('statusToast').hidden")
            toast = app.eval("document.getElementById('statusToast').textContent")
            url = app.eval("location.href")
            after_tabs = app.eval("document.querySelectorAll('.tab').length")
            ctx.shot(app, "U-10")
            check(dropped.result == "accepted" and tabs == 2 and name == "tables.docx",
                  f"the dropped .docx opens in a tab: {dropped.result}, {tabs} tabs, {name}")
            check(refused.result == "refused" and "LeanDoc opens .docx" in toast,
                  f"the unsupported file shows a status: {refused.result}, {toast!r}")
            check(url == "leandoc://app/reader.html" and after_tabs == 2, "the page never navigates")
        return f"dropped .docx opened as tab 2; .txt refused with '{toast}'"
    finally:
        shutil.rmtree(work, ignore_errors=True)


@task("U-11", "Edit the open file elsewhere and save; LeanDoc reloads in place")
def u11(ctx):
    work = Path(tempfile.mkdtemp(prefix="leandoc-u11-"))
    try:
        document = work / "draft.docx"
        shutil.copy(ctx.docs["report-20"], document)
        with session(ctx.build, [document]) as app:
            app.wait_render()
            app.js("const s = document.getElementById('docScroller');"
                   "s.scrollTop = (s.scrollHeight - s.clientHeight) * 0.5; return 1")
            time.sleep(0.3)
            before = app.eval("(() => { const s = document.getElementById('docScroller');"
                              " return s.scrollTop / (s.scrollHeight - s.clientHeight); })()")
            # An editor saves by writing a new file and renaming it over the old one.
            replacement = work / ".draft.docx.tmp"
            make_report.make_report(replacement, 21)
            os.replace(replacement, document)
            reload = app.wait_render(timeout=15)
            time.sleep(0.4)
            after = app.eval("(() => { const s = document.getElementById('docScroller');"
                             " return s.scrollTop / (s.scrollHeight - s.clientHeight); })()")
            pages = app.state()["fileMeta"]
            # And some write the file in place.
            make_report.make_report(document, 20)
            second = app.wait_render(timeout=15)
            ctx.shot(app, "U-11")
            check('"generation":2' in reload.result, f"reloaded as a new generation: {reload.result}")
            check("21 pages" in pages, f"the new content is shown: {pages}")
            check(abs(after - before) < 0.06, f"position kept: {before:.3f} then {after:.3f}")
            check('"generation":3' in second.result, f"an in-place write reloads too: {second.result}")
        return f"rename-over reload in {reload.ms} ms, position {before:.2f} to {after:.2f}; in-place write reloaded"
    finally:
        shutil.rmtree(work, ignore_errors=True)


@task("U-12", "Close and relaunch: theme, view, and recent files remembered")
def u12(ctx):
    config = Path(tempfile.mkdtemp(prefix="leandoc-u12-"))
    try:
        report = ctx.docs["report-3"]
        with session(ctx.build, [report], config_dir=config) as app:
            app.wait_render()
            click_element(app, "#themeButton")
            click_element(app, "#themeButton")
            click_element(app, "#viewReading")
            app.wait_render()
            theme = app.eval("document.documentElement.getAttribute('data-theme')")
            check(theme == "dark", f"two clicks from System give Dark: {theme}")
        settings = (config / "leandoc" / "settings.ini").read_text()
        with session(ctx.build, [], config_dir=config) as app:
            wait_state(app, "empty")
            state = app.js("""return {theme: document.documentElement.getAttribute('data-theme'),
                view: document.documentElement.dataset.view,
                recent: [...document.querySelectorAll('.recent-item .recent-name')].map((n) => n.textContent)};""")
            ctx.shot(app, "U-12-empty")
            click_element(app, ".recent-item")
            app.wait_render()
            opened = app.js("return {name: document.getElementById('fileName').textContent,"
                            " view: document.documentElement.dataset.view};")
            app.js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'w', ctrlKey: true,"
                   " bubbles: true})); return 1")
            wait_state(app, "empty")
            click_element(app, "#clearRecent")
            app.wait("document.getElementById('recentSection').hidden")
        with session(ctx.build, [], config_dir=config) as app:
            wait_state(app, "empty")
            after = app.eval("document.querySelectorAll('.recent-item').length")
        check(state["theme"] == "dark" and state["view"] == "reading",
              f"theme and view remembered: {state}")
        check(state["recent"] == ["report-3.docx"], f"recent remembered: {state['recent']}")
        check(opened == {"name": "report-3.docx", "view": "reading"}, f"recent opens: {opened}")
        check(after == 0, f"Clear recent empties the list across launches: {after}")
        return f"settings.ini after the first run: {settings.strip().replace(chr(10), ' | ')}"
    finally:
        shutil.rmtree(config, ignore_errors=True)


@task("U-13", "Click links of each kind")
def u13(ctx):
    desktop = FakeDesktop()
    work = Path(tempfile.mkdtemp(prefix="leandoc-u13-"))
    try:
        links = [("Web link", "https://example.org/report?a=1"),
                 ("Mail link", "mailto:team@example.org?subject=Hello&attach=/etc/passwd&body=Hi"),
                 ("Script link", "javascript:alert(1)"),
                 ("File link", "file:///etc/passwd"),
                 ("Plain web link", "http://example.org/")]
        document = make_report.make_link_document(work / "links.docx", links)
        with session(ctx.build, [document], desktop=desktop) as app:
            app.wait_render()
            time.sleep(0.5)
            before = desktop.launched()
            window = focus(app)
            results = {}
            for index, (text, _target) in enumerate(links):
                # Paragraph 1 is the title; each link fills its own paragraph.
                click_element(app, f"#docBody article > p:nth-of-type({index + 2})", window)
                time.sleep(0.8)
                results[text] = desktop.launched()[len(sum(results.values(), [])):]
            url = app.eval("location.href")
            ctx.shot(app, "U-13")
        launched = desktop.launched()
        check(before == [], f"nothing opens before a click: {before}")
        check(launched[0] == "browser https://example.org/report?a=1", f"https opened: {launched}")
        check(launched[1] == "browser mailto:team@example.org?subject=Hello&body=Hi",
              f"mailto opened without attach=: {launched}")
        check(launched[2] == "browser http://example.org/" and len(launched) == 3,
              f"javascript: and file: are inert: {launched}")
        check(url == "leandoc://app/reader.html", "the reader never navigates")
        return f"opened {launched}"
    finally:
        desktop.close()
        shutil.rmtree(work, ignore_errors=True)


@task("U-14", "Copy a selection and copy all text")
def u14(ctx):
    with session(ctx.build, [FEATURES / "headers-footers.docx"]) as app:
        app.wait_render()
        window = focus(app)
        expected_all = app.js("""const lines = [];
            document.querySelectorAll('#docBody section.docx > article p').forEach((p) => lines.push(p.textContent));
            return lines.join('\\n').trim();""")
        key("ctrl+shift+c")
        time.sleep(0.5)
        everything = clipboard()
        headers = app.js("return [...document.querySelectorAll('#docBody section.docx > header, "
                         "#docBody section.docx > footer')].map((n) => n.textContent.trim()).filter(Boolean)")
        target = app.js("""const p = [...document.querySelectorAll('#docBody article p')].find((n) => n.textContent.trim());
            const range = document.createRange(); range.selectNodeContents(p);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            return p.textContent;""")
        key("ctrl+c")
        time.sleep(0.5)
        selected = clipboard()
        ctx.shot(app, "U-14")
        check(everything.strip() == expected_all.strip(), "copy all is the body text, page by page")
        check(not any(h and h in everything for h in headers), f"no header or footer text: {headers}")
        check(selected.strip() == target.strip(), f"the selection is copied: {selected!r}")
        return f"copy all {len(everything)} characters, selection {selected.strip()!r}"


@task("U-15", "Delete or rename an open file, then switch back to its tab")
def u15(ctx):
    work = Path(tempfile.mkdtemp(prefix="leandoc-u15-"))
    try:
        first = work / "first.docx"
        second = work / "second.docx"
        third = work / "third.docx"
        for path in (first, second, third):
            shutil.copy(ctx.docs["report-3"], path)
        with session(ctx.build, [first, second, third]) as app:
            app.wait_render()
            app.wait("document.querySelectorAll('.tab').length === 3")
            first.unlink()
            second.rename(work / "second-renamed.docx")
            outcomes = {}
            for name in ("first.docx", "second.docx", "third.docx"):
                app.js(f"[...document.querySelectorAll('.tab')].find((t) => t.textContent.startsWith("
                       f"{json.dumps(name)})).click(); return 1")
                app.wait("document.getElementById('fileName').textContent === " + json.dumps(name) +
                         " && document.documentElement.dataset.renderState !== 'loading'")
                outcomes[name] = app.js("""return {state: document.documentElement.dataset.renderState,
                    message: document.getElementById('stateMessage').textContent,
                    code: document.getElementById('statePane').dataset.code || '',
                    tabs: document.querySelectorAll('.tab').length};""")
                if name == "first.docx":
                    ctx.shot(app, "U-15")
        for name in ("first.docx", "second.docx"):
            state = outcomes[name]
            check(state["state"] == "fallback" and state["message"],
                  f"{name}: a clear message: {state}")
        check(outcomes["third.docx"]["state"] == "ready" and outcomes["third.docx"]["tabs"] == 3,
              f"other tabs are unaffected: {outcomes['third.docx']}")
        return "; ".join(f"{n}: {s['state']} '{s['message']}'" for n, s in outcomes.items())
    finally:
        shutil.rmtree(work, ignore_errors=True)


# Main ------------------------------------------------------------------------------

class Context:
    def __init__(self, build, out, docs):
        self.build = build
        self.out = out
        self.docs = docs
        self.shots = []

    def shot(self, app, name):
        path = self.out / "shots" / f"{name}.png"
        try:
            app.screenshot(path)
            self.shots.append(str(path.relative_to(self.out)))
        except Exception as error:  # a screenshot never decides a task
            print(f"  screenshot {name} failed: {error}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--build")
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "usage"))
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    (out / "shots").mkdir(parents=True, exist_ok=True)
    docs_dir = out / "documents"
    docs_dir.mkdir(parents=True, exist_ok=True)
    docs = {f"report-{pages}": make_report.make_report(docs_dir / f"report-{pages}.docx", pages)
            for pages in (3, 20, 60)}
    docs["five"] = []
    for index in range(5):
        copy = docs_dir / f"attachment-{index + 1}.docx"
        shutil.copy(docs["report-3"], copy)
        docs["five"].append(copy)
    ctx = Context(Build.find(args.build), out, docs)
    only = {item.strip() for item in args.only.split(",") if item.strip()}
    results = {}
    for test_id, (title, function) in TASKS.items():
        if only and test_id not in only:
            continue
        started = time.monotonic()
        try:
            detail = function(ctx)
            results[test_id] = {"title": title, "result": "pass", "detail": detail}
        except (Failure, HostError) as error:
            results[test_id] = {"title": title, "result": "fail", "detail": str(error)}
        except Exception as error:  # noqa: BLE001 - a broken task is a failed task
            results[test_id] = {"title": title, "result": "fail",
                                "detail": f"{type(error).__name__}: {error}",
                                "trace": traceback.format_exc()}
        results[test_id]["seconds"] = round(time.monotonic() - started, 1)
        print(f"{test_id} {results[test_id]['result'].upper()}: {results[test_id]['detail']}", flush=True)
    revision = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True).stdout.strip()
    data = {"revision": revision, "results": results, "screenshots": ctx.shots}
    (out / "usage-linux.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
    lines = ["| ID | Task | Result | Detail |", "| --- | --- | --- | --- |"]
    for test_id, row in results.items():
        detail = row["detail"].replace("|", "/").replace("\n", " ")
        lines.append(f"| {test_id} | {row['title']} | {row['result']} | {detail} |")
    (out / "usage-linux.md").write_text("\n".join(lines) + "\n", "utf-8")
    print("\n".join(lines))
    return 1 if any(row["result"] == "fail" for row in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
