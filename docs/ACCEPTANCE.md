# Acceptance

LeanDoc separates the checks that gate a 0.1.x release from longer campaigns
that strengthen later releases. An unrun check is never described as a pass.

## Evidence rules

A runtime result records the source revision, command, fixture, operating
system and build, hardware, raw observation, and pass rule. Measurements use
LeanMark's terms: **private memory** is the private committed memory of the
complete process tree (LeanDoc plus every web runtime process it starts);
**first page** is the reader's `rendered` message for the first document.

## Required for a 0.1.x tag

| ID | Requirement | Evidence |
| --- | --- | --- |
| BUILD-01 | Windows x64, Linux x86-64, and macOS universal builds succeed with warnings as errors in the core. | `.github/workflows/build.yml` |
| CORE-01 | Core tests pass on all three operating systems: classification, limits, JSON shape, outline, sanitized package contents. | `tests/core/` via CTest |
| SEC-01 | Every security fixture in SPEC section 6 gives its expected result in the core; the reader makes no off-origin request for any of them. | `tests/core/`, `tests/reader/` |
| RENDER-01 | Every feature fixture renders with zero CSP violations, its expected text, and its expected structure (lists, tables, notes, headers, RTL direction). | `tests/reader/` |
| FIDELITY-01 | Not-displayed features and notices appear in the fidelity bar with correct counts and wording for each fixture. | `tests/reader/` |
| VIEW-01 | Page and reading views, zoom, outline navigation, find, tabs, theme cycle, fallback pages, and empty state with recent files work with the fake host. | `tests/reader/` |
| HOST-01 | `--smoke-test` renders a fixture in the real web runtime and exits 0 on Linux (WebKitGTK under Xvfb), Windows (WebView2), and macOS (WKWebView). | CI jobs |
| EDITOR-01 | Open-in-editor resolution order is implemented and unit-checked per platform; launching uses an argument vector. | host tests, review |
| PKG-01 | Each artifact contains exactly the allow-listed payload, has a `.sha256` sidecar, and the version is pinned across every file. | `scripts/Test-ReleaseEngineering.mjs`, package checks |
| INSTALL-01 | `install.ps1 -ValidateOnly` succeeds without changing files or the registry; install and uninstall contracts pass static checks. | `tests/Test-LeanDoc.ps1` |
| CORPUS-01 | leandoc-inspect runs over the fetched corpus without a crash or a hang over 10 s; unexpected error codes are listed. | `tests/corpus/` |
| DOCS-01 | README and site make no unmeasured claim, list known gaps, disclose unsigned builds, and use no banned word. | `site/validate.mjs`, review |

## Extended campaigns (not 0.1 gates)

| ID | Campaign | Claim boundary |
| --- | --- | --- |
| PERF-EXT | Owner-run `Measure-Performance.ps1` and `Compare-WithWord.ps1` on his laptop. | No memory, start-up, or Word comparison claim until the receipt exists. |
| FIDELITY-EXT | Person-scored rubric over the 30 documents in `docs/FIDELITY.md`. | No fidelity percentage until scored. |
| NET-EXT | Network observation on a clean Windows machine during open, view, and close. | No network statement beyond what the app's own code does. |
| FUZZ-EXT | Coverage-guided fuzzing of the core's ZIP and XML paths. | No fuzzing claim until a receipt exists. |
| A11Y-EXT | Screen reader pass on each platform. | Accessible names are not a certification. |

## Release decision

A 0.1.x tag requires every required item to pass or to carry a written
exception that narrows the release claim in the release notes.
