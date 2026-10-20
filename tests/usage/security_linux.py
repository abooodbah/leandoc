#!/usr/bin/env python3
"""Security in use on the Linux host: S-01, the host half of S-05, and S-06.

    bash tests/usage/run-linux.sh python3 tests/usage/security_linux.py

S-01  LeanDoc runs under `strace -f -e trace=connect,sendto,sendmsg` (every
      process: LeanDoc, WebKit's network and web processes in their bwrap
      sandboxes, the D-Bus proxy) while it opens every security fixture and
      the hyperlinks fixture, and while every remaining item of the link
      context menu is chosen. Pass: no connection attempt to any address
      other than local IPC (AF_UNIX, and netlink to the kernel).
S-05  50 fetched corpus files (tests/corpus/cache, see fetch-corpus.mjs)
      through the host in one window: no crash, no render over 10 s.
S-06  The SHA-256 of every file opened above is the same afterwards.

Writes security-linux.json and security-linux.md to --out; exits 1 on a failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

from leandoc_driver import Build, HostError, Session, wait_for_no_leftovers, xdotool  # noqa: E402

SECURITY = ROOT / "tests" / "fixtures" / "security"
CORPUS = ROOT / "tests" / "corpus" / "cache"
LOCAL_FAMILIES = {"AF_UNIX", "AF_LOCAL", "AF_NETLINK"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def window_by_name(name: str) -> str:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        found = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", name],
                               capture_output=True, text=True).stdout.split()
        if found:
            return found[0]
        time.sleep(0.2)
    raise HostError(f"no window named {name}")


def s01(build: Build, out: Path):
    log = out / "strace.log"
    fixtures = sorted(SECURITY.iterdir())
    wrapper = ["strace", "-f", "-qq", "-s", "200", "-e", "trace=connect,sendto,sendmsg", "-o", str(log)]
    menu_events = []
    with Session(build, [], wrapper=wrapper) as app:
        app.wait("document.documentElement.dataset.renderState === 'empty'", timeout_ms=60000)
        for fixture in fixtures:
            app.command(f"open {fixture}")
            app.wait("document.getElementById('fileName').textContent === " + json.dumps(fixture.name) +
                     " && document.documentElement.dataset.renderState !== 'loading'", timeout_ms=60000)
        app.command(f"open {SECURITY / 'hyperlinks.docx'}")
        app.wait("document.getElementById('fileName').textContent === 'hyperlinks.docx'")
        app.wait("document.documentElement.dataset.renderState === 'ready'")
        time.sleep(0.5)
        links = app.js("""return [...document.querySelectorAll('#docBody a')].map((a) => {
            a.scrollIntoView({block: 'center'}); const r = a.getBoundingClientRect();
            return {x: Math.round(r.left + Math.min(20, r.width / 2)), y: Math.round(r.top + r.height / 2)}; });""")
        window = window_by_name("hyperlinks.docx")
        xdotool("windowfocus", "--sync", window)
        for index in range(len(links)):
            for item in range(1, 4):
                position = app.js(f"""const a = [...document.querySelectorAll('#docBody a')][{index}];
                    a.scrollIntoView({{block: 'center'}}); const r = a.getBoundingClientRect();
                    return {{x: Math.round(r.left + Math.min(20, r.width / 2)), y: Math.round(r.top + r.height / 2)}};""")
                xdotool("mousemove", "--window", window, str(position["x"]), str(position["y"]))
                xdotool("click", "3")
                time.sleep(0.7)
                for _ in range(item):
                    xdotool("key", "Down")
                xdotool("key", "Return")
                time.sleep(0.7)
                xdotool("key", "Escape")
        menu_events = [line for line in app.lines if line.startswith("LEANDOC_EVENT context-menu")]
    calls = log.read_text(errors="replace").splitlines()
    network = []
    families = {}
    for line in calls:
        match = re.search(r"(connect|sendto|sendmsg)\(\d+, .*?sa_family=(AF_\w+)", line)
        if not match:
            continue
        families[match.group(2)] = families.get(match.group(2), 0) + 1
        if match.group(2) not in LOCAL_FAMILIES:
            network.append(line[:300])
    processes = len({line.split()[0] for line in calls if line.split() and line.split()[0].isdigit()})
    result = {"fixtures": len(fixtures), "linksRightClicked": len(links), "menus": len(menu_events),
              "calls": len(calls), "processesSeen": processes, "families": families,
              "networkAttempts": network}
    passed = not network and len(menu_events) >= len(links)
    return passed, result


def s05_host(build: Build, files):
    rows = []
    with Session(build, []) as app:
        app.wait("document.documentElement.dataset.renderState === 'empty'")
        for path in files:
            started = time.monotonic()
            try:
                app.command(f"open {path}")
                app.wait("document.getElementById('fileName').textContent === " + json.dumps(path.name) +
                         " && document.documentElement.dataset.renderState !== 'loading'", timeout_ms=10000)
                state = app.eval("document.documentElement.dataset.renderState")
                rows.append({"name": path.name, "state": state,
                             "ms": round((time.monotonic() - started) * 1000)})
            except HostError as error:
                rows.append({"name": path.name, "state": "hang or crash", "error": str(error)[:200]})
                if app.process.poll() is not None:
                    break
        alive = app.process.poll() is None
    bad = [row for row in rows if row["state"] not in ("ready", "fallback")]
    return not bad and alive and len(rows) == len(files), {"files": len(rows), "alive": alive, "rows": rows,
                                                           "problems": bad}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--build")
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "security"))
    args = parser.parse_args()
    build = Build.find(args.build)
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    corpus = sorted(p for p in CORPUS.rglob("*") if p.is_file())[:50]
    opened = sorted(SECURITY.iterdir()) + corpus
    before = {str(p): sha256(p) for p in opened}

    results = {}
    wait_for_no_leftovers()
    ok, detail = s01(build, out)
    results["S-01"] = {"result": "pass" if ok else "fail", "detail": detail}
    print(f"S-01 {'PASS' if ok else 'FAIL'}: {json.dumps(detail)[:600]}", flush=True)
    if corpus:
        wait_for_no_leftovers()
        ok, detail = s05_host(build, corpus)
        results["S-05 host"] = {"result": "pass" if ok else "fail", "detail": detail}
        print(f"S-05 host {'PASS' if ok else 'FAIL'}: {detail['files']} files, problems {detail['problems']}",
              flush=True)
    else:
        results["S-05 host"] = {"result": "not run", "detail": "no corpus in tests/corpus/cache"}
    after = {name: sha256(Path(name)) for name in before}
    changed = [name for name in before if before[name] != after[name]]
    results["S-06"] = {"result": "pass" if not changed else "fail",
                       "detail": {"files": len(before), "changed": changed}}
    print(f"S-06 {'PASS' if not changed else 'FAIL'}: {len(before)} files hashed, {len(changed)} changed",
          flush=True)
    (out / "security-linux.json").write_text(json.dumps(results, indent=2), "utf-8")
    return 1 if any(r["result"] == "fail" for r in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
