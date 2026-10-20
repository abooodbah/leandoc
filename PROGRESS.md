# Progress

Updated: 2026-10-20

## Done

- Repository `abooodbah/leandoc` created by the owner (public).
- Owner decisions recorded in [docs/SPEC.md](docs/SPEC.md) section 1: name LeanDoc,
  page view default, `.doc` as a fallback page, shared host library out of scope.
- Engine spike on Linux headless Chromium and
  [ADR 0001](docs/adr/0001-rendering-engine.md): hybrid core + docx-preview.
- [SPEC.md](docs/SPEC.md), [EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md),
  [ACCEPTANCE.md](docs/ACCEPTANCE.md), and the core contract
  [src/core/DocCore.h](src/core/DocCore.h).

- Stream A (core) done and merged into `integrate/v0.1`: 9,723 core checks,
  50-file corpus clean, ASan/UBSan clean, 10 minutes of fuzz smoke clean.
- Stream B (reader) merged into `integrate/v0.1`; 53 reader tests pass with
  static reports and with the real core's reports and sanitized packages.
- Integration fixes: file names keep extensions on the right in RTL names;
  equations the reader cannot draw become an [Equation] marker instead of
  blanking the document; reader and core pair outline paragraphs the same way.

- Stream C (hosts, packaging, CI) merged; CI green on Windows, Linux, macOS.
- README, site, THIRD_PARTY_NOTICES.md, and docs/FIDELITY.md merged.
- Security review: 9 findings, all fixed (TEST_REPORT D-01 to D-07, D-19).
- Phase 3 testing done: 27 defects found, 26 fixed, D-26 mitigated and
  carried as a written release exception. Results in
  docs/VALIDATION_STATUS.md and docs/TEST_REPORT.md.

## In progress

- Phase 5 and 6: pull request to `main`, CI, and the v0.1.0 release.

## Remaining

- Phase 7: winget pull request (owner opens it from his fork) and companion
  links in LeanMark and LeanRows.
- Owner-run measurements: tests/owner/Measure-Performance.ps1 and
  Compare-WithWord.ps1, then publish figures; UI-01 contact sheet sign-off;
  person-scored fidelity rubric (docs/FIDELITY.md).

## Owner actions

- Done 2026-10-20: the owner deleted `stream/c-hosts`.

## Open questions for the owner

- None blocking. On 2026-10-20 the owner delegated all remaining choices and
  asked that the work continue to release with him as the sole author. Owner-run measurements are listed in the execution plan.
