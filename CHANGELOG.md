# Changelog

All notable LeanDoc changes are recorded here. The project follows semantic
versioning.

## [0.1.4] - 2026-10-28

### Fixed

- Page view breaks pages where Word does in many more documents. On 35
  documents measured against Word 365, 22 now have Word's page count (10 in
  0.1.3) and 30 are within one page; the pages off, summed, fell from 293 to
  19.
- Table rows break across pages between lines, header rows repeat on each
  page, and rows Word keeps whole move whole. A row taller than a page no
  longer holds every row after it on that page.
- Pages after a title page take the section's own header and footer, not the
  first page's.
- A missing font is drawn in the stand-in the document names, as Word does,
  and Aptos is drawn in Calibri spaced to Aptos's width instead of in Arial.
- Superscripts and subscripts no longer make lines taller, an empty paragraph
  is one line of its mark, numbered paragraphs break across pages, and a page
  start Word saved after a continuous section break no longer adds a blank
  page.
- Long documents keep the speed and memory of 0.1.3: a page's lines are
  matched to Word's when it comes near the window.

## [0.1.3] - 2026-10-25

### Added

- A Microsoft Store (MSIX) package, built from each release by the
  `store-msix.yml` workflow, and the listing text for Partner Center in
  `store/`.
- Preparation for code signing through SignPath Foundation, off until the
  project's SignPath account is configured. `leandoc-inspect.exe` now carries
  a version resource with the product name and version.

### Fixed

- Page view showed a 46-page survey saved by Word as 87 pages. Word saves
  where each page started, and the renderer starts a page at each of those
  places, so when LeanDoc's text ran a few lines past a page, those lines
  took a page of their own. Text that runs past such a page start now
  continues on the page that starts there. Explicit page and section breaks
  are unchanged, and a page start Word saved right after an explicit page
  break no longer adds an empty page.
- Text set taller than in Word: runs in the complex-script theme font
  (`majorBidi`, `minorBidi`) printed in the body font instead of the theme's
  font for the document's bidi language; a paragraph whose runs and mark are
  smaller than its style was spaced at the style's size; contextual spacing
  was ignored; and fixed-layout tables were fitted to their content.
- A paragraph whose text and mark were deleted as tracked changes showed as
  an empty line.

A copy of the survey with its letters scrambled showed as 87 pages and now
shows as 49; Word 365 lays it out on 48.

## [0.1.2] - 2026-10-21

### Fixed

- Long documents took seconds to tens of seconds to open in page view, with
  the window frozen the whole time: every page split laid out the whole rest
  of the document again. Pages now take their text from a queue and are split
  in short slices that let the window respond. A 62-page supplement with 52
  tables opens in 2.5 seconds instead of 21, a 4,000-row table in 2.8 instead
  of 27, and no step of splitting holds the window for more than a fraction
  of a second. Page breaks are unchanged.
- Fit and automatic zoom follow a window resize once it settles, instead of
  laying out the whole document again on every frame of a drag.
- Page view laid out two-column documents with about half of what Word puts
  on a page. A column section that runs past a page now fills the left column
  and then the right; a section that ends on the page is balanced, and the
  last section is not, as in Word. A paragraph that reaches the bottom of a
  page continues on the next one instead of moving whole, and a footnote
  prints at the foot of the page that refers to it.
- Headings printed at the size of their linked character style, text in
  unstyled paragraphs at the document default instead of Normal, single
  spacing at the bare font size, and small-text styles with the body's line
  height. Each now follows Word.
- Every document was hyphenated; now only one whose settings ask for it.
- The empty paragraph that carries a continuous section break took a line.
- A table of automatic width kept equal grid columns, drew its outer borders
  under every row, and padded every cell; a table split across pages lost its
  column widths. Each now follows Word.
- A subscript made of several runs printed one letter per line.

A 12-page paper in IEEE two-column layout, written by pandoc, showed as 18
pages in 0.1.1 and shows as 12 pages, as in Word.

## [0.1.1] - 2026-10-20

### Fixed

- Page view showed a document with no page breaks as a single page as tall as
  its text. Documents written by python-docx, pandoc, and other generators carry
  no page break and none of the page markers Word saves, and the renderer
  starts pages only at those. Each page is now measured against its height and
  bottom margin, and what does not fit moves to a new page with the same size,
  margins, header, and footer. Tables split between rows, a heading stays with
  the text after it, and notes go to the last page. A 938-paragraph paper now
  shows as 42 pages instead of one.

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
