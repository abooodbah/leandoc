# Validation status

**Status date:** 2026-10-20<br>
**Scope:** LeanDoc 0.1.0 candidate, branch `test/v0.1` (phase 3 of the
[execution plan](EXECUTION_PLAN.md)); the Linux session, GitHub Actions
runners for Windows, macOS, and Linux, and the reader in headless Chromium<br>
**Current public release:** none

This page records the result of every ID in the [test plan](TEST_PLAN.md),
with the evidence rules of [ACCEPTANCE.md](ACCEPTANCE.md). The defects found
and how each was fixed are in the [test report](TEST_REPORT.md). Every
figure below is a test-gate figure from a cloud session or a CI runner. None
of them is a product claim: published figures come only from the owner's
laptop run of `tests/owner/`.

## Test state

| Area | Current state | Evidence boundary |
| --- | --- | --- |
| Usage, Linux (U-01 to U-15) | Passed | Every task through the real GTK host on WebKitGTK 6.0 under Xvfb, driven by the `--test-script` hook and xdotool, in the session and in the `usage-linux` CI job. |
| Usage, Windows and macOS subsets | Passed on the runners | U-01, U-04, U-07, and U-08 on Windows; U-01, U-07, and U-08 on macOS. These hosts have no script hook, so the subsets are what the launch hooks can observe. |
| UI (UI-01 to UI-10) | Passed, sign-off pending | Linux screenshots reviewed as images; Windows and macOS screenshots checked in CI and reviewed as statistics and text thumbnails (artifact downloads are blocked in the session). A person still signs off the three contact sheets. |
| Performance (P-01 to P-11) | Passed | Every budget met in the session, on the Linux runner, and on the Windows runner (P-01 to P-06 there). P-01 in the session sits close to its budget under Xvfb. |
| Memory (M-01 to M-09) | One open defect | M-01 to M-05 and M-09 met on every layer. The leak checks M-06 to M-08 failed in some Linux runs (D-26, open, analysed); the UI process's freed heap is now returned (D-27). |
| Security in use (S-01 to S-06) | Passed | strace of the whole Linux process tree, Windows endpoint observation, ASan and UBSan, a 30-minute fuzz smoke, the corpus through Chromium and the Linux host, and file hashes. |
| Install and package lifecycle (L-01 to L-04) | Passed | `.deb` in a clean container, Windows ZIP install and uninstall, macOS ZIP signature and architectures, winget manifests. |
| Defects | 27 found, 26 fixed | Each fixed defect has a regression test; see [TEST_REPORT.md](TEST_REPORT.md). |

## Machines and methods

| Layer | Machine | Runtime | Method |
| --- | --- | --- | --- |
| Linux session | Intel Xeon @ 2.80 GHz, 4 logical processors, 15.7 GiB, Ubuntu 24.04.5 | WebKitGTK 2.52.6, GTK 4.14.5, Xvfb 2560 x 1600, Mesa llvmpipe, `WEBKIT_DISABLE_COMPOSITING_MODE=1` | `tests/usage/run-linux.sh` (own D-Bus session and Xvfb display) around the Python harnesses |
| Linux runner | GitHub `ubuntu-24.04`, AMD EPYC (7763 or 9V74, by run; 9V74 for 64535ea), 4 logical processors, 15.6 GiB | as the session | the same harnesses in the `perf-memory (Linux)` and `usage-linux` jobs |
| Windows runner | GitHub `windows-latest`, Windows Server 2025 Datacenter 10.0.26100, AMD EPYC or Intel Xeon by run (AMD EPYC 9V45 for 64535ea), 4 logical processors, 16 GiB | WebView2 154.0.4258.62 | `tests/perf/Measure-LeanDocPerf.ps1`, `tests/usage/Test-WindowsUsage.ps1`, `tests/hosts/*.ps1` |
| macOS runner | GitHub `macos` | WKWebView | `tests/usage/test-macos-usage.sh`, `tests/visual/capture-macos.sh`, `tests/hosts/Test-MacPackage.sh` |
| Reader | headless Chromium 141.0.7390.37 (Playwright headless shell 1194), fake host | | `npm run test:reader`: 76 tests, plus the core-fixture cases with `LEANDOC_INSPECT` |

Memory on Linux is the **private dirty** memory of the whole process tree
(LeanDoc, WebKitWebProcess, WebKitNetworkProcess, xdg-dbus-proxy, and the
bwrap sandboxes), summed from `/proc/<pid>/smaps_rollup` over a `/proc`
walk of the tree. Private clean pages (shared libraries no other process
has mapped yet) move by tens of MiB with what else runs on the machine, so
the gates use private dirty; private, PSS, and RSS are recorded beside it.
Each sample waits until three readings 0.5 s apart agree within 1.5 MiB.
Each launch waits until the previous tree is gone, and a tree without its
web and network processes is excluded. On Windows memory is the private
bytes of the tree, as LeanMark measures it.

## Usage

| ID | Linux session | Windows runner | macOS runner |
| --- | --- | --- | --- |
| U-01 | Pass: first page 109 ms after the reader was ready; "5.2 KB · 3 pages" | Pass: `rendered` with its page count | Pass: `rendered`, then a clean exit |
| U-02 | Pass: Page Down, Space, arrows, Home, End; outline current section from first to last heading | not run (no script hook) | not run |
| U-03 | Pass: LibreOffice, then the default app for the file's own type, then Word for the web with the explanation | static and unit checks only | static checks only |
| U-04 | Pass: one process; later launches to `rendered` 209 to 355 ms after a first of 681 ms | Pass: one process; launch to `rendered` 535 ms, then 20 to 45 ms | not run (LaunchServices) |
| U-05 | Pass: "station" 1/105 in page and reading view; Escape clears | not run | not run |
| U-06 | Pass: 72 headings land on their paragraph; highlight follows scrolling | not run | not run |
| U-07 | Pass: 23 security fixtures, each ready or fallback as the core decides, no dialog | Pass: every security fixture renders or falls back as expected, no crash or hang | Pass: same |
| U-08 | Pass: `.doc`, encrypted, `.odt`, renamed `.xlsx`, 0-byte, RTF each show their own fallback page with the editor action | Pass: exit 1 (fallback) within 20 s for each | Pass: same |
| U-09 | Pass: Arabic fixtures right to left, find on Arabic words, Arabic outline | not run | not run |
| U-10 | Pass: dropped `.docx` opens as a tab; `.txt` refused with a status message | not run | not run |
| U-11 | Pass: reload in 789 ms, position kept (0.50 to 0.50) | not run | not run |
| U-12 | Pass: theme, view, recent files kept; recent opens; Clear empties | not run | not run |
| U-13 | Pass: https, mailto (rebuilt), and http open in the handler only after a click | not run | not run |
| U-14 | Pass: Copy all 114 characters without headers and footers; selection copied | not run | not run |
| U-15 | Pass: deleted and renamed files show "LeanDoc could not find this file."; other tabs unaffected | not run | not run |

## UI

| ID | Result | Evidence |
| --- | --- | --- |
| UI-01 | Pass, sign-off pending | Linux: 84 captures (21 fixtures, page and reading, light and dark) in four contact sheets, each reviewed; the review found D-24 (pictures missing) and D-25 (focus ring). Windows and macOS: 84 captures each in CI; every capture present, none flat, every dark capture darker; text thumbnails of the page view reviewed. |
| UI-02 | Pass with listed differences | LibreOffice 24.2.7 headless to PDF, first page rasterized with pdftoppm, beside LeanDoc's page view. Text, order, lists, tables, and images match after D-24. Remaining differences are listed in the test report's known gaps. |
| UI-03 | Pass | 16 chrome states (empty, document, find, details, reading, fallback, error, status; light and dark) at 0.000 percent changed pixels against `tests/visual/baselines/chromium-141`, in the session and in CI on the same Chromium build. |
| UI-04 | Pass | 800 x 600, 1280 x 800, 1920 x 1080, and 2560 x 1440 at 200 percent on the Linux host: no clipped control, no overlap, outline shown. |
| UI-05 | Pass | System, Light, Dark with the desktop switching while open: chrome follows, pages stay paper. Lowest chrome contrast 6.33:1 light, 6.59:1 dark; fallback page 4.77:1 (eyebrow, light). |
| UI-06 | Pass after D-23 | Every SPEC 4.2 shortcut (14) on the Linux host; Tab order find, Page, Reading, zoom out, zoom, zoom in, theme, editor, Open, tab, outline toggle, outline entry, document, then round again; focus visible on each. |
| UI-07 | Pass | axe-core 4.13.0 on all 16 states: zero serious or critical findings in the chrome after D-20 and D-21. Findings inside the rendered document content (the test document's own colours) are reported, not gated. |
| UI-08 | Pass | Reader tests: fidelity bar wording, counts against the core for every feature fixture (with `LEANDOC_INSPECT`), collapse per tab, one announcement per document. |
| UI-09 | Pass | 50 to 300 percent and fit width with Ctrl+wheel on the Linux host; position ratio kept at 0.400. |
| UI-10 | Pass | Reader tests: missing package, unreadable package, renderer failure, every core error code; the renderer-stopped page (D-03) on Linux. Readable message and editor action, no stack trace. |

## Performance

Median of 10 launches, all three columns on revision 64535ea (the final
product code). On Windows, P-07 to P-11 need the script hook, which only the
Linux host has.

| ID | Budget | Linux session | Linux runner | Windows runner |
| --- | --- | ---: | ---: | ---: |
| P-01 window visible | < 300 ms | 252.0 ms | 172.0 ms | 37 ms |
| P-02 first page, 3 pages | < 1.0 s | 631.0 ms | 516.5 ms | 432.5 ms |
| P-03 first page, 300 pages | < 2.5 s | 1380.0 ms | 987.5 ms | 763 ms |
| P-04 first page, 1,000 pages, responsive | < 6 s; no long stall | 3717.5 ms; longest stall web 339.5 ms, UI 82.7 ms | 2169.0 ms; 215.6 ms, 80.8 ms | 1639 ms |
| P-05 core open and sanitize (worst document) | 50 / 500 / 1500 / 1000 ms | 176.8 ms | 118.8 ms | 105.3 ms |
| P-06 second document as a tab | < 500 ms | 295.5 ms | 249.6 ms | 26.2 ms |
| P-07 tab switch back, 300 pages | < 1.5 s | 1176.5 ms | 738.0 ms | not run |
| P-08 view switch, 300 pages | < 1.5 s | 1048.5 ms | 683.5 ms | not run |
| P-09 find, 300 pages | < 300 ms | 195.5 ms (1/1114) | 161.0 ms | not run |
| P-10 scrolling, 300 pages | 95 percent of frames < 33 ms (Chromium) | Chromium: 100 percent under 33 ms, p95 16.7 ms (809 frames, 3 runs); WebKitGTK p95 91 ms, recorded | WebKitGTK p95 44 ms, recorded | not run |
| P-11 zoom step, 300 pages | < 300 ms | 254.5 ms | 158.0 ms | not run |

Under Xvfb the GTK host renders with Mesa's software GL; about 125 ms of
P-01 in the session is its start-up, and session medians of P-01 ranged from
231 to 295 ms between runs of the same build. P-04 was a budget miss before
D-22 (longest web stall 3,927 ms). P-05's worst document is the 20 MB
image-heavy one; each document met its own budget.

## Memory

| ID | Budget | Linux session | Linux runner | Windows runner |
| --- | --- | ---: | ---: | ---: |
| M-01 empty window | baseline | 148.9 MiB (private 216.6, PSS 277.4) | 191.8 MiB | 89.3 MiB |
| M-02 3 pages | M-01 + 40 | +9.2 | +7.7 | +11.9 |
| M-03 300 pages | M-01 + 120 | +78.1 | +72.6 | +88.8 |
| M-04 1,000 pages | M-01 + 300 | +202.8 | +204.9 | +293.8 |
| M-05 five tabs | M-02 + 25 | 159.9 (budget 183.1) | 205.6 (224.5) | 101.9 (126.2) |
| M-06 open and close 300 pages 30 times | at most +10 % | **+20.1 % (fail, D-26)** | +3.2 % | not run |
| M-07 10 tabs x 50, 50 view switches | growth < 15 MiB | 10.0 MiB | **83.8 MiB (fail, D-26)** | not run |
| M-08 idle 10 minutes | < 5 MiB, no CPU | -0.04 MiB, 0.26 s CPU (0.043 % of a core) | **94.2 MiB (fail, D-26)**, 0.19 s CPU | not run |
| M-09 security fixtures | peak within M-02 | 247.4 MiB UI process peak against 250.8 | 265.8 against 279.4 | not run |

The leak checks are where the runs disagree, and [D-26](TEST_REPORT.md) is
open for them. Two things move the Linux figures:

- The WebKit web process keeps the garbage of a closed or re-rendered
  document until JavaScriptCore next collects, which an idle reader does not
  trigger. Its share of the tree moves by up to 35 MiB between samples
  (M-06 in the session: 66.8, 81.3, 69.6, and 101.5 MiB after closes 1, 10,
  20, and 30), so M-06 passed at -14.9 and -13.2 percent in earlier runs
  and failed at +20.1 percent in the final one. The reader holds none of it:
  in Chromium with forced collection, 160 view switches leave a 3.4 MiB
  JavaScript heap with constant DOM nodes and listeners, and over 200 view
  switches on the Linux host the web process levels off at 60 to 66 MiB.
- On some runner images (the ones with M-01 near 192 MiB, against 150 MiB on
  the others and 149 MiB in the session) the UI process's main heap grows by
  live allocations: +75 MiB over the M-07 tab cycles and +94 MiB in minutes
  2 to 4 of M-08, with 0.19 s of CPU in ten minutes. The heap trim (D-27)
  does not release it, and the session does not show it (UI process flat at
  98.5 MiB through M-06 to M-08). The perf job now runs heaptrack against
  the idle UI process to name the allocation site.

Same Windows runner, same method (private bytes of the tree): LeanDoc 89.3
MiB empty, 101.2 MiB with a 3-page report, 178.1 MiB with a 300-page
report; LeanMark 0.3.0 112.9 MiB with README.md and 99.9 MiB with a
300-section Markdown file. M-04 on Windows passes with 6 MiB to spare.

## Security in use

| ID | Result | Evidence |
| --- | --- | --- |
| S-01 | Pass | `strace -f -e trace=connect,sendto,sendmsg` around the Linux host (12 processes, including the sandboxed web and network processes) while it opened all 23 security fixtures and chose every remaining item of the link context menu (6 menus): 1,536 calls, connect families AF_UNIX 6 and AF_NETLINK 2, no other address. |
| S-02 | Pass | `tests/hosts/Observe-WindowsNetwork.ps1` on the Windows runner: the TCP connections and UDP endpoints of the whole tree (LeanDoc.exe and 5 WebView2 processes) for 4 s from launch, for each of the 21 `.docx` security fixtures: 15 to 30 samples each, about 210 to 300 ms apart (one gap of 1,384 ms on the first launch), and no endpoint at all from any process of the tree. Polling can miss a connection shorter than the gap. |
| S-03 | Pass | Core built with ASan and UBSan (clang 18): CTest 3 of 3, and `leandoc-inspect` over the 50 corpus files and every fixture (102 files): no finding. |
| S-04 | Pass | libFuzzer `leandoc_fuzz_open`, seeds from every fixture and the corpus (102 files): 126,174 executions in 1,801 s (70 per second), coverage 3,757, 0 crashes, peak RSS 455 MiB. |
| S-05 | Pass | 50 corpus files (29 Apache POI, 21 LibreOffice) through the reader in Chromium: all rendered or fell back cleanly, no CSP violation, no script error, no network attempt, slowest 420 ms. The same 50 through the Linux host in one window: 38 ready, 12 fallback, no crash, slowest 724 ms. |
| S-06 | Pass | SHA-256 of all 73 files opened in S-01 and S-05 identical before and after. |

## Install and package lifecycle

| ID | Result | Evidence |
| --- | --- | --- |
| L-01 | Pass | `tests/hosts/Test-DebLifecycle.sh` in a fresh `ubuntu:24.04` container in CI: apt resolves every dependency, the installed binary passes `--smoke-test`, purge leaves no installed file. |
| L-02 | Pass | `tests/hosts/Test-WindowsLifecycle.ps1` on the runner: extract, smoke, `install.ps1` (Open With entries present, no default taken from another app), `uninstall.ps1` (registry and files restored, WebView2 data removed) after D-02, D-07, and D-19. |
| L-03 | Pass | `tests/hosts/Test-MacPackage.sh`: `codesign --verify --deep --strict`, x86_64 and arm64 in every binary, smoke from the unzipped app. |
| L-04 | Pass | `winget validate` on the Windows runner: valid, with a warning that the runner's older client does not know the 1.12.0 schema header. |

## Open items

- D-26 (the Linux leak checks M-06 to M-08) is open; the test report gives
  the analysis and what closes it.
- The owner signs off the three UI-01 contact sheets.
- Published figures and the Word comparison remain the owner's laptop run
  (PERF-EXT); nothing here is a product claim.
