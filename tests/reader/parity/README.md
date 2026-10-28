# Page parity harness

Tools for comparing the page view's pagination with Word's on real
documents. Word runs through COM (Windows, Word installed); the reader runs
in the headless Chromium that the reader tests use. Nothing here runs in CI.

Environment for the Node scripts:

- `LEANDOC_INSPECT`: path to `leandoc-inspect.exe`, which sanitizes each file
  as the app does.
- `LEANDOC_CHROMIUM`: path to a Chromium headless shell.
- `LEANDOC_ASSETS` (optional): a folder staged with
  `node scripts/stage-runtime-assets.mjs <folder>`, to test assets other than
  the working tree's. Use a Windows path with backslashes.

## Page counts and page starts

1. `powershell -File word-pages.ps1 ...` writes Word's page count and the
   first text of every page for a list of files.
2. `node probe.mjs out.json file.docx ...` writes the reader's.
3. `node compare.mjs word.json reader.json [--detail]` prints, per file, both
   page counts and how many of Word's page starts begin a reader page.

`segments.mjs` measures how tall each Word page's content is in the reader,
which shows where a document starts to run long or short.

## Finding the cause on one page

- `word-page-blocks.ps1` and `debug-page.mjs`: what each side puts on a page.
- `word-paragraphs.ps1` and `reader-paragraphs.mjs`: paragraph tops and
  line counts.
- `word-paragraph-lines.ps1` and `debug-cell-lines.mjs`: where each line of a
  paragraph breaks.
- `word-tables.ps1`, `word-rows.ps1` and `reader-tables.mjs`: table and row
  heights.
- `word-widths.ps1`, `word-widths-in-document.ps1`, `chromium-widths.mjs`
  and `font-ratio.mjs`: font widths and single-line heights.
- `debug-eval.mjs file.docx "expression"`: evaluates any expression in the
  reader after the document opens.

The line-breaking models (`model.mjs`, `model2.mjs`, `sweep.mjs`) compare
rules for how far Word lets the spaces of a justified line shrink.
