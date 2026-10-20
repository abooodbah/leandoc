#!/usr/bin/env python3
"""UI checks on the real Linux host: UI-01 captures, UI-04, UI-05, UI-06, UI-09.

    bash tests/usage/run-linux.sh python3 tests/visual/run_ui_linux.py
    bash tests/usage/run-linux.sh python3 tests/visual/run_ui_linux.py --only UI-04

UI-01 screenshots every feature fixture in page and reading view, light and
dark, into artifacts/visual/linux/ (build_sheets.py assembles them). The
other checks drive the window with real keys and the mouse (xdotool), check
geometry and contrast in the page, and save a screenshot for each state.
Writes ui-linux.json and ui-linux.md; exits 1 on a failure.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tests" / "usage"))
sys.path.insert(0, str(ROOT / "tests" / "perf"))

from leandoc_driver import Build, HostError, Session, wait_for_no_leftovers, xdotool  # noqa: E402
from run_usage import FakeDesktop, Failure, check, click_element, focus, key  # noqa: E402
import make_report  # noqa: E402

FEATURES = ROOT / "tests" / "fixtures" / "features"


def settings(theme="light", view="page"):
    return f"[Reader]\nTheme={theme}\nView={view}\nRecent=\n"


def close_other_tabs(app):
    app.js("""const tabs = [...document.querySelectorAll('.tab')];
        for (const tab of tabs) {
          if (tab.getAttribute('aria-selected') !== 'true') {
            window.webkit.messageHandlers.leandoc.postMessage(JSON.stringify(
              {type: 'closeTab', id: Number(tab.dataset.tabKey)}));
          }
        }
        return tabs.length;""")
    app.wait("document.querySelectorAll('.tab').length <= 1")


def ui01(ctx):
    """Every feature fixture, page and reading view, light and dark."""
    fixtures = sorted(FEATURES.glob("*.docx"))
    shots = []
    for theme in ("light", "dark"):
        for view in ("page", "reading"):
            wait_for_no_leftovers()
            with Session(ctx.build, [], settings=settings(theme, view)) as app:
                app.wait("document.documentElement.dataset.renderState === 'empty'")
                app.command("resize 1280 860")
                time.sleep(0.5)
                for fixture in fixtures:
                    app.command(f"open {fixture}")
                    app.wait_render(timeout=60)
                    close_other_tabs(app)
                    app.js("document.getElementById('docScroller').scrollTop = 0; return 1")
                    time.sleep(0.6)
                    path = ctx.out / "linux" / f"{fixture.stem}--{view}-{theme}.png"
                    app.screenshot(path)
                    shots.append(str(path.relative_to(ctx.out)))
    check(len(shots) == len(fixtures) * 4, "every fixture was captured four times")
    return f"{len(shots)} screenshots of {len(fixtures)} fixtures"


LAYOUT_JS = """
const visible = (n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
const controls = [...document.querySelectorAll('.topbar button, .topbar input, .topbar .identity, .tab-strip .tab, #fidelityBar button')]
  .filter(visible);
const problems = [];
for (const c of controls) {
  const r = c.getBoundingClientRect();
  if (r.left < -1 || r.right > innerWidth + 1) problems.push('clipped: ' + (c.id || c.className));
  if (c.matches('button') && c.scrollWidth > c.clientWidth + 1) problems.push('truncated: ' + (c.id || c.textContent));
}
const solid = controls.filter((c) => !c.closest('.identity') || c.matches('.identity'));
for (let i = 0; i < solid.length; i += 1) {
  for (let j = i + 1; j < solid.length; j += 1) {
    if (solid[i].contains(solid[j]) || solid[j].contains(solid[i])) continue;
    const a = solid[i].getBoundingClientRect(), b = solid[j].getBoundingClientRect();
    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    if (overlap) problems.push('overlap: ' + (solid[i].id || solid[i].className) + ' / ' + (solid[j].id || solid[j].className));
  }
}
const outline = document.getElementById('outline');
const chrome = document.getElementById('chrome').getBoundingClientRect();
const scroller = document.getElementById('docScroller').getBoundingClientRect();
return {width: innerWidth, height: innerHeight, dpr: devicePixelRatio, problems,
  outlineShown: visible(outline), chromeHeight: Math.round(chrome.height),
  documentWidth: Math.round(scroller.width), documentHeight: Math.round(scroller.height),
  fidelityBelowChrome: document.getElementById('fidelityBar').getBoundingClientRect().bottom <= scroller.top + 1};
"""


def ui04(ctx):
    """Window sizes: 800 x 600, 1280 x 800, 1920 x 1080, and 1280 x 720 at 200 percent."""
    rows = []
    cases = [("800x600", 800, 600, {}), ("1280x800", 1280, 800, {}), ("1920x1080", 1920, 1080, {}),
             ("2560x1440-at-200", 1280, 720, {"GDK_SCALE": "2"})]
    documents = [FEATURES / "not-displayed.docx", ctx.docs["report-20"]]
    for name, width, height, env in cases:
        wait_for_no_leftovers()
        with Session(ctx.build, documents, env=env) as app:
            app.wait_render(timeout=60)
            app.command(f"resize {width} {height}")
            app.wait(f"Math.abs(innerWidth - {width}) <= 2", timeout_ms=10000)
            time.sleep(0.5)
            for state, select in (("report", None), ("fidelity", "not-displayed.docx")):
                if select:
                    app.js(f"[...document.querySelectorAll('.tab')].find((t) => t.title.endsWith("
                           f"{json.dumps(select)})).click(); return 1")
                    app.wait_render()
                    time.sleep(0.3)
                layout = app.js(LAYOUT_JS)
                app.screenshot(ctx.out / "ui04" / f"{name}-{state}.png")
                rows.append((name, state, layout))
                check(not layout["problems"], f"{name} {state}: {layout['problems']}")
                check(layout["fidelityBelowChrome"], f"{name} {state}: the fidelity bar covers the page")
                check(layout["documentWidth"] > 300 and layout["documentHeight"] > 200,
                      f"{name} {state}: the document keeps room: {layout}")
                if width <= 760:
                    check(not layout["outlineShown"], f"{name}: the outline collapses")
            if env:
                check(rows[-1][2]["dpr"] == 2, f"{name}: device pixel ratio {rows[-1][2]['dpr']}")
    return "; ".join(f"{n} {s}: chrome {l['chromeHeight']} px, document {l['documentWidth']}x"
                     f"{l['documentHeight']}, outline {'shown' if l['outlineShown'] else 'hidden'}"
                     for n, s, l in rows)


CONTRAST_JS = """
const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x)); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const background = (node) => { let layers = [];
  for (let n = node; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
  let base = {r: 255, g: 255, b: 255};
  if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
  for (const l of layers.reverse()) base = {r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a)};
  return base; };
const nodes = [...document.querySelectorAll('#chrome *, #outline *, #statePane *, #statusToast')]
  .filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
  .filter((n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !n.closest('[hidden]') && !n.disabled; });
const results = nodes.map((n) => { const fg = parse(getComputedStyle(n).color); const bg = background(n);
  const a = lum(fg) + 0.05, b = lum(bg) + 0.05;
  return {text: n.textContent.trim().slice(0, 30), id: n.id || n.className, ratio: Math.round(Math.max(a, b) / Math.min(a, b) * 100) / 100}; });
results.sort((x, y) => x.ratio - y.ratio);
const page = document.querySelector('#docBody section.docx');
return {lowest: results.slice(0, 5), count: results.length,
  pageBackground: page ? getComputedStyle(page).backgroundColor : '',
  chromeBackground: getComputedStyle(document.getElementById('chrome')).backgroundColor,
  theme: document.documentElement.getAttribute('data-theme') || 'system'};
"""


def ui05(ctx):
    """System, Light, Dark with the desktop switching while LeanDoc is open."""
    notes = []
    with Session(ctx.build, [FEATURES / "not-displayed.docx", FEATURES / "tracked-changes.docx"]) as app:
        app.wait_render()
        states = {}
        app.command("system-theme light")
        time.sleep(0.3)
        states["system/desktop light"] = app.js(CONTRAST_JS)
        app.command("system-theme dark")
        time.sleep(0.5)
        states["system/desktop dark"] = app.js(CONTRAST_JS)
        app.screenshot(ctx.out / "ui05" / "system-desktop-dark.png")
        click_element(app, "#themeButton")
        time.sleep(0.3)
        states["light (desktop dark)"] = app.js(CONTRAST_JS)
        app.screenshot(ctx.out / "ui05" / "light.png")
        click_element(app, "#themeButton")
        time.sleep(0.3)
        states["dark"] = app.js(CONTRAST_JS)
        app.screenshot(ctx.out / "ui05" / "dark.png")
        app.command("system-theme light")
        time.sleep(0.3)
        states["dark (desktop light)"] = app.js(CONTRAST_JS)
        click_element(app, "#themeButton")
        time.sleep(0.3)
        states["system/desktop light again"] = app.js(CONTRAST_JS)
        app.command(f"open {ROOT / 'tests' / 'fixtures' / 'security' / 'legacy.doc'}")
        app.wait("document.documentElement.dataset.renderState === 'fallback'")
        for desktop in ("light", "dark"):
            app.command(f"system-theme {desktop}")
            time.sleep(0.3)
            states[f"fallback/desktop {desktop}"] = app.js(CONTRAST_JS)
            app.screenshot(ctx.out / "ui05" / f"fallback-{desktop}.png")
    dark_chrome = states["system/desktop dark"]["chromeBackground"]
    light_chrome = states["system/desktop light"]["chromeBackground"]
    check(dark_chrome != light_chrome, f"the chrome follows the desktop: {light_chrome} then {dark_chrome}")
    check(states["light (desktop dark)"]["chromeBackground"] == light_chrome, "Light overrides a dark desktop")
    check(states["dark (desktop light)"]["chromeBackground"] == dark_chrome, "Dark overrides a light desktop")
    for name, state in states.items():
        if state["pageBackground"]:
            check(state["pageBackground"] in ("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)") or
                  state["pageBackground"].startswith("rgb(255, 255, 255"),
                  f"{name}: the page stays paper: {state['pageBackground']}")
        low = state["lowest"][0] if state["lowest"] else {"ratio": 99}
        check(low["ratio"] >= 4.5, f"{name}: chrome text contrast {state['lowest'][:3]}")
        notes.append(f"{name}: lowest {low['ratio']}:1 ({low.get('id', '')})")
    return "; ".join(notes)


# The find field shows its focus on its frame (.search-field:focus-within).
FOCUS_JS = """
const a = document.activeElement;
const s = getComputedStyle(a);
const field = a.closest('.search-field');
const shown = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' ||
  (field !== null && getComputedStyle(field).boxShadow !== 'none');
return {id: a.id || a.className || a.tagName, tag: a.tagName, label: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 24),
  visibleFocus: shown || a === document.body || a.id === 'docScroller', focusVisible: a.matches(':focus-visible')};
"""


def ui06(ctx):
    """Every SPEC 4.2 shortcut and the Tab order through the chrome."""
    desktop = FakeDesktop(editors=True)
    results = {}
    try:
        docs = [ctx.docs["report-20"], FEATURES / "tables.docx", FEATURES / "not-displayed.docx"]
        with Session(ctx.build, docs, config_dir=desktop.config, env=desktop.env()) as app:
            app.wait_render()
            app.wait("document.querySelectorAll('.tab').length === 3")
            window = focus(app)
            def state():
                return app.js("""const r = document.documentElement;
                    return {zoom: r.dataset.zoom, view: r.dataset.view, theme: r.getAttribute('data-theme') || 'system',
                      file: document.getElementById('fileName').textContent,
                      focus: document.activeElement.id, find: document.getElementById('findCount').textContent,
                      tabs: document.querySelectorAll('.tab').length};""")
            start = state()
            key("ctrl+f")
            results["Ctrl+F"] = state()["focus"] == "findInput"
            # The last document is active; "e" occurs in it many times.
            xdotool("type", "--delay", "30", "e")
            time.sleep(0.3)
            first = state()["find"]
            key("F3")
            after_f3 = state()["find"]
            results["F3"] = after_f3 != first and after_f3.startswith("2/")
            key("Escape")
            key("ctrl+plus")
            zoomed = state()["zoom"]
            results["Ctrl++"] = int(zoomed) > int(start["zoom"])
            key("ctrl+minus")
            results["Ctrl+-"] = int(state()["zoom"]) < int(zoomed)
            key("ctrl+minus", "ctrl+minus")
            key("ctrl+0")
            results["Ctrl+0"] = state()["zoom"] == start["zoom"]
            key("ctrl+shift+t")
            results["Ctrl+Shift+T"] = state()["theme"] != start["theme"]
            key("ctrl+shift+t", "ctrl+shift+t")
            key("ctrl+shift+v")
            app.wait_render()
            results["Ctrl+Shift+V"] = state()["view"] == "reading"
            key("ctrl+shift+v")
            app.wait_render()
            key("ctrl+shift+e")
            results["Ctrl+Shift+E"] = bool(desktop.launched(wait=4))
            key("ctrl+1")
            app.wait_render()
            results["Ctrl+1"] = state()["file"] == "report-20.docx"
            key("ctrl+Tab")
            app.wait_render()
            results["Ctrl+Tab"] = state()["file"] == "tables.docx"
            key("ctrl+9")
            app.wait_render()
            results["Ctrl+9"] = state()["file"] == "not-displayed.docx"
            before_reload = app.eval("document.documentElement.dataset.pages")
            key("F5")
            reloaded = json.loads(app.wait_render().result)
            results["F5"] = reloaded["tab"] > 0 and not reloaded["failed"] and before_reload is not None
            key("ctrl+w")
            app.wait("document.querySelectorAll('.tab').length === 2")
            results["Ctrl+W"] = True
            before_windows = len(subprocess.run(["xdotool", "search", "--onlyvisible", "--pid", str(app.pid)],
                                                capture_output=True, text=True).stdout.split())
            key("ctrl+o")
            time.sleep(1.5)
            windows = subprocess.run(["xdotool", "search", "--onlyvisible", "--pid", str(app.pid)],
                                     capture_output=True, text=True).stdout.split()
            results["Ctrl+O"] = len(windows) > before_windows
            if len(windows) > before_windows:
                app.screenshot(ctx.out / "ui06" / "open-dialog-behind.png")
                dialog = [w for w in windows if w != window][0]
                # Xvfb has no window manager, so the new dialog does not get
                # the keyboard by itself; a desktop gives it the focus.
                xdotool("windowfocus", "--sync", dialog)
                key("Escape")
                time.sleep(0.5)
                xdotool("windowfocus", "--sync", window)
                time.sleep(0.3)

            # Tab order from the top of the window.
            xdotool("windowfocus", "--sync", window)
            time.sleep(0.3)
            app.js("window.__keys = []; document.addEventListener('keydown', (e) => window.__keys.push(e.key), true);"
                   "document.activeElement.blur(); return 1")
            order = []
            for _ in range(40):
                key("Tab", delay=0.08)
                order.append(app.js(FOCUS_JS))
            app.screenshot(ctx.out / "ui06" / "tab-focus.png")
            keys_seen = app.eval("window.__keys.length")
            open_windows = subprocess.run(["xdotool", "search", "--onlyvisible", "--pid", str(app.pid)],
                                          capture_output=True, text=True).stdout.split()
            page_focus = app.eval("document.hasFocus()")
        ids = [entry["id"] for entry in order]
        reached = {i for i in ids}
        expected = {"findInput", "viewPage", "viewReading", "zoomOut", "zoomValue", "zoomIn",
                    "themeButton", "editorButton", "openButton"}
        missing = sorted(expected - reached)
        invisible = sorted({entry["id"] for entry in order if not entry["visibleFocus"]})
        failed = sorted(name for name, ok in results.items() if not ok)
        check(not failed, f"shortcuts that did not work: {failed}")
        check(not missing, f"controls the Tab key never reached: {missing}; order {ids[:20]}; "
              f"{keys_seen} keys reached the page, page focus {page_focus}, windows {open_windows}")
        check(not invisible, f"focus not visible on: {invisible}")
        cycle = ids.index(ids[0], 1) if ids[0] in ids[1:] else None
        check(cycle is not None, f"Tab cycles back, so there is no trap: {ids}")
        return f"{len(results)} shortcuts work; Tab order {ids[:cycle]}"
    finally:
        desktop.close()


def ui09(ctx):
    """Zoom 50, 100, 200, 300 percent and fit width, with Ctrl+wheel."""
    with Session(ctx.build, [ctx.docs["report-20"]]) as app:
        app.wait_render()
        window = focus(app)
        app.js("const s = document.getElementById('docScroller');"
               "s.scrollTop = (s.scrollHeight - s.clientHeight) * 0.4; return 1")
        time.sleep(0.3)
        ratio = "(() => { const s = document.getElementById('docScroller'); return s.scrollTop / (s.scrollHeight - s.clientHeight); })()"
        start = app.eval(ratio)
        seen = {}
        for _ in range(12):
            click_element(app, "#zoomIn", window)
            time.sleep(0.15)
        seen["max"] = app.eval("document.documentElement.dataset.zoom")
        seen["ratio at max"] = round(app.eval(ratio), 3)
        app.screenshot(ctx.out / "ui09" / "zoom-300.png")
        for _ in range(14):
            click_element(app, "#zoomOut", window)
            time.sleep(0.15)
        seen["min"] = app.eval("document.documentElement.dataset.zoom")
        seen["ratio at min"] = round(app.eval(ratio), 3)
        app.screenshot(ctx.out / "ui09" / "zoom-50.png")
        click_element(app, "#zoomValue", window)
        time.sleep(0.3)
        seen["fit"] = app.js("return {mode: document.documentElement.dataset.zoomMode, zoom: document.documentElement.dataset.zoom};")
        app.screenshot(ctx.out / "ui09" / "fit-width.png")
        key("ctrl+0")
        before = int(app.eval("document.documentElement.dataset.zoom"))
        box = app.js("const r = document.getElementById('docScroller').getBoundingClientRect();"
                     "return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};")
        xdotool("mousemove", "--window", window, str(box["x"]), str(box["y"]))
        xdotool("keydown", "ctrl")
        xdotool("click", "4")
        time.sleep(0.2)
        xdotool("click", "4")
        xdotool("keyup", "ctrl")
        time.sleep(0.4)
        wheel_up = int(app.eval("document.documentElement.dataset.zoom"))
        xdotool("keydown", "ctrl")
        xdotool("click", "5")
        time.sleep(0.2)
        xdotool("click", "5")
        time.sleep(0.2)
        xdotool("click", "5")
        xdotool("keyup", "ctrl")
        time.sleep(0.4)
        wheel_down = int(app.eval("document.documentElement.dataset.zoom"))
        app.screenshot(ctx.out / "ui09" / "after-wheel.png")
        sharp = app.js("""const w = document.querySelector('#docBody .docx-wrapper');
            return {zoomStyle: w.style.zoom, transform: getComputedStyle(w).transform};""")
    check(seen["max"] == "300" and seen["min"] == "50", f"zoom reaches 300 and 50: {seen}")
    check(abs(seen["ratio at max"] - start) < 0.03 and abs(seen["ratio at min"] - start) < 0.03,
          f"position kept while zooming: {start:.3f} {seen}")
    check(seen["fit"]["mode"] == "fit", f"fit width: {seen['fit']}")
    check(wheel_up > before and wheel_down < wheel_up, f"Ctrl+wheel zooms: {before} {wheel_up} {wheel_down}")
    check(sharp["transform"] == "none", f"CSS zoom, not a scaled bitmap, keeps text sharp: {sharp}")
    return f"zoom {seen}, Ctrl+wheel {before} -> {wheel_up} -> {wheel_down}, position {start:.3f}"


CHECKS = {"UI-01": ("Screenshots of every feature fixture", ui01),
          "UI-04": ("Window sizes", ui04),
          "UI-05": ("Themes and contrast", ui05),
          "UI-06": ("Shortcuts and Tab order", ui06),
          "UI-09": ("Zoom", ui09)}


class Context:
    def __init__(self, build, out, docs):
        self.build, self.out, self.docs = build, out, docs


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--build")
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "visual"))
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    docs = {"report-20": make_report.make_report(out / "report-20.docx", 20)}
    ctx = Context(Build.find(args.build), out, docs)
    only = {item.strip() for item in args.only.split(",") if item.strip()}
    results = {}
    for test_id, (title, function) in CHECKS.items():
        if only and test_id not in only:
            continue
        started = time.monotonic()
        try:
            results[test_id] = {"title": title, "result": "pass", "detail": function(ctx)}
        except (Failure, HostError) as error:
            results[test_id] = {"title": title, "result": "fail", "detail": str(error)}
        except Exception as error:  # noqa: BLE001
            results[test_id] = {"title": title, "result": "fail", "detail": f"{type(error).__name__}: {error}"}
        results[test_id]["seconds"] = round(time.monotonic() - started, 1)
        print(f"{test_id} {results[test_id]['result'].upper()}: {results[test_id]['detail']}", flush=True)
    (out / "ui-linux.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), "utf-8")
    lines = ["| ID | Check | Result | Detail |", "| --- | --- | --- | --- |"]
    lines += [f"| {k} | {v['title']} | {v['result']} | {v['detail'].replace('|', '/')} |" for k, v in results.items()]
    (out / "ui-linux.md").write_text("\n".join(lines) + "\n", "utf-8")
    return 1 if any(v["result"] == "fail" for v in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
