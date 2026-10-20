"""Drives the real LeanDoc GTK host for the usage, performance, and visual tests.

Standard library only. The host must run under a display and a D-Bus session
bus (tests/usage/run-linux.sh provides both). One Session is one LeanDoc
process started with --trace-timing and --test-script on a FIFO, so the
harness sends one command at a time and reads the answer:

    with Session(build, ["report.docx"]) as app:
        app.wait_render()
        print(app.js("return document.title"))
        print(app.memory())

Commands and answers are described in docs/architecture/hosts.md.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class HostError(RuntimeError):
    pass


@dataclass
class Answer:
    line: int
    command: str
    ok: bool
    ms: int
    result: str

    def json(self):
        return json.loads(self.result) if self.result else None


@dataclass
class Build:
    """Where the host binary and its staged assets are."""

    binary: Path
    assets: Path

    @staticmethod
    def find(build_dir: str | os.PathLike | None = None) -> "Build":
        candidates = [Path(build_dir)] if build_dir else []
        env = os.environ.get("LEANDOC_BUILD_DIR")
        if env:
            candidates.insert(0, Path(env))
        candidates += [ROOT / "build" / "t", ROOT / "build" / "linux"]
        for candidate in candidates:
            binary = candidate / "leandoc"
            if binary.is_file():
                return Build(binary.resolve(), (candidate / "runtime" / "assets").resolve())
        raise HostError("No LeanDoc build found; set LEANDOC_BUILD_DIR.")


# /proc helpers ---------------------------------------------------------------

def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def process_stat(pid: int) -> dict | None:
    text = _read(f"/proc/{pid}/stat")
    if not text:
        return None
    close = text.rfind(")")
    fields = text[close + 2:].split()
    return {
        "pid": pid,
        "comm": text[text.find("(") + 1:close],
        "state": fields[0],
        "ppid": int(fields[1]),
        "utime": int(fields[11]),
        "stime": int(fields[12]),
        "starttime": int(fields[19]),
    }


def descendants(root_pid: int) -> list[dict]:
    """The process and every descendant, found from each process's parent.

    WebKitGTK starts its network process directly and its web process and
    D-Bus proxy inside bwrap sandboxes; bwrap forks again inside a new PID
    namespace, but /proc of the outer namespace still shows each one with its
    real parent, so a parent walk finds them all."""
    stats = {}
    for entry in os.listdir("/proc"):
        if entry.isdigit():
            stat = process_stat(int(entry))
            if stat:
                stats[stat["pid"]] = stat
    children: dict[int, list[int]] = {}
    for stat in stats.values():
        children.setdefault(stat["ppid"], []).append(stat["pid"])
    found = []
    pending = [root_pid]
    while pending:
        pid = pending.pop()
        if pid in stats:
            found.append(stats[pid])
            pending.extend(children.get(pid, []))
    for stat in found:
        stat["exe"] = _exe_name(stat["pid"]) or stat["comm"]
    return found


def _exe_name(pid: int) -> str:
    try:
        return os.path.basename(os.readlink(f"/proc/{pid}/exe"))
    except OSError:
        cmdline = _read(f"/proc/{pid}/cmdline").split("\0")
        return os.path.basename(cmdline[0]) if cmdline and cmdline[0] else ""


def smaps_rollup(pid: int) -> dict:
    values = {}
    for line in _read(f"/proc/{pid}/smaps_rollup").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[0].endswith(":") and parts[1].isdigit():
            values[parts[0][:-1]] = int(parts[1])  # kB
    return values


@dataclass
class TreeSample:
    processes: list[dict] = field(default_factory=list)

    @property
    def private_mib(self) -> float:
        return sum(p.get("private_kb", 0) for p in self.processes) / 1024

    @property
    def private_dirty_mib(self) -> float:
        return sum(p.get("private_dirty_kb", 0) for p in self.processes) / 1024

    @property
    def anonymous_mib(self) -> float:
        return sum(p.get("anonymous_kb", 0) for p in self.processes) / 1024

    @property
    def pss_mib(self) -> float:
        return sum(p.get("pss_kb", 0) for p in self.processes) / 1024

    @property
    def rss_mib(self) -> float:
        return sum(p.get("rss_kb", 0) for p in self.processes) / 1024

    @property
    def cpu_ticks(self) -> int:
        return sum(p["utime"] + p["stime"] for p in self.processes)

    def names(self) -> list[str]:
        return sorted(p["exe"] for p in self.processes)

    def complete(self) -> bool:
        names = self.names()
        return ("leandoc" in names and "WebKitWebProcess" in names and
                "WebKitNetworkProcess" in names)

    def summary(self) -> dict:
        return {
            "privateMiB": round(self.private_mib, 2),
            "privateDirtyMiB": round(self.private_dirty_mib, 2),
            "anonymousMiB": round(self.anonymous_mib, 2),
            "pssMiB": round(self.pss_mib, 2),
            "rssMiB": round(self.rss_mib, 2),
            "processes": len(self.processes),
            "names": self.names(),
            "complete": self.complete(),
        }


def sample_tree(root_pid: int) -> TreeSample:
    sample = TreeSample()
    for stat in descendants(root_pid):
        rollup = smaps_rollup(stat["pid"])
        if not rollup:
            continue  # bwrap launchers that exited, or kernel threads
        stat["private_kb"] = rollup.get("Private_Clean", 0) + rollup.get("Private_Dirty", 0)
        stat["private_dirty_kb"] = rollup.get("Private_Dirty", 0)
        stat["anonymous_kb"] = rollup.get("Anonymous", 0)
        stat["pss_kb"] = rollup.get("Pss", 0)
        stat["rss_kb"] = rollup.get("Rss", 0)
        sample.processes.append(stat)
    return sample


# Every process this harness starts carries this tag in its environment, and
# WebKit's network, web, and proxy processes inherit it. Other LeanDoc
# processes on the same machine (another checkout, a desktop session) are
# never counted or waited for.
RUN_TAG = os.environ.get("LEANDOC_TEST_TAG") or f"leandoc-harness-{os.getpid()}-{int(time.time())}"


def tagged_processes(tag: str = RUN_TAG) -> list[int]:
    """Processes still alive from an earlier launch of this harness."""
    needle = f"LEANDOC_TEST_TAG={tag}".encode()
    found = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit() or int(entry) == os.getpid():
            continue
        try:
            with open(f"/proc/{entry}/environ", "rb") as handle:
                if needle in handle.read().split(b"\0"):
                    found.append(int(entry))
        except OSError:
            continue
    return found


def wait_for_no_leftovers(timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not tagged_processes():
            return
        time.sleep(0.1)
    raise HostError(f"Earlier LeanDoc or WebKit processes did not exit: {tagged_processes()}")


# The session ------------------------------------------------------------------

class Session:
    """One LeanDoc process driven through --test-script on a FIFO."""

    def __init__(self, build: Build | None, documents=(), *, config_dir=None,
                 extra_args=(), env=None, script=True, settings=None,
                 window_size=None, stderr_path=None, wrapper=()):
        self.build = build or Build.find()
        # LeanDoc runs in its own working folder, so paths are made absolute.
        self.documents = [os.path.abspath(str(d)) for d in documents]
        self.work = Path(tempfile.mkdtemp(prefix="leandoc-session-"))
        self.config_dir = Path(config_dir) if config_dir else self.work / "config"
        self.extra_args = list(extra_args)
        self.extra_env = dict(env or {})
        self.use_script = script
        self.settings = settings
        self.window_size = window_size
        self.stderr_path = stderr_path
        self.wrapper = list(wrapper)
        self.timings: dict[str, list[tuple[int, dict]]] = {}
        self.lines: list[str] = []
        self.answers: "queue.Queue[Answer]" = queue.Queue()
        self.process: subprocess.Popen | None = None
        self.fifo_handle = None
        self.started_at = 0.0
        self._events = threading.Condition()

    # lifecycle

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()

    def environment(self) -> dict:
        env = dict(os.environ)
        env.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
        env.setdefault("GTK_A11Y", "none")
        env["LEANDOC_ASSETS_DIR"] = str(self.build.assets)
        env["XDG_CONFIG_HOME"] = str(self.config_dir)
        env["LEANDOC_TEST_TAG"] = RUN_TAG
        env.update(self.extra_env)
        return env

    def start(self):
        self.config_dir.mkdir(parents=True, exist_ok=True)
        if self.settings is not None:
            target = self.config_dir / "leandoc"
            target.mkdir(parents=True, exist_ok=True)
            (target / "settings.ini").write_text(self.settings, encoding="utf-8")
        args = self.wrapper + [str(self.build.binary), "--trace-timing"]
        if self.use_script:
            self.fifo = self.work / "script.fifo"
            os.mkfifo(self.fifo)
            args += ["--test-script", str(self.fifo)]
        args += self.extra_args
        if self.documents:
            args += ["--"] + self.documents
        stderr = open(self.stderr_path, "ab") if self.stderr_path else subprocess.DEVNULL
        self.started_at = time.monotonic()
        self.process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=stderr,
                                        env=self.environment(), cwd=str(self.work))
        if stderr is not subprocess.DEVNULL:
            stderr.close()
        self.reader = threading.Thread(target=self._read_output, daemon=True)
        self.reader.start()

    @property
    def pid(self) -> int:
        return self.process.pid

    def _read_output(self):
        for raw in self.process.stdout:
            line = raw.decode("utf-8", "replace").rstrip("\n")
            arrived = time.monotonic()
            with self._events:
                self.lines.append(line)
                if line.startswith("LEANDOC_TIMING "):
                    parts = line.split()
                    details = dict(p.split("=", 1) for p in parts[3:] if "=" in p)
                    details["_arrived"] = arrived
                    self.timings.setdefault(parts[1], []).append((int(parts[2]), details))
                elif line.startswith("LEANDOC_TEST "):
                    parts = line.split(" ", 5)
                    self.answers.put(Answer(int(parts[1]), parts[2], parts[3] == "ok",
                                            int(parts[4]), parts[5] if len(parts) > 5 else ""))
                self._events.notify_all()
        with self._events:
            self._events.notify_all()

    def wait_timing(self, event: str, count: int = 1, timeout: float = 30.0):
        deadline = time.monotonic() + timeout
        with self._events:
            while len(self.timings.get(event, [])) < count:
                left = deadline - time.monotonic()
                if left <= 0 or (self.process.poll() is not None and
                                 len(self.timings.get(event, [])) < count):
                    raise HostError(f"No {event} event #{count} within {timeout}s; "
                                    f"output: {self.lines[-10:]}")
                self._events.wait(min(left, 0.2))
            return self.timings[event][count - 1]

    def _open_fifo(self, timeout: float = 30.0):
        deadline = time.monotonic() + timeout
        while True:
            try:
                fd = os.open(self.fifo, os.O_WRONLY | os.O_NONBLOCK)
                break
            except OSError:
                if time.monotonic() > deadline or self.process.poll() is not None:
                    raise HostError("LeanDoc never opened its test script; "
                                    f"output: {self.lines[-10:]}")
                time.sleep(0.02)
        os.set_blocking(fd, True)
        self.fifo_handle = os.fdopen(fd, "w", buffering=1, encoding="utf-8")

    def command(self, line: str, timeout: float = 60.0, check: bool = True) -> Answer:
        if not self.use_script:
            raise HostError("This session has no test script.")
        if "\n" in line:
            raise ValueError("A command is one line.")
        if self.fifo_handle is None:
            self._open_fifo()
        self.fifo_handle.write(line + "\n")
        self.fifo_handle.flush()
        try:
            answer = self.answers.get(timeout=timeout)
        except queue.Empty:
            raise HostError(f"No answer to {line[:80]!r} within {timeout}s") from None
        if check and not answer.ok:
            raise HostError(f"{line[:120]!r} failed: {answer.result}")
        return answer

    # convenience

    def js(self, body: str, **kwargs):
        body = " ".join(body.split("\n"))
        return self.command("js " + body, **kwargs).json()

    def eval(self, expression: str, **kwargs):
        return self.js("return (" + " ".join(expression.split("\n")) + ");", **kwargs)

    def wait(self, expression: str, timeout_ms: int | None = None, **kwargs) -> Answer:
        if timeout_ms is not None:
            self.command(f"timeout {timeout_ms}")
        answer = self.command("wait " + " ".join(expression.split("\n")), **kwargs)
        if timeout_ms is not None:
            self.command("timeout 30000")
        return answer

    def wait_render(self, **kwargs) -> Answer:
        return self.command("wait-render", **kwargs)

    def state(self) -> dict:
        return self.js("""
            const root = document.documentElement;
            return {state: root.dataset.renderState || '', pages: Number(root.dataset.pages || 0),
              view: root.dataset.view || '', theme: root.getAttribute('data-theme') || 'system',
              title: document.title, fileName: document.getElementById('fileName').textContent,
              fileMeta: document.getElementById('fileMeta').textContent,
              status: document.getElementById('statusToast').hidden ? '' :
                document.getElementById('statusToast').textContent};""")

    def memory(self) -> TreeSample:
        return sample_tree(self.pid)

    def window_id(self, timeout: float = 10.0) -> str:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = subprocess.run(["xdotool", "search", "--pid", str(self.pid)],
                                    capture_output=True, text=True)
            ids = result.stdout.split()
            for window in ids:
                geometry = subprocess.run(["xdotool", "getwindowgeometry", window],
                                          capture_output=True, text=True).stdout
                if "Geometry:" in geometry and "1x1" not in geometry:
                    return window
            time.sleep(0.1)
        raise HostError("The LeanDoc window was not found.")

    def screenshot(self, path: str | os.PathLike) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["import", "-window", self.window_id(), str(path)], check=True,
                       capture_output=True)
        return path

    def quit(self, timeout: float = 20.0) -> int:
        if self.process.poll() is None and self.use_script:
            try:
                self.fifo_handle or self._open_fifo(5)
                self.fifo_handle.write("quit\n")
                self.fifo_handle.flush()
            except (OSError, HostError):
                pass
        try:
            return self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.process.kill()
            return self.process.wait()

    def close(self):
        if self.process and self.process.poll() is None:
            self.quit()
        if self.fifo_handle:
            try:
                self.fifo_handle.close()
            except OSError:
                pass
        shutil.rmtree(self.work, ignore_errors=True)


def xdotool(*args: str, check: bool = True) -> str:
    result = subprocess.run(["xdotool", *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise HostError(f"xdotool {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()
