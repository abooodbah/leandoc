# Test plan for v0.1.0

Phase 3 of the [execution plan](EXECUTION_PLAN.md). It runs after the three
build streams are integrated and before the README, site, and release.

This is not a code review. It tests LeanDoc the way people will use it: real
tasks, the real interface on each platform, and measured speed and memory. A
dedicated test agent runs it, separate from the agents that built the code, and
files every defect it finds. The results go into
[VALIDATION_STATUS.md](VALIDATION_STATUS.md) with the evidence rules in
[ACCEPTANCE.md](ACCEPTANCE.md).

## Where each layer runs

| Environment | Runtime | Used for |
| --- | --- | --- |
| Linux session (this cloud container) | real LeanDoc GTK host on WebKitGTK 6.0 under Xvfb | usage, UI, performance, memory, network observation |
| GitHub Actions `windows-latest` | real LeanDoc on WebView2 | usage smoke, UI screenshots, performance and memory (comparison only) |
| GitHub Actions `macos` | real LeanDoc on WKWebView | usage smoke, UI screenshots, timing |
| Headless Chromium with the fake host | reader only | fast UI and regression checks on every change |
| Owner's Windows laptop | release build | the only figures that may be published, and the Word comparison |

Runner figures decide pass or fail against budgets and catch regressions. They
are never published as product claims.

## 1. Usage testing

Scripted end-to-end tasks, driven through the real host (keyboard, mouse,
command line, second launch), each with a pass rule. They run on Linux in the
session, and the Windows and macOS subsets run in CI.

| ID | Audience | Task | Pass rule |
| --- | --- | --- | --- |
| U-01 | No Word | Double-click (command-line path) an emailed report | first page visible, file name and page count shown, no prompt |
| U-02 | No Word | Read a 20-page document to the end with the keyboard only | Page Down, Space, Home, End, arrow keys all work; position shown |
| U-03 | No Word | Need to edit: press "Open in ..." | editor resolved per SPEC 5 order launches with the file; with no editor installed, Word for the web opens with the explanation toast |
| U-04 | Reader with Word | Open five attachments in a row from the file manager | one window, five tabs, one process tree; the fifth opens as fast as the first |
| U-05 | Reader with Word | Find a phrase, step through matches, switch to reading view, find again | same match count in both views; Escape clears |
| U-06 | Reader with Word | Jump through a long report with the navigation pane | every heading lands at the right paragraph; current section highlights while scrolling |
| U-07 | Untrusted attachment | Open each security fixture | fidelity bar names the risk; nothing is fetched or run; no dialog appears |
| U-08 | Untrusted attachment | Open a `.doc`, an encrypted file, an `.odt`, a renamed `.xlsx`, a 0-byte file | the right fallback page, with the open-in-editor action, never a blank window or crash |
| U-09 | Arabic reader | Open the Arabic fixtures and a mixed Arabic and English report | text right-aligned, lists and tables mirrored, find works on Arabic words, outline shows Arabic headings, file name not reversed |
| U-10 | Everyone | Drag a file onto the window; drop an unsupported file | supported opens in a tab; unsupported shows a status message and never navigates |
| U-11 | Everyone | Edit the open file in another program and save | LeanDoc reloads and keeps the reading position |
| U-12 | Everyone | Close and relaunch | theme, view, and recent files remembered; recent list opens files; Clear recent empties it |
| U-13 | Everyone | Click links of each kind in a document | https and mailto open in the system handler only after a click; others are inert |
| U-14 | Everyone | Copy a selection and copy all text | clipboard holds the expected text, without headers and footers |
| U-15 | Everyone | Delete or rename an open file, then switch back to its tab | clear message, other tabs unaffected |

## 2. UI testing

| ID | Area | Method | Pass rule |
| --- | --- | --- | --- |
| UI-01 | Visual review | Screenshot every feature fixture in page and reading view, light and dark, in the real host on Linux, Windows, and macOS; assemble one contact sheet per platform | a person signs off each sheet; defects filed with the image |
| UI-02 | Rendering second opinion | Convert each feature fixture to PDF with LibreOffice headless and place it beside the LeanDoc screenshot | differences in text, order, lists, tables, or images are listed; each is fixed or listed as a known gap |
| UI-03 | Visual regression | Pixel baselines in headless Chromium for chrome states (empty, fidelity bar, fallback, tabs, find, dark) | under 0.5 percent changed pixels unless the change is intended and the baseline is updated in the same commit |
| UI-04 | Window sizes | 800 x 600, 1280 x 800, 1920 x 1080, and a 2560 x 1440 window at 200 percent scale | no clipped controls, no overlapping text, toolbar wraps or collapses cleanly, outline collapses at narrow widths |
| UI-05 | Themes | System, Light, Dark cycle with the OS switching theme while open | chrome follows; document pages stay paper; contrast of chrome text at least 4.5:1 |
| UI-06 | Keyboard | Every shortcut in SPEC 4.2 and full Tab order through the chrome | each works; focus always visible; no keyboard trap |
| UI-07 | Accessibility | axe-core in Playwright on every chrome state; manual check of names and roles with the platform accessibility inspector where available | zero serious or critical axe findings |
| UI-08 | Fidelity bar | Every combination of features in the fixtures | wording matches SPEC exactly, counts match the core, the bar never covers the page, collapse is per tab |
| UI-09 | Zoom | 50, 100, 200, 300 percent and fit width, with Ctrl+wheel | text stays sharp, layout stable, position kept |
| UI-10 | Error states | Missing package, renderer failure, core error codes | readable message, the open-in-editor action, no stack traces shown |

## 3. Performance testing

All timings are medians of 10 launches unless stated, with the method in
LeanMark's `tests/Measure-Performance.ps1`. The harness records the machine,
runtime version, document, and raw samples.

| ID | Measure | Documents | Budget (gate on the Linux session and the Windows runner) |
| --- | --- | --- | --- |
| P-01 | Launch to window visible | none | under 300 ms |
| P-02 | Launch to first page rendered (`rendered` message) | 3-page report | under 1.0 s |
| P-03 | Same | 300-page report | under 2.5 s |
| P-04 | Same | 1,000-page report (generated at test time) | under 6 s, and the window stays responsive while it loads |
| P-05 | Core open and sanitize (leandoc-inspect, Release) | 3-page, 300-page, 1,000-page, 20 MB image-heavy | under 50 ms, 500 ms, 1.5 s, 1 s |
| P-06 | Second document opened as a tab in a running window | 3-page report | under 500 ms |
| P-07 | Tab switch back to a background tab | 300-page report | under 1.5 s |
| P-08 | View switch, page to reading | 300-page report | under 1.5 s |
| P-09 | Find first result and match count | 300-page report, common word | under 300 ms |
| P-10 | Scrolling | 300-page report, scripted scroll top to bottom | 95 percent of frames under 33 ms in Chromium (frame timing); no visible stalls in the WebKitGTK host recording |
| P-11 | Zoom step | 300-page report | under 300 ms |

A budget miss is a defect. The fix is to the code or to the design (for example
lazy rendering for long documents), not to the budget, unless the owner agrees
to a new budget in writing.

## 4. Memory footprint testing

Memory is the private memory of the complete process tree: LeanDoc plus every
web runtime process it starts. On Linux the harness also records the
proportional set size. Each value is the median of 10 launches, sampled after
the page is stable, with previous runtime processes gone before each launch and
incomplete trees excluded, as LeanMark does.

| ID | Scenario | Budget (gate) |
| --- | --- | --- |
| M-01 | Empty window, no document | record as the baseline |
| M-02 | 3-page report open | baseline plus at most 40 MiB |
| M-03 | 300-page report open | baseline plus at most 120 MiB |
| M-04 | 1,000-page report open | baseline plus at most 300 MiB, and no out-of-memory |
| M-05 | Five documents open as tabs | at most M-02 plus 25 MiB (background tabs keep no package or DOM) |
| M-06 | Leak check: open and close the 300-page report 30 times in one window | final value within 10 percent of the value after the first close |
| M-07 | Leak check: cycle 10 tabs 50 times and switch views 50 times | growth under 15 MiB from the first cycle to the last |
| M-08 | Idle for 10 minutes with a document open | no growth over 5 MiB; no CPU use while idle |
| M-09 | Security fixtures (zip bomb, deep nesting, many entries) | the core never exceeds its limits; peak stays within M-02 |

On Windows the runner figures are compared with LeanMark 0.3.0 measured by
the same harness on the same runner, so the family stays in the same range
(LeanMark: about 97 MiB for a simple document and 125 MiB for a heavy one on
the owner's laptop). The owner's laptop run of `tests/owner/Measure-Performance.ps1`
and `tests/owner/Compare-WithWord.ps1` produces the only published figures.

## 5. Security and robustness in use

| ID | Check | Pass rule |
| --- | --- | --- |
| S-01 | Every security fixture through the real Linux host with `strace -f -e trace=connect,sendto` | no connection attempt to any address other than local IPC |
| S-02 | Same on the Windows runner with a TCP and UDP endpoint observation in the style of LeanRows' `Observe-LeanRowsNetwork.ps1` | no connection from LeanDoc's own process; runtime connections recorded and attributed |
| S-03 | Full core suite and corpus under ASan and UBSan | zero findings |
| S-04 | Fuzz smoke of the core with fixtures as seeds for 30 minutes | zero crashes; duration and executions recorded |
| S-05 | Corpus render: every fetched POI and LibreOffice `.docx` through the real reader in headless Chromium and a sample of 50 through the Linux host | no crash, no hang over 10 s, no uncaught script error; `renderFailed` cases listed |
| S-06 | Source file unchanged | hash of every opened file identical before and after |

## 6. Install and package lifecycle

| ID | Check | Pass rule |
| --- | --- | --- |
| L-01 | `.deb` into a clean `ubuntu:24.04` container in CI: install, launch smoke, uninstall | dependencies resolve; no files left after purge |
| L-02 | Windows ZIP on the runner: extract, smoke, `install.ps1`, Open With entries present, `uninstall.ps1` | registry and files restored |
| L-03 | macOS ZIP: unzip, signature check, both architectures, smoke | passes |
| L-04 | winget manifests | `winget validate` passes where available |

## 7. Exit criteria

- Every ID above has a recorded result in `docs/VALIDATION_STATUS.md`.
- No open defect of severity 1 (crash, data loss, network fetch, wrong text) or
  severity 2 (blocked task in section 1, budget miss in sections 3 and 4).
- Severity 3 defects are fixed or listed as known gaps in the release notes.
- The test agent's report lists every defect found, how it was fixed, and the
  commit.

## 8. Tooling to build for this phase

- `tests/usage/` drivers for the Linux host (xdotool or the host's
  `--test-script` hook) and CI equivalents for Windows (UI Automation) and
  macOS (`--smoke-test` variants).
- `tests/perf/` harness: timing and memory sampling for Linux (`/proc` process
  tree, PSS and private), shared result format with the Windows PowerShell
  harness, and a budget checker that fails the run.
- `tests/visual/` contact sheet builder and LibreOffice side-by-side.
- A CI job `perf-memory` on Linux and Windows that runs sections 3 and 4 on
  every pull request to `main` and posts the table in the job summary.
