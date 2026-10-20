## Summary

Describe the change and its visible effect.

## Related issue

Link the issue, or explain why one is not needed.

## Validation

Check what applies and explain any skipped check.

- [ ] The Release build succeeds on every affected platform.
- [ ] CTest passes on the affected platforms (Linux under `dbus-run-session`).
- [ ] `npm run test:reader` passes when the reader changed.
- [ ] `tests/Test-LeanDoc.ps1 -Smoke -Runtime` passes when the Windows host or installer changed.
- [ ] `node scripts/Test-ReleaseEngineering.mjs` passes.
- [ ] I looked at the real app for visible changes and added screenshots.

## Review checklist

- [ ] The change keeps LeanDoc read-only and focused.
- [ ] Untrusted documents still pass through the core, and the reader still receives only the sanitized package.
- [ ] Host origin, navigation, link, and permission rules are unchanged, or the change explains why.
- [ ] Tests, fixtures, documentation, and third-party notices are updated.

## Additional notes

Compatibility limits, safety decisions, or follow-up work.
