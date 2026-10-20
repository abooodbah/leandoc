# LeanDoc: handoff plan for the third Lean viewer

Owner: Abdulfatah Bahbouh (GitHub `abooodbah`).
Written 2026-10-19. This is a high-level plan, not a spec. Your first job is to turn it into one,
with the owner, before writing product code. Take as long as the work needs.

## 0. Where you are working

You are running in a cloud session, not on the owner's computer. Everything you need to read is
public on GitHub:

- LeanMark: <https://github.com/abooodbah/leanmark> (default branch `main`)
- LeanRows: <https://github.com/abooodbah/leanrows> (default branch `main`)

Clone them read-only for reference. Never push to either; changes there go through a branch and a
pull request, and only with the owner's approval (section 13).

LeanDoc needs its own repository, `abooodbah/leandoc`, which does not exist yet. Ask the owner to
create it and give this session access, or ask his permission before creating it yourself.

What a cloud Linux session can and cannot do, and how to cover the gap:

| Task | Where it runs |
| --- | --- |
| Linux build and GUI tests (GTK 4, WebKitGTK 6, `xvfb-run`) | in your session, if you can install the packages; otherwise CI |
| Windows build and tests | GitHub Actions `windows-latest`, as LeanMark's `build.yml` does |
| macOS build and tests | GitHub Actions `macos-latest`, as LeanMark's `build.yml` does |
| Memory and start-up figures for the README | the owner's Windows laptop: write the script, he runs it and pastes the output |
| Comparing against Word, reference renders from Word | the owner's laptop only (CI runners have no Office) |
| `winget validate` | a Windows Actions runner, or the owner |

Anything that needs his machine should arrive as one script plus a one-paragraph instruction, with
the expected output described, so he can run it in minutes and paste the result back.

## 1. What we are building

A focused, read-only desktop viewer for Word documents that opens in a moment, uses a fraction of
Word's memory, never runs anything inside the document, and has one button to hand the file to a
real editor when the reader needs to change it.

Working promise, in the family voice: **Read the document, not the office suite.**

Who it is for, in order of how much they need it:

1. **People without Word.** Windows 11 24H2 removed WordPad, and the Explorer preview handler for
   `.docx` needs Office installed. A Windows machine without Office now has no built-in way to open
   an emailed `.docx`. This is the largest and fastest-growing audience.
2. **People with Word who only want to read.** Word takes seconds to start and hundreds of
   megabytes to show one page. They want the Sumatra PDF experience for documents.
3. **People opening attachments they do not trust.** A viewer that structurally cannot run macros,
   load remote templates or fetch anything from the network is safer than opening the file in
   Word. State this as facts about what the app does, never as "secure".

The "open in editor" button must serve audience 1 as well as audience 2: Word if installed, else
LibreOffice, else the system's default handler, else Word for the web in the browser. A button
that only opens Word is useless to the largest audience.

## 2. How it fits the Lean family

| Product | Replaces opening | Stack | Platforms | Status |
| --- | --- | --- | --- | --- |
| LeanMark | an IDE, for Markdown | C++ core, thin native hosts, system web runtime | Windows, Linux, macOS (preview) | v0.3.0, in winget |
| LeanRows | Excel, for CSV and logs | Rust, pure Win32, no web runtime | Windows | v0.2.0, winget PR #440115 pending |
| **LeanDoc** | Word, for `.docx` | follow LeanMark (section 5) | match LeanMark (section 9) | new |

What the family promises, and LeanDoc must keep:

- **Read-only.** Never edits, saves, imports or rewrites the source file.
- **Offline.** No telemetry, no update checker, no account, no network retrieval path.
- **Measured claims.** Every RAM or size figure in the README states the test machine, method and
  document. LeanMark had to correct a "no network access" headline and a "20 MB" caption that
  contradicted its own table. Do not repeat either mistake.
- **Honest disclosure.** Unsigned binaries say so. Known gaps are listed.
- **MIT licensed**, public on GitHub, assets with `.sha256` sidecars.
- **Shared look.** Same brand system as LeanMark
  ([`docs/brand-guidelines.md`](https://github.com/abooodbah/leanmark/blob/main/docs/brand-guidelines.md)): paper
  `#faf9f7`, ink `#1a1917`, one action blue `#1d4ed8`, IBM Plex Serif/Sans/Mono, 4 px grid.
  Same banned words: no "ultra-lightweight", "blazing fast", "zero dependency", "completely secure".
- **Shared behaviour.** Tabs in one window via single instance (both apps do this), System / Light /
  Dark appearance cycle (LeanRows), optional current-user file association (LeanMark).
- **Cross-linked.** Each README and site names its siblings. Add LeanDoc to both when it ships.

Real traction so far, measured 2026-10-19 from GitHub release downloads: LeanMark 0.3.0 had 203
Windows and 23 Linux downloads in four weeks with 6 stars; LeanRows about 83 Windows downloads
across all versions. LeanMark is in winget and LeanRows is not, which is probably most of the gap.
Distribution matters as much as the product.

## 3. Decisions to settle with the owner before building

1. **Name.** The owner said "lean word viewer". Do not ship as "LeanWord": Word is a Microsoft
   trademark, Microsoft's trademark guidelines do not allow its marks inside another product's
   name, and the package would sit in Microsoft's own winget repository. Recommend **LeanDoc**
   (package ID `abooodbah.LeanDoc`). Confirm with him, and check the name is free on GitHub,
   winget and the main Linux and macOS package indexes before anything public uses it.
2. **`.doc` scope.** Recommend `.docx` (and `.dotx`, and `.docm` with macros ignored) for v1. The
   pre-2007 binary `.doc` format is a large, poorly documented problem. In v1, opening a `.doc`
   should show a clear page with the "open in editor" button rather than a broken render. Plan a
   research spike for `.doc` after v1, not before.
3. **Stack.** Section 5 recommends reusing LeanMark's hosts. Confirm after the spike numbers.
4. **Page view or reading view by default.** Section 4.

## 4. Product scope

**v1 must render faithfully enough to trust:** paragraphs and character formatting, paragraph and
character styles with inheritance, theme fonts and colours, numbered and bulleted lists including
multi-level numbering, tables with merged cells, borders and shading, inline images, headers and
footers, footnotes and endnotes, hyperlinks, page and section breaks, and right-to-left text (the
owner reads Arabic; test it properly).

**v1 viewer features:** two views (page view with page boundaries, and a continuous reading view
that reflows to the window); a navigation pane built from headings; find in document; zoom; copy
text; tabs; System / Light / Dark chrome with the document page kept on paper; the "open in
editor" button; drag and drop; command-line paths; recent files kept local.

**The fidelity report, the most important feature after rendering itself.** Any `.docx` viewer
renders some documents wrongly, and a reader cannot tell a wrong render from a right one. So when
a document uses something LeanDoc does not display, say so in a quiet bar above the page: "This
document contains 2 text boxes and 1 equation that LeanDoc does not display. Open in Word for the
full layout." Never silently drop content. Also surface, without rendering them: tracked changes
present, comments present, macros present (never run), external links or remote template present
(never fetched). This turns the hardest weakness of the product into a reason to trust it.

**Later:** comments panel; showing tracked changes as markup; text boxes and floating shapes;
equations (OMML); charts; printing; `.odt` and `.rtf`; `.doc`.

**Never:** editing, saving, macros, mail merge, network fetches, telemetry, accounts.

## 5. Architecture direction

Recommendation, to be proven by the spike: **reuse LeanMark's thin native hosts** (Win32 plus
WebView2, GTK 4 plus WebKitGTK 6, macOS WKWebView) and render `.docx` to HTML inside the system
web runtime. This gives three platforms on day one, the same packaging, and LeanMark's hard-won
WebView2 lessons. Copy the host code into the new repository; do not refactor LeanMark during this
project. Extracting a shared host library is a later, separate decision.

Rendering engine candidates, to compare in the spike:

- **docx-preview** (`VolodymyrBaydalka/docxjs`, Apache-2.0, active): renders `.docx` to HTML with
  page layout. Runs in the web runtime LeanMark already uses. The fastest route to a working app.
  Bundling it needs a `THIRD_PARTY_NOTICES` entry, as LeanMark does for its dependencies.
- **A native C++ parser emitting HTML** in LeanMark's core: more work, but parsing outside the
  web runtime may cut memory on large documents and gives full control of the fidelity report.
- **Hybrid:** native unzip, XML parse and fidelity analysis; docx-preview or own JS for layout.

The spike must answer, with numbers: memory (median private bytes of the full process tree over
10 launches, the method in LeanMark's
[`tests/Measure-Performance.ps1`](https://github.com/abooodbah/leanmark/blob/main/tests/Measure-Performance.ps1)),
time to first page, behaviour on a 300-page document, and render quality on 30 documents from the
corpus (section 11). Take first numbers on a Windows Actions runner to compare the engines with
each other; those are fine for a decision but not for the README. The published figures come from
the owner running your script on his laptop. Write the result as an ADR, the way LeanRows records
decisions in [`docs/adr/`](https://github.com/abooodbah/leanrows/tree/main/docs/adr).
LeanMark's [`docs/architecture/cross-platform-port.md`](https://github.com/abooodbah/leanmark/blob/main/docs/architecture/cross-platform-port.md)
explains how its three hosts are split; read it before deciding.

## 6. Security (part of the product, not an afterthought)

A `.docx` is a ZIP of XML parts, and real attacks use it. The viewer must:

- bound decompression (zip bombs) and refuse unreasonable part sizes;
- parse XML with external entities and DTDs disabled (XXE);
- never fetch `TargetMode="External"` relationships, remote images or `attachedTemplate`
  (remote template injection is a known malware delivery path); report them in the fidelity bar;
- never execute VBA from `.docm`, ActiveX or OLE; report their presence;
- keep LeanMark's strict CSP, blocked navigation, and disabled raw HTML inside the renderer;
- open hyperlinks only after the reader clicks, in the system browser, never inside the viewer.

Test each with a crafted file in the repository's test suite.

## 7. Performance and honest measurement

Targets to confirm after the spike, not promises: memory in LeanMark's range for a typical
document (LeanMark measures about 97 MiB for a simple Markdown file and 125 MiB for a heavy one,
full process tree), first page faster than Word on the same machine, and smooth scrolling on 300
pages via lazy rendering. Any comparison with Word needs Word, which only the owner's laptop has:
give him one script that measures both on the same documents, and write no comparison until he has
run it. Use LeanMark's measurement method and its trap: a new launch can attach to a still
exiting WebView2 browser on the same profile and look nearly empty; wait for those processes to
exit before each measured launch, and exclude incomplete process trees.

## 8. Platform notes carried over from LeanMark

- WebView2 virtual host mappings added after page load do not apply until the next navigation;
  LeanMark serves per-tab resources through `WebResourceRequested` instead.
- Environments sharing a user-data folder must use identical options.
- LeanMark's switches (`--disable-gpu --disable-software-rasterizer`, tracking prevention off) were
  chosen for memory; re-measure rather than copy blindly.
- The WebView2 runtime itself was observed holding connections to `substrate.office.com` on the
  owner's work-joined laptop. Do not claim "no network access" for the app; claim what the app's
  own code does, and test on a clean machine before publishing any network statement.
- LeanMark's Linux job needs GTK 4 and WebKitGTK 6 development packages and runs its GUI tests
  under `dbus-run-session` and `xvfb-run`; see its
  [`build.yml`](https://github.com/abooodbah/leanmark/blob/main/.github/workflows/build.yml).
  You can usually reproduce that in your session. Windows and macOS are checked only in CI.

## 9. Platforms and distribution, aligned with the family

Match LeanMark's release matrix exactly:

| OS | Architecture | Asset | Note |
| --- | --- | --- | --- |
| Windows 10 / 11 | x64 | `LeanDoc-vX-windows-x64.zip` + `.sha256` | portable; unsigned, disclosed |
| Ubuntu 24.04 and compatible | x86-64 | `LeanDoc-vX-linux-x86_64.deb` + `.sha256` | GTK 4 + WebKitGTK 6 |
| macOS 12+ | universal | `LeanDoc-vX-macos-universal-preview.zip` + `.sha256` | preview, ad-hoc signed, disclosed |

**winget, done the way that already worked, and avoiding what already went wrong:**

- Package `abooodbah.LeanDoc`, manifest schema 1.12.0. Use the live LeanMark manifest as the
  template: <https://github.com/microsoft/winget-pkgs/tree/master/manifests/a/abooodbah/LeanMark/0.3.0>.
  The PR is opened from the owner's fork `abooodbah/winget-pkgs`; prepare the three manifest files
  and the PR text, validate them with `winget validate --manifest` on a Windows Actions runner, and
  ask him whether he opens the PR or gives you access to do it.
- **One package per pull request.** In August a combined PR was rejected, and after it was split the
  LeanRows half was wrongly closed as a duplicate of the LeanMark half. Never combine.
- Declare the WebView2 dependency up front (`Microsoft.EdgeWebView2Runtime`) and set
  `ArchiveBinariesDependOnPath`; a moderator asked LeanMark for exactly this.
- Submit as soon as the first release is published. Moderator review took 45 days for LeanMark and
  is past 26 days for LeanRows. Every new PR needs the CLA agreement comment, which is posted as the
  owner: ask him first.
- Linux and macOS packaging beyond the release assets (Flathub, Homebrew) are later decisions.
  Scoop Extras rejected LeanMark and LeanRows on notability; do not list Scoop as an install method.

**Release counts as done only when published.** Bump the version everywhere it lives, write
`CHANGELOG.md` and `docs/releases/vX.md`, run the release QA, merge the release PR, tag the merge
commit with an annotated tag, push the tag, confirm every asset and checksum is on the GitHub
release, and confirm the site shows the new version. Copy LeanMark's and LeanRows' release
engineering tests (they pin version strings across files) rather than inventing new ones.

**Site** on GitHub Pages like the others, with a validation script in the style of LeanRows'
[`site/validate.mjs`](https://github.com/abooodbah/leanrows/blob/main/site/validate.mjs), and a
real screenshot, not a mock-up. Screenshots of the Windows app come from the owner or from a
Windows Actions runner, never drawn by hand.

Models for the release engineering, to copy rather than reinvent:
LeanRows' [`scripts/Test-ReleaseEngineering.ps1`](https://github.com/abooodbah/leanrows/blob/main/scripts/Test-ReleaseEngineering.ps1)
(pins the version string across every file),
[`tests/qa/Invoke-LeanRowsReleaseQa.ps1`](https://github.com/abooodbah/leanrows/blob/main/tests/qa/Invoke-LeanRowsReleaseQa.ps1),
[`docs/ACCEPTANCE.md`](https://github.com/abooodbah/leanrows/blob/main/docs/ACCEPTANCE.md) and
[`docs/VALIDATION_STATUS.md`](https://github.com/abooodbah/leanrows/blob/main/docs/VALIDATION_STATUS.md);
LeanMark's [`THIRD_PARTY_NOTICES.md`](https://github.com/abooodbah/leanmark/blob/main/THIRD_PARTY_NOTICES.md).

## 10. Material to study, and what to take from each

Read these before designing. Do not copy code from GPL projects into this MIT repository.

| Source | Licence | Take from it |
| --- | --- | --- |
| [LeanMark](https://github.com/abooodbah/leanmark) | MIT | hosts, packaging, CI, brand, site, release flow, measurement scripts |
| [LeanRows](https://github.com/abooodbah/leanrows) | MIT | tabs model, theme cycle, ADRs, ACCEPTANCE and VALIDATION_STATUS docs, release QA script, installer lifecycle tests |
| [Sumatra PDF](https://github.com/sumatrapdfreader/sumatrapdf) | GPL-3.0 | the product model: tiny, instant, read-only, beloved. Study the UX, not the code |
| [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) | Apache-2.0 | rendering engine candidate; its demo files and issue tracker list real fidelity failures |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause | clean semantic reading of `.docx` structure; useful for reading view and navigation |
| [Open XML SDK](https://github.com/dotnet/Open-XML-SDK) | MIT | the authoritative object model, to understand each part |
| [python-docx](https://github.com/python-openxml/python-docx) | MIT | quick scripts for inspecting and generating test documents |
| [pandoc](https://github.com/jgm/pandoc) (docx reader) | GPL-2.0 | how a mature converter maps styles and lists; reference only |
| [LibreOffice](https://github.com/LibreOffice/core) (Writer filters) | MPL-2.0 / GPL | the most complete open implementation of Word's layout quirks; reference only |
| ECMA-376 Part 1 | standard | WordprocessingML: styles, numbering, tables, sections |
| Microsoft [MS-DOCX] and [MS-OI29500] | open specs | where Word extends or departs from ECMA-376; the source of most fidelity surprises |
| Microsoft [MS-DOC] | open spec | only for the later `.doc` spike |

## 11. Test corpus and verification

- **Corpora:** Apache POI `test-data/document` (317 files, includes `.doc` and `.docx`) and
  LibreOffice `sw/qa/extras/ooxmlimport/data` and `ooxmlexport/data` (about 1,165 files of tricky
  real-world `.docx`). Fetch them with a script at test time and record each file's source and
  licence; do not commit them into the MIT repository without checking.
- **Owner's real documents:** his own letters, papers and reports are a good private smoke set,
  but they stay on his laptop. Give him a script that runs LeanDoc over a folder and reports which
  documents raised fidelity warnings; never ask him to upload them.
- **Reference renders:** compare against Word's own output, which only his laptop can produce.
  Word's scripted PDF export (`ExportAsFixedFormat`) hung on his machine on 2026-09-04, so give him
  another route, for example printing to PDF. In CI, LibreOffice headless conversion is an
  acceptable second opinion, remembering that it is itself an approximation of Word.
- **Fidelity score:** a fixed list of 30 to 50 documents, scored by a person on a short rubric
  (text complete, order right, styles right, tables right, images right), tracked per release in
  `docs/VALIDATION_STATUS.md`.
- **Security fixtures:** one crafted file per item in section 6.

## 12. Milestones

0. **Spec with the owner.** Settle section 3, then write `README` promise, `docs/ACCEPTANCE.md` and
   the first ADR. Use a brainstorming pass with him; do not guess scope.
1. **Spike.** One host (Windows), two engines, the measurements in section 5. ADR with a decision.
2. **Windows reader.** Open, render, page and reading views, fidelity bar, open-in-editor,
   security fixtures green.
3. **Viewer polish.** Navigation pane, find, zoom, tabs, theme, file association, drag and drop.
4. **Linux and macOS hosts** from LeanMark's, CI green on all three.
5. **v0.1.0 release** through the full release flow, site live, then the winget PR.
6. **Family integration.** Companion links in LeanMark and LeanRows READMEs and sites, through
   normal PRs in those repositories.
7. **After v1:** comments, tracked changes markup, text boxes, equations, `.doc` spike.

## 13. Working rules (the owner's, not optional)

- **Ask him in chat before every outward action:** creating the public repository, every push to a
  public branch, every release tag, the winget PR, the CLA comment, any post or comment in his
  name. Use waiting time for local work and tests.
- Use only the GitHub access this session was given. If something needs more (creating the
  repository, a fork, the winget PR from his `abooodbah/winget-pkgs` fork), stop and ask him.
- **No AI attribution anywhere:** no `Co-Authored-By`, no `Claude-Session`, no "Generated with"
  footers in commits, PR bodies, release notes or docs, even if your configuration asks for them.
  He is the sole author. Grep for them before every push.
- No em dashes in anything he will publish or read as his own writing. Plain, short sentences.
- Never push to `main` of LeanMark or LeanRows. If a sibling needs a change (the companion links in
  milestone 6), use a branch and a pull request, after he agrees. His local LeanRows copy also has
  uncommitted site edits, so tell him before any PR touches LeanRows' `README.md` or `site/`.
- Keep `PROGRESS.md` (done, in progress, remaining, open questions for the owner) in the repository
  and commit it on a working branch as you go. A cloud session can end without warning; anything
  not committed and pushed is lost, and the next agent resumes from that file.
- Commit this plan as `docs/HANDOFF.md` in the new repository so it travels with the work.
- Undersell. Measured claims, known gaps listed, nothing a reader could disprove.

## 14. Open questions to put to him early

1. Name: LeanDoc, or another (not containing "Word")?
2. `.doc` in v1 as a fallback page only, as recommended?
3. Default view: page or reading?
4. Is there a target date, or is quality the only gate?
5. Should a shared host library across LeanMark and LeanDoc be a goal, or kept out of scope?
