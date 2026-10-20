#!/usr/bin/env python3
"""Performance and memory gates P-01 to P-11 and M-01 to M-09 on the Linux host.

Runs the real GTK host (under Xvfb and a D-Bus session; see run-linux.sh)
with --trace-timing and --test-script, reads LEANDOC_TIMING lines, walks the
/proc process tree from the LeanDoc process (WebKit's network process, its
web process and D-Bus proxy inside bwrap), and samples memory from
smaps_rollup. Every launch waits until this harness's earlier processes have
exited, excludes incomplete trees, and every launch figure is the median of
--runs launches (10 by default), as docs/TEST_PLAN.md asks.

    python3 tests/perf/run_perf.py --out artifacts/perf
    python3 tests/perf/run_perf.py --only P-01,P-02 --runs 5

Writes perf-linux.json (every raw sample) and perf-linux.md (the table), and
exits 1 when a budget is missed. Runner figures are test-gate figures, never
product claims.

Memory: the gate uses private dirty memory (Private_Dirty of the whole tree),
the Linux counterpart of the private bytes LeanMark measures on Windows.
Private_Clean (unshared clean pages, mostly library code) is recorded too,
with PSS and RSS, but it moves by tens of MiB with whatever else on the
machine maps the same WebKit and Mesa libraries, so it cannot gate.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tests" / "usage"))
sys.path.insert(0, str(HERE))

from leandoc_driver import (Build, HostError, RUN_TAG, Session, sample_tree,  # noqa: E402
                            tagged_processes, wait_for_no_leftovers)
import make_report  # noqa: E402

MIB = 1024 * 1024


# Helpers ---------------------------------------------------------------------

def median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 1) if values else None


def settle(app: Session, minimum: float = 3.0, maximum: float = 12.0):
    """Samples every 0.5 s until three samples agree within 1.5 MiB."""
    start = time.monotonic()
    samples = []
    while True:
        sample = app.memory()
        samples.append(sample)
        elapsed = time.monotonic() - start
        recent = samples[-3:]
        if elapsed >= minimum and len(recent) == 3:
            values = [s.private_dirty_mib for s in recent]
            if max(values) - min(values) <= 1.5:
                return sample, round(elapsed, 1)
        if elapsed >= maximum:
            return sample, round(elapsed, 1)
        time.sleep(0.5)


def vm_hwm_kib(pid: int) -> int:
    try:
        for line in open(f"/proc/{pid}/status"):
            if line.startswith("VmHWM:"):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


def machine():
    def run(*args):
        try:
            return subprocess.run(args, capture_output=True, text=True).stdout.strip()
        except OSError:
            return ""
    cpu = ""
    try:
        for line in open("/proc/cpuinfo"):
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    memory = 0
    try:
        for line in open("/proc/meminfo"):
            if line.startswith("MemTotal:"):
                memory = round(int(line.split()[1]) / 1024 / 1024, 1)
    except OSError:
        pass
    return {
        "kernel": platform.release(),
        "os": run("sh", "-c", ". /etc/os-release && echo $PRETTY_NAME"),
        "cpu": cpu,
        "logicalProcessors": os.cpu_count(),
        "memoryGiB": memory,
        "webkitgtk": run("pkg-config", "--modversion", "webkitgtk-6.0"),
        "gtk": run("pkg-config", "--modversion", "gtk4"),
        "gskRenderer": os.environ.get("GSK_RENDERER", "default"),
        "compositing": "off" if os.environ.get("WEBKIT_DISABLE_COMPOSITING_MODE") == "1" else "default",
        "display": "Xvfb" if os.environ.get("DISPLAY") else "",
    }


def loadavg():
    try:
        return [float(x) for x in open("/proc/loadavg").read().split()[:3]]
    except OSError:
        return []


class Results:
    def __init__(self):
        self.launches: dict[str, list] = {}
        self.measures: dict[str, dict] = {}

    def add_launch(self, scenario, record):
        self.launches.setdefault(scenario, []).append(record)

    def measure(self, test_id, value, unit, budget, passed, note="", samples=None, extra=None):
        self.measures[test_id] = {
            "value": value, "unit": unit, "budget": budget,
            "result": "pass" if passed else ("fail" if passed is False else "recorded"),
            "note": note, "samples": samples or [], **(extra or {})}


# Launch scenarios ------------------------------------------------------------

def launch_once(build, documents, *, wait_render=True, timeout=60.0):
    wait_for_no_leftovers()
    with Session(build, documents) as app:
        if wait_render:
            app.wait_timing("rendered", timeout=timeout)
        else:
            app.wait_timing("webview-ready", timeout=timeout)
            app.wait("document.documentElement.dataset.renderState === 'empty'")
        sample, settled = settle(app)
        timings = {event: values[0][0] for event, values in app.timings.items()}
        rendered = app.timings.get("rendered", [(None, {})])[0][1]
        record = {
            "timings": timings,
            "pages": int(rendered.get("pages", 0)) if rendered else 0,
            "readerMs": int(rendered.get("readerMs", 0)) if rendered else 0,
            "settledAfterS": settled,
            "memory": sample.summary(),
            "uiPeakKiB": vm_hwm_kib(app.pid),
            "loadavg": loadavg(),
        }
        app.quit()
    return record


def run_launches(results, build, scenario, documents, runs, wait_render=True):
    good = []
    excluded = 0
    attempts = 0
    while len(good) < runs and attempts < runs + 5:
        attempts += 1
        try:
            record = launch_once(build, documents, wait_render=wait_render)
        except HostError as error:
            print(f"  {scenario}: launch failed: {error}", flush=True)
            excluded += 1
            continue
        if not record["memory"]["complete"]:
            excluded += 1
            continue
        good.append(record)
        results.add_launch(scenario, record)
        print(f"  {scenario} #{len(good)}: visible {record['timings'].get('window-visible')} ms, "
              f"rendered {record['timings'].get('rendered')} ms, "
              f"dirty {record['memory']['privateDirtyMiB']} MiB, "
              f"private {record['memory']['privateMiB']} MiB", flush=True)
    return good, excluded


def summarize(records):
    return {
        "windowVisibleMs": median([r["timings"].get("window-visible") for r in records]),
        "renderedMs": median([r["timings"].get("rendered") for r in records]),
        "privateDirtyMiB": median([r["memory"]["privateDirtyMiB"] for r in records]),
        "privateMiB": median([r["memory"]["privateMiB"] for r in records]),
        "pssMiB": median([r["memory"]["pssMiB"] for r in records]),
        "processes": median([r["memory"]["processes"] for r in records]),
        "uiPeakMiB": median([r["uiPeakKiB"] / 1024 for r in records]),
        "pages": median([r["pages"] for r in records]),
    }


# Responsiveness while a long document loads (P-04) ---------------------------

def responsiveness(build, document, timeout=60.0):
    """Sends a trivial script command every 100 ms while the document loads.

    `mark` is answered by the GTK main loop, `js` by the web process's main
    thread, so each answer's round trip is how long that thread could not
    respond. Returns the longest stall of each."""
    wait_for_no_leftovers()
    with Session(build, [document]) as app:
        app.wait_timing("webview-ready", timeout=timeout)
        ui, web = [], []
        deadline = time.monotonic() + timeout
        while not app.timings.get("rendered") and time.monotonic() < deadline:
            started = time.monotonic()
            app.command("mark tick")
            ui.append((time.monotonic() - started) * 1000)
            started = time.monotonic()
            app.command("js return 1")
            web.append((time.monotonic() - started) * 1000)
            time.sleep(0.1)
        rendered = app.timings.get("rendered", [(None, {})])[0][0]
        app.quit()
    return {"uiMaxStallMs": round(max(ui), 1) if ui else None,
            "webMaxStallMs": round(max(web), 1) if web else None,
            "probes": len(web), "renderedMs": rendered}


# In-window scenarios ---------------------------------------------------------

FIND_JS = """
const input = document.getElementById('findInput');
input.value = '';
input.dispatchEvent(new Event('input'));
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const t0 = performance.now();
input.value = QUERY;
input.dispatchEvent(new Event('input'));
const counted = performance.now() - t0;
const text = document.getElementById('findCount').textContent;
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
return {countedMs: counted, paintedMs: performance.now() - t0, count: text};
"""

ZOOM_JS = """
const t0 = performance.now();
document.getElementById(BUTTON).click();
void document.getElementById('docBody').offsetHeight;
const laidOut = performance.now() - t0;
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
return {laidOutMs: laidOut, paintedMs: performance.now() - t0,
  zoom: document.documentElement.dataset.zoom};
"""

SCROLL_JS = """
const scroller = document.getElementById('docScroller');
scroller.scrollTop = 0;
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const frames = [];
let last = performance.now();
const step = STEP;
await new Promise((resolve) => {
  function tick(now) {
    frames.push(now - last);
    last = now;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
      resolve();
      return;
    }
    scroller.scrollTop += step;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});
frames.shift();
const sorted = frames.slice().sort((a, b) => a - b);
const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
return {frames: frames.length, p50: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1],
  over33: frames.filter((f) => f > 33.4).length, over100: frames.filter((f) => f > 100).length,
  distance: scroller.scrollHeight};
"""


def tab_ids(app):
    return app.js("return [...document.querySelectorAll('.tab')].map((t) => t.dataset.tabKey)")


def click_tab(app, key):
    app.js(f"document.querySelector('.tab[data-tab-key=\"{key}\"]').click(); return 1")


def close_tab(app, key):
    app.js("window.webkit.messageHandlers.leandoc.postMessage(JSON.stringify("
           f"{{type: 'closeTab', id: {int(key)}}})); return 1")


def in_window(results, build, docs, runs):
    """P-06 to P-11 in one running window each."""
    report3, report300 = docs["report-3"], docs["report-300"]
    second = docs["report-3-b"]

    # P-06: a real second launch hands its file to the running window.
    times = []
    for _ in range(runs):
        wait_for_no_leftovers()
        with Session(build, [report3]) as app:
            app.wait_timing("rendered")
            time.sleep(0.5)
            started = time.monotonic()
            subprocess.run([str(build.binary), "--", str(second)], env=app.environment(),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
            event = app.wait_timing("rendered", count=2)
            times.append(round((event[1]["_arrived"] - started) * 1000, 1))
            processes = sample_tree(app.pid).summary()["processes"]
            app.quit()
    value = median(times)
    results.measure("P-06", value, "ms", "< 500", value is not None and value < 500,
                    "second launch to the running window's rendered (3-page report)", times,
                    {"treeProcessesAfter": processes})

    with Session(build, [report300]) as app:
        app.wait_render(timeout=60)
        app.command(f"open {report3}")
        app.wait_render()
        keys = tab_ids(app)
        switch = []
        # The 3-page tab is active; the 300-page tab is in the background.
        for _ in range(runs):
            click_tab(app, keys[0])
            switch.append(app.wait_render(timeout=60).ms)
            click_tab(app, keys[1])
            app.wait_render()
        value = median(switch)
        results.measure("P-07", value, "ms", "< 1500", value < 1500,
                        "tab switch back to the 300-page background tab", switch)

        close_tab(app, keys[1])
        app.wait("document.querySelectorAll('.tab').length <= 1")
        views = []
        back = []
        for _ in range(runs):
            app.js("document.getElementById('viewReading').click(); return 1")
            views.append(app.wait_render(timeout=60).ms)
            app.js("document.getElementById('viewPage').click(); return 1")
            back.append(app.wait_render(timeout=60).ms)
        value = median(views)
        results.measure("P-08", value, "ms", "< 1500", value < 1500,
                        "page to reading view, 300-page report", views,
                        {"readingToPageMs": median(back)})

        finds = []
        for _ in range(runs):
            finds.append(app.js("const QUERY = 'survey';" + FIND_JS))
        value = median([f["paintedMs"] for f in finds])
        results.measure("P-09", value, "ms", "< 300", value < 300,
                        f"find 'survey' with count {finds[0]['count']} and paint, 300-page report",
                        [round(f["paintedMs"], 1) for f in finds],
                        {"countedMs": median([f["countedMs"] for f in finds]),
                         "count": finds[0]["count"]})
        app.js("const i = document.getElementById('findInput'); i.value = ''; "
               "i.dispatchEvent(new Event('input')); return 1")

        zooms = []
        for _ in range(runs):
            zooms.append(app.js("const BUTTON = 'zoomIn';" + ZOOM_JS))
            app.js("const BUTTON = 'zoomOut';" + ZOOM_JS)
        value = median([z["paintedMs"] for z in zooms])
        results.measure("P-11", value, "ms", "< 300", value < 300,
                        "zoom step in, 300-page report, to the next painted frame",
                        [round(z["paintedMs"], 1) for z in zooms])
        app.js("document.dispatchEvent(new KeyboardEvent('keydown', "
               "{key: '0', ctrlKey: true, bubbles: true})); return 1")

        scroll = app.js("const STEP = 400;" + SCROLL_JS, timeout=300)
        results.measure("P-10", round(scroll["p95"], 1), "ms (p95 frame)",
                        "95% of frames < 33 ms (Chromium); no visible stall in WebKitGTK",
                        None, "WebKitGTK host under Xvfb, scripted scroll top to bottom, "
                        "400 px per frame; recorded, the Chromium run gates",
                        extra={"webkit": {k: round(v, 1) if isinstance(v, float) else v
                                          for k, v in scroll.items()}})
        app.quit()


def tabs_memory(results, build, docs, runs, m02):
    """M-05: five documents open as tabs."""
    records = []
    for _ in range(runs):
        wait_for_no_leftovers()
        with Session(build, docs["five"]) as app:
            app.wait_timing("rendered")
            app.wait("document.querySelectorAll('.tab').length === 5")
            sample, _ = settle(app)
            records.append(sample.summary())
            app.quit()
    value = median([r["privateDirtyMiB"] for r in records])
    budget = round(m02 + 25, 1) if m02 is not None else None
    results.measure("M-05", value, "MiB", f"<= M-02 + 25 ({budget})",
                    budget is not None and value <= budget,
                    "five 3-page reports as tabs", [r["privateDirtyMiB"] for r in records],
                    {"privateMiB": median([r["privateMiB"] for r in records])})


def leak_open_close(results, build, docs, cycles=30):
    """M-06: open and close the 300-page report 30 times in one window."""
    with Session(build, []) as app:
        app.wait("document.documentElement.dataset.renderState === 'empty'")
        after = []
        for cycle in range(cycles):
            app.command(f"open {docs['report-300']}")
            app.wait_render(timeout=60)
            close_tab(app, tab_ids(app)[0] if tab_ids(app) else 1)
            app.wait("document.documentElement.dataset.renderState === 'empty'")
            if cycle == 0 or cycle == cycles - 1:
                sample, _ = settle(app)
                after.append(sample.summary())
        app.quit()
    first, last = after[0]["privateDirtyMiB"], after[-1]["privateDirtyMiB"]
    growth = round((last - first) / first * 100, 1)
    results.measure("M-06", growth, "% growth", "within 10%", abs(growth) <= 10,
                    f"after first close {first} MiB, after close {cycles} {last} MiB",
                    [first, last], {"privateMiB": [after[0]["privateMiB"], after[-1]["privateMiB"]]})


def leak_tabs_views(results, build, docs, cycles=50, switches=50):
    """M-07: cycle 10 tabs 50 times, then switch views 50 times."""
    with Session(build, docs["ten"]) as app:
        app.wait_timing("rendered")
        app.wait("document.querySelectorAll('.tab').length === 10")
        keys = tab_ids(app)
        active = keys[-1]
        marks = []
        for cycle in range(cycles):
            for key in keys:
                if key == active:
                    continue
                click_tab(app, key)
                app.wait_render(timeout=60)
                active = key
            if cycle == 0 or cycle == cycles - 1:
                sample, _ = settle(app)
                marks.append(sample.summary())
        for switch in range(switches):
            app.js("document.getElementById('" + ("viewReading" if switch % 2 == 0 else "viewPage")
                   + "').click(); return 1")
            app.wait_render(timeout=60)
        sample, _ = settle(app)
        marks.append(sample.summary())
        app.quit()
    first = marks[0]["privateDirtyMiB"]
    growth = round(max(marks[1]["privateDirtyMiB"], marks[2]["privateDirtyMiB"]) - first, 1)
    results.measure("M-07", growth, "MiB growth", "< 15", growth < 15,
                    f"after cycle 1 {first} MiB, after cycle {cycles} {marks[1]['privateDirtyMiB']} MiB, "
                    f"after {switches} view switches {marks[2]['privateDirtyMiB']} MiB",
                    [m["privateDirtyMiB"] for m in marks])


def idle(results, build, docs, minutes):
    """M-08: a document open and idle; memory growth and CPU use."""
    with Session(build, [docs["report-3"]]) as app:
        app.wait_timing("rendered")
        start, _ = settle(app)
        ticks0 = sample_tree(app.pid).cpu_ticks
        time.sleep(minutes * 60)
        end = app.memory()
        ticks1 = sample_tree(app.pid).cpu_ticks
        app.quit()
    hz = os.sysconf("SC_CLK_TCK")
    growth = round(end.private_dirty_mib - start.private_dirty_mib, 2)
    cpu = round((ticks1 - ticks0) / hz, 2)
    results.measure("M-08", growth, "MiB growth", "< 5 MiB and no CPU while idle",
                    growth < 5 and cpu <= 0.05 * minutes,
                    f"{minutes} min idle; CPU {cpu} s over the tree", [start.private_dirty_mib,
                                                                       end.private_dirty_mib],
                    {"cpuSeconds": cpu, "minutes": minutes})


def security_peak(results, build, runs, m02_records):
    """M-09: hostile packages never push memory past the 3-page report."""
    fixtures = ROOT / "tests" / "fixtures" / "security"
    rows = {}
    for name in ("zip-bomb.docx", "deep-nesting.docx", "many-entries.docx"):
        peaks, dirty = [], []
        for _ in range(max(3, runs // 3)):
            wait_for_no_leftovers()
            with Session(build, [fixtures / name]) as app:
                app.wait("document.documentElement.dataset.renderState === 'fallback'")
                sample, _ = settle(app, minimum=2.0)
                peaks.append(round(vm_hwm_kib(app.pid) / 1024, 1))
                dirty.append(sample.private_dirty_mib)
                app.quit()
        rows[name] = {"uiPeakMiB": median(peaks), "privateDirtyMiB": median(dirty)}
    m02_peak = median([r["uiPeakKiB"] / 1024 for r in m02_records])
    m02_dirty = median([r["memory"]["privateDirtyMiB"] for r in m02_records])
    worst_peak = max(r["uiPeakMiB"] for r in rows.values())
    worst_dirty = max(r["privateDirtyMiB"] for r in rows.values())
    passed = worst_peak <= m02_peak + 2 and worst_dirty <= m02_dirty + 2
    results.measure("M-09", worst_peak, "MiB (LeanDoc process peak)",
                    f"peak within M-02 (UI peak {m02_peak} MiB, tree {m02_dirty} MiB, 2 MiB tolerance)",
                    passed, "zip bomb, 300-deep nesting, 5,000 entries", extra={"fixtures": rows})


def core_timing(results, build, docs, runs):
    """P-05: leandoc-inspect open and sanitize (Release)."""
    inspect = build.binary.parent / "tools" / "inspect" / "leandoc-inspect"
    budgets = {"report-3": 50, "report-300": 500, "report-1000": 1500, "images-20mb": 1000}
    rows = {}
    passed = True
    for name, budget in budgets.items():
        times = []
        for _ in range(runs):
            line = subprocess.run([str(inspect), "--time", str(docs[name])], capture_output=True,
                                  text=True, check=True).stdout.strip().splitlines()[-1]
            times.append(json.loads(line)["ms"])
        rows[name] = {"medianMs": median(times), "budgetMs": budget, "samples": times}
        passed = passed and rows[name]["medianMs"] < budget
    results.measure("P-05", max(r["medianMs"] for r in rows.values()), "ms (worst document)",
                    "3-page < 50, 300-page < 500, 1,000-page < 1500, 20 MB images < 1000",
                    passed, "leandoc-inspect --time, Release build", extra={"documents": rows})


# Main ------------------------------------------------------------------------

def write_outputs(results, out: Path, meta):
    out.mkdir(parents=True, exist_ok=True)
    data = {"meta": meta, "measures": results.measures, "launches": results.launches}
    (out / "perf-linux.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    lines = [f"## LeanDoc performance and memory, Linux ({meta['machine']['os']})", "",
             f"Test-gate figures from {meta['machine']['cpu']}, {meta['machine']['logicalProcessors']} "
             f"logical processors, {meta['machine']['memoryGiB']} GiB, WebKitGTK "
             f"{meta['machine']['webkitgtk']}, GTK {meta['machine']['gtk']} under Xvfb; "
             f"revision {meta['revision']}; median of {meta['runs']} launches; memory is the "
             "private dirty memory of the whole process tree. Not product claims.", "",
             "| ID | Value | Budget | Result | Note |", "| --- | ---: | --- | --- | --- |"]
    for test_id in sorted(results.measures):
        m = results.measures[test_id]
        lines.append(f"| {test_id} | {m['value']} {m['unit']} | {m['budget']} | {m['result']} | "
                     f"{m['note']} |")
    if results.launches:
        lines += ["", "| Launch scenario | Window visible (ms) | First page (ms) | Pages | "
                  "Private dirty (MiB) | Private (MiB) | PSS (MiB) | Processes |",
                  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for scenario, records in results.launches.items():
            s = summarize(records)
            lines.append(f"| {scenario} | {s['windowVisibleMs']} | {s['renderedMs'] or ''} | "
                         f"{s['pages'] or ''} | {s['privateDirtyMiB']} | {s['privateMiB']} | "
                         f"{s['pssMiB']} | {s['processes']} |")
    (out / "perf-linux.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--build")
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "perf"))
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--only", default="")
    parser.add_argument("--idle-minutes", type=float, default=10)
    args = parser.parse_args()
    only = {item.strip() for item in args.only.split(",") if item.strip()}

    def wanted(*ids):
        return not only or any(i in only for i in ids)

    build = Build.find(args.build)
    out = Path(args.out).resolve()
    docs_dir = out / "documents"
    made = make_report.make_all(docs_dir)
    docs = dict(made)
    docs["report-3-b"] = docs_dir / "report-3-b.docx"
    shutil.copy(made["report-3"], docs["report-3-b"])
    docs["five"], docs["ten"] = [], []
    for index in range(10):
        copy = docs_dir / f"tab-{index + 1:02d}.docx"
        shutil.copy(made["report-3"], copy)
        docs["ten"].append(copy)
        if index < 5:
            docs["five"].append(copy)

    revision = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True).stdout.strip()
    meta = {"machine": machine(), "revision": revision, "runs": args.runs,
            "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tag": RUN_TAG,
            "loadavgStart": loadavg()}
    results = Results()
    print(f"LeanDoc perf on {meta['machine']['cpu']} (load {meta['loadavgStart']})", flush=True)

    m01 = m02 = None
    m02_records = []
    if wanted("P-01", "M-01", "M-02", "M-03", "M-04", "M-05", "M-09"):
        empty, excluded = run_launches(results, build, "empty window", [], args.runs, False)
        s = summarize(empty)
        m01 = s["privateDirtyMiB"]
        results.measure("P-01", s["windowVisibleMs"], "ms", "< 300", s["windowVisibleMs"] < 300,
                        f"launch to window visible, empty window; {excluded} excluded",
                        [r["timings"].get("window-visible") for r in empty])
        results.measure("M-01", m01, "MiB", "baseline", None, "empty window",
                        [r["memory"]["privateDirtyMiB"] for r in empty],
                        {"privateMiB": s["privateMiB"], "pssMiB": s["pssMiB"]})
    for test_id, mem_id, name, render_budget, mem_budget in (
            ("P-02", "M-02", "report-3", 1000, 40),
            ("P-03", "M-03", "report-300", 2500, 120),
            ("P-04", "M-04", "report-1000", 6000, 300)):
        if not wanted(test_id, mem_id, "M-05" if name == "report-3" else test_id,
                      "M-09" if name == "report-3" else test_id):
            continue
        records, excluded = run_launches(results, build, name, [docs[name]], args.runs)
        s = summarize(records)
        extra = {"pages": s["pages"], "excluded": excluded}
        if test_id == "P-04":
            probe = responsiveness(build, docs[name])
            extra["responsiveness"] = probe
            stalled = probe["webMaxStallMs"] is not None and probe["webMaxStallMs"] > 1000
            results.measure(test_id, s["renderedMs"], "ms", "< 6000 and responsive while loading",
                            s["renderedMs"] < 6000 and not stalled,
                            f"launch to first page, {name} ({s['pages']} pages); longest stall "
                            f"web {probe['webMaxStallMs']} ms, UI {probe['uiMaxStallMs']} ms",
                            [r["timings"].get("rendered") for r in records], extra)
        else:
            results.measure(test_id, s["renderedMs"], "ms", f"< {render_budget}",
                            s["renderedMs"] < render_budget,
                            f"launch to first page, {name} ({s['pages']} pages)",
                            [r["timings"].get("rendered") for r in records], extra)
        if m01 is not None:
            delta = round(s["privateDirtyMiB"] - m01, 1)
            results.measure(mem_id, delta, "MiB over M-01", f"<= {mem_budget}",
                            delta <= mem_budget, f"{name}: {s['privateDirtyMiB']} MiB",
                            [r["memory"]["privateDirtyMiB"] for r in records],
                            {"privateMiB": s["privateMiB"], "pssMiB": s["pssMiB"]})
        if name == "report-3":
            m02 = s["privateDirtyMiB"]
            m02_records = records
    if wanted("P-05"):
        core_timing(results, build, docs, args.runs)
    if wanted("P-06", "P-07", "P-08", "P-09", "P-10", "P-11"):
        in_window(results, build, docs, args.runs)
    if wanted("M-05") and m02 is not None:
        tabs_memory(results, build, docs, args.runs, m02)
    if wanted("M-06"):
        leak_open_close(results, build, docs)
    if wanted("M-07"):
        leak_tabs_views(results, build, docs)
    if wanted("M-09") and m02_records:
        security_peak(results, build, args.runs, m02_records)
    if wanted("M-08") and args.idle_minutes > 0:
        idle(results, build, docs, args.idle_minutes)

    meta["loadavgEnd"] = loadavg()
    meta["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(write_outputs(results, out, meta))
    failed = [k for k, v in results.measures.items() if v["result"] == "fail"]
    if failed:
        print(f"Budget missed: {', '.join(sorted(failed))}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
