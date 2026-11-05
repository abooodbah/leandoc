# Progress

Updated: 2026-11-05

## LeanDoc 0.2.0: plan

LeanMark desktop 0.6.0 is the design reference for this round. The owner's
scope for LeanDoc desktop 0.2.0:

- The Dim and Dusk themes, so LeanDoc has LeanMark's five (System, Light,
  Dark, Dim, Dusk) with LeanMark's colour values. Windows high contrast keeps
  system colours.
- The theme button with a coloured dot for the current theme and a tooltip
  that names it.
- A settings button and panel: theme, zoom, view, and the list of every
  keyboard shortcut. Ctrl+/ or F1 opens it, Escape closes it.
- The toolbar and tabs restyled to LeanMark's layout, icons and spacing.
- The current section in the outline styled like LeanMark's, in every theme.
  LeanDoc keeps its own highlight behaviour; only the look changes.
- A page colour setting: keep the page white like paper (the default, as in
  0.1), or follow the theme. Remembered between runs.
- The efficiency review below, and its clear wins as their own pull requests.

Order of work, one pull request each, tests committed before the change.
Each pull request updates its own item below when it merges.

- Plan, efficiency review, and the peak working set and payload sizes in
  the Windows perf job: #22, merged.

- Efficiency: find after a pause in typing: #23, merged. Typing "survey"
  at 100 ms a key in the 300-page report (WebKitGTK): the page was held up to
  103 ms after a key (441 ms on main), the six keys took 604 ms (1,510), and
  the search work inside the key handlers fell from 176 to 6 ms.

- Efficiency: one zoom layout per frame: #24, merged. Three zoom steps in one
  task in the 300-page report (WebKitGTK): 314 ms to the next painted frame
  (820 ms on main); one step 330 ms (348), with 1 ms inside the handler
  (268).

- Bug: the outline's current section after a long jump (found by the
  LeanDoc Android port): #25, merged. The current section is found again
  120 ms after the last scroll event. Scroll frames unchanged: p95 16.7 ms on
  this branch, 16.7 to 16.8 ms on main (Chromium). The Android port can take
  `scheduleOutlineSettle` in assets/reader.js.

- Efficiency: a view switch reuses the parsed document: #26, merged. After
  the first switch to each view, the 300-page report switches to reading
  view in 551 ms (921 on main) and back in 837 ms (963) (WebKitGTK). An
  opened document keeps nothing extra; after switching, the two kept copies
  cost about 10 MiB for 1,000 pages (402.0 against 391.9 MiB).

- The Dim and Dusk themes (reader and the three hosts): #27, merged. All
  five themes resolve to LeanMark 0.6.0's colour tokens (checked token by
  token in the reader tests); Dark's border moved to LeanMark's #2b2924.
  The 16 chrome states in Dim and Dusk have no serious axe finding.

- The theme button's dot and tooltip: #28, merged. LeanMark's dot colours
  (white, black, #7f8a99, #c98f4f, half and half for System) with the same
  grey ring; the tooltip and accessible name say "System (Dark)" or the
  theme's name.

- The settings button and panel with the shortcut list: #29, merged. The
  panel holds the theme, the view, the zoom (in, out, fit width, reset) and
  every keyboard shortcut, built from the tables the key handlers use.
  Ctrl+/ or F1 opens it, Escape closes it.

- The toolbar and tabs restyle: #30, merged. LeanMark's 56 px bar, 40 px
  controls with 16 px sides, the find box without an icon, 1.6 px icons,
  and LeanMark's tab hover. Below 760 px the wordmark, file details and
  theme button hide, as in LeanMark.

- The page colour setting (reader and the three hosts): #31, merged. Paper
  pages draw every colour exactly as 0.1.4 did (recorded per fixture in
  tests/reader/paper-colors.json). A page that follows a dark theme takes
  the theme's canvas and text colours, and every text the test documents
  draw stays at 4.5:1 or more.

- The outline highlight look, after LeanMark's highlight is merged: #32,
  merged. The current entry takes LeanMark's look in all five themes (checked
  against LeanMark's merged reader.css). The weight no longer changes, so a
  new current section repaints one entry without a layout.

- The 0.2.0 version bump, the annotated tag v0.2.0, the Store package
  workflow for the tag, and the post-release pull request: planned.

Decisions taken here (the owner can change them):

- Zoom stays per session, as in 0.1. LeanDoc has fit width and automatic
  zoom, which follow the window; a remembered fixed zoom would not.
- Text width does not apply: pages keep the document's own width. The panel
  has the view (Page or Reading) instead.
- Settings keys for the new choices: `Theme` takes `system`, `light`,
  `dark`, `dim` or `dusk`; a new `PageColor` key takes `paper` (default) or
  `theme`. Windows `HKCU\Software\LeanDoc`, Linux
  `$XDG_CONFIG_HOME/leandoc/settings.ini` group `[Reader]`, macOS
  `NSUserDefaults` (`LeanDocTheme`, `LeanDocPageColor`).

## Efficiency review (0.2.0)

Method. Release builds. Linux figures are from the GTK 4 and WebKitGTK 6.0
host in this session (Intel Xeon at 2.10 GHz, 4 logical processors,
15.7 GiB, Ubuntu 24.04, WebKitGTK 2.52.6 under Xvfb), driven by
`tests/perf/run_perf.py` and small probes over its `--test-script` hook,
median of 5 to 10 runs. Chromium figures are the reader in headless
Chromium 153 with the fake host. The document is the generated 300-page
report (`tests/perf/make_report.py`, report-300.docx) unless named.
Windows figures come from the perf-memory (Windows) CI job on this plan's
pull request, which changed no product code (GitHub windows-latest, AMD EPYC
7763, 4 logical processors, 16 GiB, WebView2 156.0.4314.58, median of 10
launches, private bytes of the whole process tree). Every figure is a test
figure, not a product claim.

| Place | What it costs | Measured | Proposed fix | Decision |
| --- | --- | --- | --- | --- |
| Find, `assets/reader.js` input handler | Every key runs a full search: a walk over the whole document's text and a repaint of every match | Typing "survey" at 100 ms a key: the page was held up to 441 ms after a key, the six keys took 1,510 ms instead of 600, and the last count came 1,525 ms after the first key (WebKitGTK). Chromium: 141 ms of search work while typing | Search 120 ms after the last key, as LeanMark does; Enter and F3 search at once | Fix (pull request 2) |
| Zoom, `applyZoom` | Each step sets CSS zoom and reads the scroll height at once, which lays out the whole document inside the click or key handler. Steps that come together (Ctrl+wheel, a held key) each lay it out | One step 182 to 210 ms (P-11 210 ms), three steps in one frame 446 to 501 ms (WebKitGTK). Chromium: one step 85 ms, three 252 ms | Apply the zoom once per animation frame, so steps that arrive together cost one layout | Fix (pull request 3) |
| Zoom, one step | CSS zoom lays out every page that is not lazy (pages with list numbering are never lazy) | As above: one layout of 182 to 210 ms per step | Scale page view with a transform instead of CSS zoom, which needs no layout; changes how text is drawn when zoomed | For the owner |
| View switch, `setView` and `renderPackage` | Each switch unzips and parses the whole package again and reruns the model fixes before it renders | Page to reading 890 to 929 ms, reading to page 904 to 951 ms (P-08 945 ms); the parse alone 186 to 383 ms (WebKitGTK). Chromium: 513 ms, parse 125 to 145 ms and model fixes 49 ms | Keep the parsed and fixed document of each view while the document is open, and render from a copy of its body; a switch back to a view skips the parse | Fix (pull request 4), memory cost measured there |
| Reading view, `matchWordLines` | Word's line heights are matched over the whole document at once in reading view; page view does it page by page as pages come near the window | 323 ms of a 788 ms profiled switch to reading view (Chromium, sampling profiler on) | Match lazily in reading view too, by blocks near the window | For the owner: lines would settle while scrolling |
| Theme switch, `applyTheme` | Changing `data-theme` on the root restyles every element of the document, though the page keeps paper colours | 264 ms median, 16 to 479 ms (WebKitGTK, 9 switches) | None now: with the page colour set to follow the theme the page must restyle | Keep |
| Tab switch | A background tab keeps no package or DOM, so selecting it reads and lays out the file again | P-07 875 ms (WebKitGTK) | Keep: it is what keeps five tabs within M-05 | Keep |
| Scroll | Outline update once per frame; `matchPagesNearWindow` runs on every scroll event and copies its list of waiting pages each time | P-10 p95 frame 70 ms (WebKitGTK under Xvfb, software rendering); 0.1.0 recorded 16.7 ms p95 in Chromium | Run it once per frame | For the owner: small; no frame budget is missed in Chromium |
| Open | Five scripts and seven fonts load on every launch | P-01 265 ms, P-02 659 ms, P-03 1,438 ms, P-04 3,363 ms (WebKitGTK, 5 launches). Windows: P-01 52 ms, P-02 598 ms, P-03 1,114.5 ms, P-04 2,418.5 ms, P-06 44.4 ms. Scripts: reader.js 128,543 bytes, fixups.js 72,007, jszip 97,781, docx-preview 75,527; fonts 195 KiB | None: every file is used | Keep |
| Memory | Private memory of the whole process tree | Linux private dirty: M-01 148.7 MiB, M-02 +12.5, M-03 +89.0, M-04 +208.0 MiB (5 launches). Windows private bytes: M-01 90.6 MiB, M-02 +16.1, M-03 +98.4, M-04 +294.7 (budget +300), M-05 107.7. Windows peak working set of the tree: empty 283 MiB, 3 pages 322.5, 300 pages 419.7, 1,000 pages 630.8 | None found beyond the rows above. M-04 on Windows has 5.3 MiB to spare, so no change may keep more per document | Keep |
| Dead code | No unused function in reader.js, fixups.js or fidelity.js. `host.editorKind` is stored and never read; the `--warning-50` token is unused | A few bytes | Remove when the code around them changes | Keep |
| Dependencies | Runtime: four IBM Plex font packages, docx-preview 0.4.1, JSZip 3.10.2; development: axe-core and playwright-core for tests | All used | None | Keep |
| Package size | v0.1.4 release assets, and the Windows payload of this plan's CI build | Windows ZIP 960,398 bytes, Linux .deb 613,946, macOS ZIP 798,194. LeanDoc.exe 581,120 bytes, WebView2Loader.dll 164,192, leandoc-inspect.exe 517,120, reader assets 612,793 | None | Keep |

Not measured here: Windows and macOS timings and memory in this session
(no Windows or macOS machine; they come from CI), and the owner's laptop
figures (`tests/owner/`).

## Notes for the LeanDoc Android port

Filled in as each pull request merges: the files and settings keys that the
themes, the page colour setting and the highlight look touch.

- Themes (#27). `assets/reader.css`: the `:root[data-theme="dim"]` and
  `:root[data-theme="dusk"]` blocks (LeanMark's tokens plus LeanDoc's own:
  `--surface-hover`, `--border-strong`, `--doc-canvas`, the notice tokens and
  the wordmark), placed after the system-dark block so they win on a dark
  system; Dark's `--border` is `var(--neutral-800)`. `assets/reader.js`:
  `THEMES`, `applyTheme`, `cycleTheme` (System, Light, Dark, Dim, Dusk).
  `src/core/ReaderSettings.h`: theme names, order, dark frame, and window
  canvas colours. Settings key: `Theme` takes `system`, `light`, `dark`,
  `dim`, or `dusk`; anything else reads as `system`.

- Page colour (#31). Settings key `PageColor` (`LeanDocPageColor` on
  macOS): `paper` (default) or `theme`; anything else reads as `paper`.
  Host to reader: the `theme` message carries `pageColor`; reader to
  host: `setPageColor` {`pageColor`}. `assets/fixups.js`: `colorPalette`
  routes every document colour through `var(--ldc-N, colour)`, and
  `darkPageColor` maps a colour onto a dark page (OKLab, 4.5:1 for text).
  `assets/reader.js`: `applyPageColor`, `updatePageColorStyle` (sets
  `--ld-paper`, `--ld-ink` and the `--ldc-N` values on `#docBody`).
  `assets/reader.css`: the page uses `var(--ld-paper, #ffffff)` and
  `var(--ld-ink, #000000)`, and LeanMark's `--find`, `--find-current` and
  `--find-text` tokens on such a page.

- Highlight look (#32). `assets/reader.css` only:
  `.outline-list a[aria-current="location"]` takes
  `background: var(--surface-muted)`,
  `box-shadow: inset 2px 0 0 var(--link)` and
  `color: var(--text-primary)`, with no font weight change; entries have
  `padding: 5px 8px 5px 12px` and 4 px corners; levels 2, 3 and 4 or
  deeper have 28, 44 and 60 px on the left; the outline label lines up with
  the entries' text. Forced colours underline the current entry. The
  behaviour (aria-current, kept in view, the settle pass of #25) does not
  change.

## Done before 0.2.0

- 0.1.0 to 0.1.4 published. The records are in
  [docs/VALIDATION_STATUS.md](docs/VALIDATION_STATUS.md),
  [CHANGELOG.md](CHANGELOG.md) and [docs/releases/](docs/releases/).

## Remaining

- Everything in the 0.2.0 plan above.
- Owner-run measurements: `tests/owner/Measure-Performance.ps1` and
  `Compare-WithWord.ps1`; UI-01 contact sheet sign-off; the person-scored
  fidelity rubric (docs/FIDELITY.md).
- The later items in ROADMAP.md.

## Known gaps

- D-26: the Linux leak checks M-06 to M-08 stay advisory on the shared CI
  runner (docs/TEST_REPORT.md).

## Owner actions

- Remove the footer line "Generated by Claude Code" from the descriptions of
  pull requests abooodbah/leandoc#1, #2, and #3, abooodbah/leanmark#11, and
  abooodbah/leanrows#11 (edit each description on GitHub and delete the last
  two lines). The build session's GitHub proxy adds it to every pull request
  description sent through it, and an edit from the session gets it added
  again. No commit, tag, or release carries it.
- Scoop, winget, Chocolatey, the Microsoft Store submission and the install
  on the owner's PC follow each release, from the owner's PC.
