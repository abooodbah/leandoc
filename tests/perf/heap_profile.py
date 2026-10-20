#!/usr/bin/env python3
"""Why the Linux UI process's heap grows while LeanDoc sits idle (M-08).

    bash tests/usage/run-linux.sh python3 tests/perf/heap_profile.py [--minutes 5] [--out DIR]

On some CI runner images the UI process's [heap] gained 75 to 94 MiB of
private dirty memory while idle, at almost no CPU, and heaptrack attached to
the idle process saw only a few KiB of allocations in that time. This
diagnostic opens a 3-page report twice and leaves each window idle, sampling
the [heap] mapping's private dirty memory and AnonHugePages every 30 s:
first as LeanDoc normally runs, then with transparent huge pages disabled
for the process tree (`prctl(PR_SET_THP_DISABLE)` in a wrapper before exec).
It records the system's THP mode. Writes heap-profile.md; never fails a run.
"""

from __future__ import annotations

import argparse
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

# PR_SET_THP_DISABLE is 41; the setting is inherited across fork and exec.
THP_OFF = [sys.executable, "-c",
           "import ctypes, os, sys; ctypes.CDLL(None).prctl(41, 1, 0, 0, 0); os.execv(sys.argv[1], sys.argv[1:])"]


def heap_fields(pid: int) -> tuple[float, float]:
    """Private dirty and AnonHugePages of the [heap] mapping, in MiB."""
    dirty = huge = 0
    inside = False
    try:
        with open(f"/proc/{pid}/smaps") as smaps:
            for line in smaps:
                head = line.split()
                if not head:
                    continue
                if "-" in head[0] and not head[0].endswith(":"):
                    inside = len(head) > 5 and head[5] == "[heap]"
                elif inside and head[0] == "Private_Dirty:":
                    dirty += int(head[1])
                elif inside and head[0] == "AnonHugePages:":
                    huge += int(head[1])
    except OSError:
        pass
    return dirty / 1024, huge / 1024


def system_setting(path: str) -> str:
    try:
        return Path(path).read_text().strip()
    except OSError:
        return "unknown"


def idle_run(build, document, minutes, wrapper, label, lines):
    wait_for_no_leftovers()
    with Session(build, [document], wrapper=wrapper) as app:
        app.wait_timing("rendered")
        run_perf.settle(app)
        start = time.monotonic()
        lines.append(f"{label}:")
        while time.monotonic() - start < minutes * 60:
            dirty, huge = heap_fields(app.pid)
            lines.append(f"  {round(time.monotonic() - start):>4} s: [heap] private dirty {dirty:.1f} MiB, "
                         f"AnonHugePages {huge:.1f} MiB")
            print(lines[-1], flush=True)
            time.sleep(30)
        app.quit()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--build")
    parser.add_argument("--minutes", type=float, default=5)
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "perf"))
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    build = Build.find(args.build)
    document = make_report.make_report(out / "heap-report-3.docx", 3)
    lines = [
        "THP enabled: " + system_setting("/sys/kernel/mm/transparent_hugepage/enabled"),
        "THP defrag: " + system_setting("/sys/kernel/mm/transparent_hugepage/defrag"),
        "khugepaged max_ptes_none: " + system_setting("/sys/kernel/mm/transparent_hugepage/khugepaged/max_ptes_none"),
        "",
    ]
    idle_run(build, document, args.minutes, [], "As LeanDoc runs", lines)
    idle_run(build, document, args.minutes, THP_OFF, "With THP disabled for the process tree", lines)
    (out / "heap-profile.md").write_text("\n".join(lines) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
