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

## In progress

- Phase 1: stream C (hosts, packaging, CI) on `stream/hosts`.

## Remaining

- Phase 2 integration review; phase 3 thorough testing of usage, UI,
  performance, and memory ([docs/TEST_PLAN.md](docs/TEST_PLAN.md)); phase 4
  README and site; phase 5 CI on three platforms and release candidate check;
  phase 6 v0.1.0 release; phase 7 winget and companion PRs.

## Owner actions

- Delete the branch `stream/c-hosts` on GitHub
  (https://github.com/abooodbah/leandoc/branches). One commit on it carried the
  wrong author. It is dropped locally and never merged; the corrected history is
  `stream/hosts`. The build session's git proxy refuses branch deletion.

## Open questions for the owner

- None blocking. On 2026-10-20 the owner delegated all remaining choices and
  asked that the work continue to release with him as the sole author. Owner-run measurements are listed in the execution plan.
