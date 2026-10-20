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

## In progress

- Phase 1: streams A (core), B (reader), C (hosts, packaging, CI).

## Remaining

- Phase 2 integration review, phase 3 README and site, phase 4 CI on three
  platforms, phase 5 v0.1.0 release, phase 6 winget and companion PRs.

## Open questions for the owner

- None blocking. Owner-run measurements are listed in the execution plan.
