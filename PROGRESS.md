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

Order of work, one pull request each, tests committed before the change:

1. This plan, the efficiency review, and the peak working set and payload
   sizes in the Windows perf job, so every later pull request reports them.
2. Efficiency: find after a pause in typing.
3. Efficiency: one zoom layout per frame.
4. Efficiency: a view switch reuses the parsed document.
5. The Dim and Dusk themes (reader and the three hosts).
6. The theme button's dot and tooltip.
7. The settings button and panel with the shortcut list.
8. The toolbar and tabs restyle.
9. The page colour setting (reader and the three hosts).
10. The outline highlight look, after LeanMark's highlight is merged.
11. The 0.2.0 version bump, the annotated tag v0.2.0, the Store package
    workflow for the tag, and the post-release pull request.

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
Windows figures come from the perf-memory (Windows) CI job; they are added
when that job has run on this plan's pull request. Every figure is a test
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
| Open | Five scripts and seven fonts load on every launch | P-01 265 ms, P-02 659 ms, P-03 1,438 ms, P-04 3,363 ms (WebKitGTK, 5 launches). Scripts: reader.js 128,543 bytes, fixups.js 72,007, jszip 97,781, docx-preview 75,527; fonts 195 KiB | None: every file is used | Keep |
| Memory | Private dirty memory of the whole process tree | M-01 148.7 MiB, M-02 +12.5, M-03 +89.0, M-04 +208.0 MiB (WebKitGTK, 5 launches) | None found beyond the rows above | Keep |
| Dead code | No unused function in reader.js, fixups.js or fidelity.js. `host.editorKind` is stored and never read; the `--warning-50` token is unused | A few bytes | Remove when the code around them changes | Keep |
| Dependencies | Runtime: four IBM Plex font packages, docx-preview 0.4.1, JSZip 3.10.2; development: axe-core and playwright-core for tests | All used | None | Keep |
| Package size | v0.1.4 release assets | Windows ZIP 960,398 bytes, Linux .deb 613,946, macOS ZIP 798,194. LeanDoc.exe: from CI, added by this plan's pull request | None | Keep |

Not measured here: Windows and macOS timings and memory in this session
(no Windows or macOS machine; they come from CI), and the owner's laptop
figures (`tests/owner/`).

## Notes for the LeanDoc Android port

Filled in as each pull request merges: the files and settings keys that the
themes, the page colour setting and the highlight look touch.

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
