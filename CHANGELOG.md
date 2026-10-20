# Changelog

All notable LeanDoc changes are recorded here. The project follows semantic
versioning.

## [0.1.0] - 2026-10-20

### Added

- A read-only viewer for Word documents (`.docx`, `.dotx`, `.docm`, `.dotm`).
  A portable C++ core reads the file within fixed size limits, checks the ZIP
  and the XML, counts every feature, and writes a new package that holds only
  allow-listed parts. The reader never receives the original file.
- Page view by default and a reading view one click away, with zoom from 50 to
  300 percent and fit width. The document page stays on paper colours in every
  theme.
- A fidelity bar that names the content LeanDoc does not display (text boxes,
  equations, charts, SmartArt, shapes, OLE objects, ActiveX controls, imported
  content) and the content it handles safely (tracked changes shown as
  accepted, hidden comments, macros that never run, remote templates, images,
  and fields that are never fetched).
- A navigation pane built from the document's headings, find in the document,
  copy all text, and a theme cycle of System, Light, and Dark.
- A fallback page for `.doc`, encrypted documents, `.rtf`, `.odt`, and files
  that are not Word documents, with the open-in-editor action.
- One "Open in ..." button that hands the file to Microsoft Word, then
  LibreOffice, then the system default app when it is not LeanDoc, then Word
  for the web in the browser. macOS also checks Pages after LibreOffice.
- Windows x64 host on Win32 and WebView2: tabs in one window, a later launch
  opens its files as tabs, reload when the file changes, drag and drop, recent
  files, and an optional per-user installer for Open With and Default Apps.
- Linux x86-64 host on GTK 4 and WebKitGTK 6.0, packaged as a `.deb` with a
  desktop entry, AppStream metadata, and an icon. A later launch opens its
  files as tabs of the running window.
- macOS universal preview on AppKit and WKWebView, ad-hoc signed and not
  notarized, with system window tabs.
- `leandoc-inspect`, a command-line tool that prints one JSON report per file.
- Test hooks for measurement: `--smoke-test FILE`, `--trace-timing`, and
  `--exit-after-render=MS` on every host.
- winget manifests for `abooodbah.LeanDoc`.
