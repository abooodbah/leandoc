#!/usr/bin/env python3
"""Where the Linux UI process's heap grows while LeanDoc sits idle (M-08).

    bash tests/usage/run-linux.sh python3 tests/perf/heap_profile.py [--minutes 5] [--out DIR]

Opens a 3-page report, waits for the first page and the heap trim, attaches
heaptrack to the `leandoc` process (`heaptrack -p`, which needs gdb and
ptrace permission), and leaves the window idle while it samples the
process's private dirty memory every 30 s. Then it quits LeanDoc and writes
heaptrack's peak and leak report (`heap-profile.txt`) and the samples
(`heap-profile.md`). A diagnostic: it never fails a run.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tests" / "usage"))
sys.path.insert(0, str(HERE))

from leandoc_driver import Build, Session, wait_for_no_leftovers  # noqa: E402
import make_report  # noqa: E402
import run_perf  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--build")
    parser.add_argument("--minutes", type=float, default=5)
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "perf"))
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if not shutil.which("heaptrack"):
        (out / "heap-profile.md").write_text("heaptrack is not installed; no heap profile.\n", "utf-8")
        return 0
    build = Build.find(args.build)
    document = make_report.make_report(out / "heap-report-3.docx", 3)
    trace = out / "heap-profile"
    lines = []
    wait_for_no_leftovers()
    with Session(build, [document]) as app:
        app.wait_timing("rendered")
        run_perf.settle(app)
        tracker = subprocess.Popen(["heaptrack", "-o", str(trace), "-p", str(app.pid)],
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        time.sleep(10)
        start = time.monotonic()
        while time.monotonic() - start < args.minutes * 60:
            maps = run_perf.dirty_by_mapping(app.pid)
            lines.append(f"{round(time.monotonic() - start):>4} s: leandoc {sum(maps.values()) / 1024:.1f} MiB, "
                         f"[heap] {maps.get('[heap]', 0) / 1024:.1f} MiB")
            print(lines[-1], flush=True)
            time.sleep(30)
        app.quit()
        try:
            tracker_output = tracker.communicate(timeout=120)[0]
        except subprocess.TimeoutExpired:
            tracker.kill()
            tracker_output = tracker.communicate()[0]
    files = sorted(out.glob("heap-profile*.zst")) + sorted(out.glob("heap-profile*.gz"))
    report = ""
    if files:
        result = subprocess.run(["heaptrack_print", "-f", str(files[-1]), "--print-peaks", "1",
                                 "--print-allocators", "0", "--print-temporary", "0", "--print-leaks", "1",
                                 "-n", "8", "-s", "4"], capture_output=True, text=True)
        report = result.stdout
    else:
        report = "heaptrack wrote no file:\n" + tracker_output[-3000:]
    (out / "heap-profile.txt").write_text(report, "utf-8")
    summary = ["Private dirty memory of the UI process while idle, heaptrack attached:", ""] + lines
    summary += ["", "heaptrack (peak contributors and leaks, top entries):", ""]
    summary += [line for line in report.splitlines() if line.strip()][:120]
    (out / "heap-profile.md").write_text("\n".join(summary) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
