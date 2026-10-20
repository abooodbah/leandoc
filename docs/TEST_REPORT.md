# Test report for v0.1.0

Phase 3 of the [execution plan](EXECUTION_PLAN.md): the defects found while
running the [test plan](TEST_PLAN.md) and the independent security review of
`integrate/v0.1`, each with its fix and the test that keeps it fixed. Results
per test ID are in [VALIDATION_STATUS.md](VALIDATION_STATUS.md).

Severity follows TEST_PLAN section 7: 1 is a crash, data loss, a network
fetch, or wrong text; 2 is a blocked usage task, a budget miss, or a
security weakness short of a fetch; 3 is everything else. Evidence paths
under `artifacts/` are produced by the harnesses named in each entry (git
ignores them; CI uploads them as artifacts).

## Summary

| ID | Severity | Area | Defect | Fixed in | Regression test |
| --- | --- | --- | --- | --- | --- |
| D-01 | 1 | All hosts | The page's context menu fetched link targets ("Download Linked File", "Save link as", "Open Link") | 6fbb09c | `tests/hosts/linux_regressions.py` (context menu), `HostLogicTests` (Windows list), `macos/tests/test_static.py` |
| D-02 | 2 | Windows installer | `install.ps1` set the HKCU default for an extension that HKLM already gave to Word or LibreOffice | 9ffc700 | `Test-LeanDoc.ps1` static checks, `-ValidateOnly` plan, L-02 |
| D-03 | 2 | Linux, macOS | A web process that kept dying was reloaded forever | 9f17143 | `linux_regressions.py` (crash cap), `test_static.py` |
| D-04 | 2 | Linux | A file name that is not valid UTF-8 broke the empty page, and one such path in settings.ini emptied the recent list | 0f4a497 | `linux_regressions.py` (names), reader test (recent ids) |
| D-05 | 2 | Reader, all hosts | `mailto:` links passed every parameter, including `attach=` | 6fbb09c | `CoreTests` `TestLinks`, `fixups.test.mjs`, U-13 |
| D-06 | 3 | Windows, Linux | Hosts disagreed on which `mailto:` links to open | 6fbb09c | `CoreTests` `TestLinks` |
| D-07 | 3 | Windows uninstaller | `%LOCALAPPDATA%\LeanDoc\WebView2` was left behind | 9ffc700 | L-02 (`Test-WindowsLifecycle.ps1`) |
| D-08 | 3 | macOS | A background window kept its sanitized package | 9ffc700 | `test_static.py`; DOM kept by design, documented in `docs/architecture/hosts.md` |
| D-09 | 3 | Linux | Open in editor used the `.docx` default app for `.odt`, `.rtf`, and `.doc`, and the button named it | 0f4a497 | U-03 |
| D-10 | 3 | Windows | Navigation to any page of the app origin was allowed, not only the reader | 9f17143 | `Test-LeanDoc.ps1` static check |
| D-11 | 1 | Reader | A footnote or endnote reference with direct superscript formatting was numbered one too high and its note listed twice | ecadafd | reader core case `notes-superscript.docx` |
| D-12 | 3 | Reader tests | The test browser opened connections outside the page (to Google and to `app.leandoc.invalid:443`) and the tests could not see it | ecadafd | every reader test asserts zero attempts at a recording proxy |
| D-13 | 2 | Linux | P-01 sat on its budget: median 291.5 ms window visible, single launches to 498 ms | 4b016c3 | P-01 in `tests/perf/run_perf.py` |
| D-14 | 2 | Linux | M-06 and M-07 missed their leak budgets (plus 19.7 percent; plus 25.8 MiB) | 7068b14 | M-06, M-07 |
| D-15 | 2 | Reader, Linux | Page Down, Space, and the arrows did nothing in a freshly opened document until it was clicked (U-02 blocked) | 99bb3ca | U-02, reader test "a rendered document takes the focus" |
| D-16 | 3 | Reader | A clicked outline entry lost its highlight to the next heading when the two were close | 99bb3ca | U-06, reader test "a clicked outline entry stays current" |
| D-17 | 2 | Reader | Pages not yet drawn were estimated 192 px too tall, so Home, End, and jumps landed short in Chromium and WebView2 | 99bb3ca | reader test (Home and End) |
| D-18 | 1 | Core, reader | PAGE and NUMPAGES fields showed the saved value on every page ("page 1" in every footer) | 7d4191d | `CoreTests`, `fixups.test.mjs`, reader core case `headers-footers.docx` |
| D-19 | 3 | Windows uninstaller | Empty `OpenWithProgids`, extension, and `RegisteredApplications` keys were left behind | af3958b | L-02 |
| D-20 | 2 | Reader | Accessibility: each tab contained a focusable close button, and the document could not be reached with Tab | 526fb5b | UI-07 (`tests/reader/ui-checks.mjs`) |
| D-21 | 2 | Reader | Accessibility: the fallback page's heading label had 4.0:1 contrast in the dark theme | 526fb5b | UI-07 |
| D-22 | 2 | Reader, Linux | The 1,000-page report froze the page for 3.9 s while it loaded (P-04 responsiveness) | 20332ef | P-04 probe in `tests/perf/run_perf.py`, reader test (1,000 pages, longest task) |
| D-23 | 2 | Reader, Linux | After Tab past the last control, or Ctrl+Tab on Linux, no key reached the page until a click | 7575fdf | `linux_regressions.py` (keyboard focus), reader test "Tab wraps around", UI-06 |
| D-24 | 1 | Linux | Every picture showed as an empty frame | a27bf73 | `linux_regressions.py` (images), `Test-LinuxSource.mjs` |
| D-25 | 3 | Reader | Every freshly opened document was framed by the blue keyboard-focus ring | 3e2d7cc | reader test "without a focus ring" |
| D-26 | 2 | Linux | The leak checks M-06 to M-08 pass in some runs and fail in others (web process garbage; live UI heap growth on some runner images) | open | M-06 to M-08 in `tests/perf/run_perf.py`, `tests/perf/heap_profile.py` |
| D-27 | 2 | Linux | The UI process kept about 20 MiB of freed heap after reading documents | 64535ea | M-06 to M-08, `Test-LinuxSource.mjs` |

Every defect above except D-26 is fixed. D-26 is open, with its analysis below. Known gaps that remain are listed at the end.

## Details

### D-01: the context menu fetched link targets (severity 1)

- Found by: the security review; confirmed on the Linux host.
- Steps: open a document with a link to `http://127.0.0.1:PORT/probe`,
  right-click the link, choose "Download Linked File".
- Expected: nothing the document points to is fetched.
- Actual: a GET reached the local server before WebKit cancelled the
  download. WebView2 offered "Save link as" and "Open link in new window",
  WKWebView "Download Linked File" and "Open Link".
- Fix: the context menu keeps only copy and editing items. Linux filters by
  `WebKitContextMenuAction` in the `context-menu` signal; Windows by item name
  in `ContextMenuRequested` (`src/windows/ContextMenu.h`, turned off entirely
  without `ICoreWebView2_11`); macOS in `willOpenMenu:withEvent:` of a
  `WKWebView` subclass. With `--test-script` the Linux host prints the
  remaining actions.
- Evidence: the right-click now offers only "Copy Link"; the server saw no
  request (`linux_regressions.py`, context menu step).

### D-02: the installer took over a machine-wide default (severity 2)

- Steps: on a machine where Word or LibreOffice is deployed with an
  `HKLM\Software\Classes\.docx` default and no UserChoice, run `install.ps1`.
- Expected: LeanDoc is offered, never silently made the default.
- Actual: `install.ps1` wrote the HKCU default, which takes precedence.
- Fix (owner's decision): the HKCU default is written only when no UserChoice
  exists and neither HKCU nor HKLM (both registry views) has a default; HKLM
  is only read. `-ValidateOnly` lists, per extension, which of the two would
  happen; `installer/README.md` says so. The README line is the site agent's.

### D-03: endless reload after renderer crashes (severity 2)

- Steps: kill `WebKitWebProcess` repeatedly while a document is open.
- Expected: a bounded recovery, as Windows has (three a minute).
- Actual: Linux and macOS reloaded on every crash.
- Fix: three recoveries a minute; the fourth shows a "renderer-stopped"
  fallback page for that document ("Press F5 to try again."); after that the
  window stays as it is. F5 clears it.
- Evidence: `artifacts` from `linux_regressions.py`: states ready, ready,
  ready, renderer-stopped, no reload.

### D-04: non-UTF-8 file names (severity 2)

- Steps: open `caf\xe9 report.docx` (Latin-1 bytes), close it, look at the
  empty page; or start with a settings.ini that lists such a path.
- Actual: the empty page's script was dropped by WebKit (raw bytes), and
  GKeyFile refused the whole Recent list.
- Fix: the empty page sends display names and an opaque id per entry; the
  reader posts the id back with `openRecent`; recent paths are stored as file
  URIs, and old plain paths are still read; every script is made valid UTF-8
  before it is evaluated. SPEC 4.3 and `tests/reader/README.md` updated.

### D-05 and D-06: mailto parameters and host disagreement (severity 2, 3)

- Actual: `mailto:a@b?attach=/home/u/.ssh/id_rsa` reached the mail client
  (honoured by some, CVE-2020-11879 and CVE-2020-11880); Windows compared
  schemes case-sensitively and refused spaces, Linux accepted spaces.
- Fix: one rule for all hosts, `NormalizeExternalLink` in `src/core/Links.h`,
  and the same rebuild in `assets/fixups.js`: the scheme is compared without
  case, raw spaces, controls, non-ASCII, quotes, backslashes, angle brackets,
  and backticks are refused (the reader percent-encodes them), and `mailto`
  keeps only its addresses and `subject`, `body`, `cc`, `bcc`.
- Evidence: U-13 opened `mailto:team@example.org?subject=Hello&body=Hi` for a
  link that carried `attach=/etc/passwd`.

### D-07 and D-19: uninstall leftovers (severity 3)

- Actual: `%LOCALAPPDATA%\LeanDoc\WebView2` and, on a clean account, empty
  registry keys stayed after `uninstall.ps1`.
- Fix: the uninstaller removes exactly that folder (refusing a reparse point
  at it or its parent, and removing links inside it as links), the parent if
  empty, and per-user keys that the uninstall left empty.
- Evidence: L-02 compares the registry and files before the install and
  after the uninstall and finds them identical.

### D-08: macOS background windows (severity 3)

- Fix (owner's decision): the document drops its sanitized package once the
  reader has fetched it and reads the file again when the reader asks for the
  document again. Each window keeps its own DOM because macOS tabs are system
  window tabs; `docs/architecture/hosts.md` says so.

### D-09: Linux editor per file type (severity 3)

- Fix: with no LibreOffice, the default handler is looked up for the file's
  own content type when the button is pressed, skipping LeanDoc, and the
  button label follows the active file. With none, Word for the web opens.

### D-10: Windows navigation (hardening)

- Fix: `NavigationStarting` allows only `https://app.leandoc.invalid/reader.html`
  and `about:blank`, as the Linux and macOS hosts do.

### D-11: note references numbered wrong (severity 1)

- Steps: a footnote reference in a run with `w:vertAlign superscript` instead
  of the FootnoteReference style (`tests/fixtures/features/notes-superscript.docx`).
- Expected: references 1, 2, 3, each note listed once.
- Actual: 2, 3, 5 (and an endnote 2), each such note listed twice at the
  foot of the page.
- Cause: docx-preview 0.4.1 renders a run with direct vertical alignment
  twice and keeps the second copy; the reference counter runs both times.
- Fix: `fixNoteReferenceRun` in `assets/fixups.js` drops the run's own
  vertical alignment (the reference already renders as superscript).

### D-12: the reader tests' browser reached the network

- Actual: under the full Chrome the tests contacted `accounts.google.com`,
  `content-autofill.googleapis.com`, and preconnected to
  `app.leandoc.invalid:443` outside page routing; the session proxy refused
  them, and no test noticed.
- Fix: the tests prefer Playwright's headless shell, which makes no request
  of its own, send every browser request (loopback included) to a local
  proxy that refuses and records it, and assert the record is empty. A full
  Chrome now fails the suite. CI installs the headless shell.

### D-13: window-visible time (severity 2)

- Measured (Linux session, 10 alternating launches): old order median
  291.5 ms (one launch 498 ms), new order 231.5 ms; first page 590 to 564 ms.
- Cause: the window was presented after the web context, the web view, and
  the navigation; GTK's software GL initialization under Xvfb (about 125 ms)
  then followed all of it.
- Fix: the window is shown first with the reader's background colour, then
  the web view is built. The web view takes the keyboard focus explicitly
  (the first version of this change lost it; see D-15).

### D-14: memory kept after a document is closed (severity 2)

- Measured: open and close the 300-page report 30 times: 228.8 to
  273.9 MiB (plus 19.7 percent); cycle 10 tabs 50 times and switch views 50
  times: plus 25.8 MiB.
- Cause: not a reader leak. After a forced collection in Chromium the live
  JavaScript heap stays at 3 to 4 MiB over the same cycles, with flat DOM
  counters. JavaScriptCore keeps a closed document's garbage until it next
  collects, which an idle reader never triggers.
- Fix: WebKit's memory pressure handler for the web process (limit 300 MiB,
  checked every 5 s): it releases caches and collects past a third of the
  limit. Idle CPU stays near zero (1 tick in 15 s with a 1,000-page report).
- After: M-06 plus 7.1 percent, M-07 plus 12.1 MiB.

### D-15: keyboard reading did nothing until a click (severity 2)

- Steps: open a document, press Page Down (U-02).
- Actual: nothing moved. Focus was on `body`, which does not scroll; the
  document scrolls in `#docScroller`.
- Fix: after a render the document takes the focus unless a control has it.
  `#docScroller` is now in the Tab order with a visible focus ring (D-20).

### D-16: outline highlight after a click (severity 3)

- Fix: the clicked entry stays current until the reader scrolls (wheel,
  keys, pointer, touch) or the view moves more than half a screen away.

### D-17: lazy page size estimate (severity 2)

- Actual: `contain-intrinsic-size` gave the whole page height to the content
  box, so each page not yet drawn was 192 px too tall (Letter, 1-inch
  margins). In Chromium, Home stopped 646 px short of the top.
- Fix: each lazy page's estimate is its own page size less its margins, from
  docx-preview's inline style. Estimates now equal the drawn size.

### D-18: page numbers (severity 1)

- Actual: every footer read "page 1": docx-preview shows a field's cached
  result and renders the same footer model on every page; the core also
  flattened simple PAGE fields into plain text.
- Fix: the core keeps PAGE, NUMPAGES, and SECTIONPAGES simple fields as
  complex fields with only the keyword; the reader marks their results and
  numbers each page after the pages exist. Section restarts
  (`w:pgNumType w:start`) are not applied (known gap).

### D-20 and D-21: accessibility findings (severity 2)

- axe-core 4.13.0 in Chromium (UI-07): `nested-interactive` (a focusable
  close button inside each `role="tab"`), `scrollable-region-focusable`
  (`#docScroller` had `tabindex="-1"`), and `color-contrast` (fallback
  label `#b45309` on the dark background, 4.0:1).
- Fix: the close control is for the pointer only (`aria-hidden`, not
  focusable; Delete and Ctrl+W close a tab, and the tab says so with
  `aria-keyshortcuts`); the document is in the Tab order; a `--warning-text`
  token is `#fbbf24` in the dark theme.

### D-22: a long document froze the page while it loaded (severity 2)

- Steps: open the generated 1,000-page report (P-04). A probe asks the web
  process for a trivial answer every 100 ms while the document loads.
- Actual: the longest web-process stall was 3,927 ms. All pages were
  attached to the document in one task, and a second full layout followed
  when the outline pane appeared and changed the fit zoom.
- Fix: documents over 60 pages are attached in batches (8 pages, then 20
  per frame) with a layout per batch; the outline pane is shown before the
  first batch, so the fit zoom is final; the outline is built from one
  paragraph index map instead of a search per entry.
- After: longest web stall 578 ms on the Linux host; in Chromium the longest
  task in the 1,000-page reader test stays under 800 ms (measured 96 to
  358 ms).

### D-23: the keyboard stopped reaching the page (severity 2)

- Steps: on Linux, open two documents and press Ctrl+Tab, then Tab or Page
  Down. Or press Tab from the document area, the last control.
- Actual: nothing happened until a click. Tab past the last control moved
  the focus out of the web view to the native window, which has nothing
  else to focus. On Linux, GTK also handles Ctrl+Tab itself and moved the
  focus to a hidden text view inside the web view.
- Fix: the reader wraps Tab and Shift+Tab around its controls; the Linux
  host watches the window's focus widget and gives the focus back to the
  web view unless a popover (the context menu) holds it.

### D-24: pictures missing on Linux (severity 1)

- Steps: open `images.docx` on the Linux host (found in the UI-01 contact
  sheet and the LibreOffice side-by-side).
- Actual: three empty grey frames. docx-preview serves each image as a
  `blob:` URL; the host registered `leandoc:` as a local scheme, and WebKit
  loads no `blob:` URL from a local origin (`naturalWidth` 0, `fetch` of the
  URL failed). Chromium, WebView2, and WKWebView were not affected.
- Fix: the scheme is registered as secure only. A local origin could also
  read `file:` URLs, which the reader never needs. The source policy test
  now forbids the local registration.

### D-25: focus ring on every new document (severity 3)

- Actual: after D-15 the reader focuses the document area after a render;
  WebKit and Chromium count focus given before any click as keyboard focus,
  so `:focus-visible` drew a 2 px blue frame round every new document.
- Fix: focus the reader gives itself carries a `quiet-focus` class that
  hides the ring until the document area loses the focus; Tab back to it
  shows the ring.

### D-26: Linux leak checks disagree between runs (severity 2, open)

- Checks: M-06 (open and close the 300-page report 30 times), M-07 (cycle
  ten tabs 50 times, then 50 view switches), M-08 (idle ten minutes).
- Actual, final revision 64535ea: in the session M-06 +20.1 percent (fail),
  M-07 10.0 MiB, M-08 -0.04 MiB; on the runner M-06 +3.2 percent, M-07
  83.8 MiB (fail), M-08 94.2 MiB (fail). Earlier runs: M-06 -14.9 and -13.2
  percent; M-07 7.9 MiB in the session and 23.8, 31.3, 35.6, 51.1, and
  66.7 MiB on runners; M-08 flat on most runs, +34 and +35 MiB on two.
- Analysis, web process: WebKit keeps a closed or re-rendered document's
  garbage until JavaScriptCore next collects, and an idle reader does not
  trigger a collection; the web process moved 66.8, 81.3, 69.6, 101.5 MiB
  over the session's M-06 samples. The reader holds none of it: in
  Chromium with forced collection, 160 view switches leave the JavaScript
  heap at 3.4 MiB (3.1 after the first 10) with a constant 314 DOM nodes
  and 65 listeners. On the Linux host the web process levels off over 200
  view switches (35, 44, 53, 58, 60 MiB after 2, 10, 26, 50, 100 switches,
  64 to 66 MiB after 100 to 200). A lower memory-pressure threshold (15
  percent of the limit) changed nothing. There is no WebKitGTK API to
  collect on demand.
- Analysis, UI process: on runner images where M-01 is near 192 MiB
  (150 MiB on the others, 149 MiB in the session) the UI process's main
  heap grows by live allocations: +75 MiB over the M-07 tab cycles, +94 MiB
  in minutes 2 to 4 of M-08 at 0.19 s of CPU in ten minutes. The heap trim
  of D-27 does not release it, and the session does not show it. The perf
  job runs `tests/perf/heap_profile.py` (heaptrack attached to the idle UI
  process) to name the allocation site.
- What closes it: the heaptrack result for the runner growth, then a fix or
  an attribution outside LeanDoc; for the web process, an owner decision
  that the leak checks gate on a rising trend (samples after 10, 20, and 30
  closes; after 50 and 200 view switches), which levels off here.

### D-27: freed heap kept by the Linux UI process (severity 2)

- Found while analysing D-26: the UI process's main heap held about 20 MiB
  that reading and sanitizing documents had freed; glibc keeps free pages
  below the top of the heap. On one runner image the UI process grew by
  25 MiB over the M-06 cycles this way.
- Fix: 3 s after a document is shown or its package dropped, the host calls
  `malloc_trim(0)` once (never on a timer while nothing happens). The UI
  process now stays at 98.5 MiB through M-06 to M-08 in the session (it was
  112 to 127 MiB). The memory harness samples after the trim.

## Known gaps

- PAGE fields ignore section page-number restarts.
- On Linux, `--test-script` exists only in the GTK host; the Windows and
  macOS layers run the launch scenarios and smoke subsets only.
- Window-visible time under Xvfb includes Mesa's software GL start-up
  (about 125 ms of the session medians, which ranged from 231 to 295 ms
  between runs on the same build); a desktop with a GPU does not pay it. An
  interleaved run of the build before this phase's changes and the final
  build gave 264 and 257 ms, so the spread is the session, not the code.
- LibreOffice side-by-side (UI-02) differences that remain: a theme colour
  with `w:themeShade` ("Accent 6, darker") shows the base accent; text box
  contents are drawn in the flow with tight line spacing where LibreOffice
  floats the boxes; tracked changes show as accepted (by design, named in
  the fidelity bar); not-displayed content (chart, SmartArt, shape) is
  omitted (by design, named in the fidelity bar).
- The Windows and macOS screenshots are CI artifacts, and artifact
  downloads are blocked in the test session, so they were reviewed through
  the capture check's statistics and text thumbnails in the job notices,
  not as images. A person still has to sign off the three contact sheets
  (UI-01).
- M-04 on the Windows runner is 294.1 MiB over M-01 against a 300 MiB
  budget: it passes with little margin.
