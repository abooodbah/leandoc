# Corpus run

About 50 public Word documents from the Apache POI and LibreOffice test data,
run through `leandoc-inspect`. The files are downloaded on demand into
`tests/corpus/cache/` (gitignored) and never committed.

```sh
NODE_USE_ENV_PROXY=1 node tests/corpus/fetch-corpus.mjs   # proxy variable only behind a proxy
node tests/corpus/run-corpus.mjs --inspect build/release/tools/inspect/leandoc-inspect
```

- `manifest.json` lists each file with its raw URL pinned to an upstream
  commit, the source folder, the licence, a note, the error code the core
  should report (empty for none), and its SHA-256.
- `fetch-corpus.mjs` downloads missing files, checks each one against its
  SHA-256, and refuses changed bytes unless run with `--update`.
- `run-corpus.mjs` runs `leandoc-inspect --time` on each file. It fails on a
  crash, a run over 10 s, or an error code the manifest does not expect, and
  flags files over 2 s. `--markdown` prints the table below.

## Sources

| Source | Folder | Commit | Licence |
| --- | --- | --- | --- |
| [Apache POI](https://github.com/apache/poi) | `test-data/document/` | `d91a76448f0963a93b6cd95fb97fbe1d8bad82c6` | Apache-2.0 |
| [LibreOffice](https://github.com/LibreOffice/core) | `sw/qa/extras/ooxmlimport/data/`, `sw/qa/extras/ooxmlexport/data/` | `a5b846213b817aeac7f5dd6b19db6044e38323d7` | MPL-2.0 |

Every URL was fetched at its pinned commit and its SHA-256 recorded. The
source folder in each entry matches its URL. The licence is the licence of
the repository that publishes the file.

## Last run

Date: 2026-10-20. Machine: Linux x86-64 container, Intel Xeon at 2.8 GHz,
GCC 13.3 Release build. Result: 50 files run, 0 failed, 0 not fetched; slowest 40.9 ms. No file
came near the 2 s flag. The same run under ASan and UBSan was clean.

What the corpus found, all fixed:

- `tdf165348_broken_package.docx` has a duplicate attribute, which pugixml
  accepts and browsers do not. The core now reports `xml-malformed`.
- `strict-lockedcanvas.docx` holds a DrawingML locked canvas that was not
  counted. It now counts as one shape.
- `math-mso2k7.docx`, `shapes-with-text.docx`, `ChronologicalResume.dotx`,
  and others hold equations and VML text boxes that docx-preview does draw.
  The core now counts them only where it does not (see
  `FeatureIsNotDisplayed()` in `src/core/DocCore.cpp`); these files were
  rendered with docx-preview 0.4.1 in Chromium to confirm the counts.

| name | kind | ok | errorCode | features | ms | status |
| --- | --- | --- | --- | --- | --- | --- |
| poi/sample.docx | docx | yes |  |  | 1.5 | pass |
| poi/Numbering.docx | docx | yes |  |  | 1.7 | pass |
| poi/ComplexNumberedLists.docx | docx | yes |  |  | 2.2 | pass |
| poi/rtl.docx | docx | yes |  |  | 1.4 | pass |
| poi/FieldCodes.docx | docx | yes |  |  | 2.1 | pass |
| poi/FldSimple.docx | docx | yes |  |  | 1.3 | pass |
| poi/footnotes.docx | docx | yes |  |  | 1 | pass |
| poi/endnotes.docx | docx | yes |  |  | 1.1 | pass |
| poi/delins.docx | docx | yes |  | tracked-changes 82 | 2.8 | pass |
| poi/bug56075-changeTracking_on.docx | docx | yes |  |  | 1.1 | pass |
| poi/comment.docx | docx | yes |  | comments 1 | 0.7 | pass |
| poi/deep-table-cell.docx | docx | no | xml-too-deep |  | 11.1 | pass |
| poi/chartex.docx | docx | yes |  | chart 6 | 2.8 | pass |
| poi/shapes-with-text.docx | docx | yes |  | text-box 2, shape 6 | 2.7 | pass |
| poi/EmbeddedDocument.docx | docx | yes |  | ole-object 1 | 0.9 | pass |
| poi/checkboxes.docx | docx | yes |  | remote-template 1 | 2 | pass |
| poi/VariousPictures.docx | docx | yes |  |  | 3.8 | pass |
| poi/ExternalEntityInText.docx | docx | no | xml-doctype |  | 1 | pass |
| poi/45690.docm | docm | yes |  | macros 1 | 6.8 | pass |
| poi/ChronologicalResume.dotx | dotx | yes |  | text-box 2 | 3.1 | pass |
| poi/bug53475-password-is-pass.docx | encrypted-ooxml | yes |  |  | 0.1 | pass |
| poi/truncated62886.docx | not-a-document | no | corrupt-zip |  | 0.1 | pass |
| poi/zero-length.docx | docx | yes |  |  | 0.8 | pass |
| poi/clusterfuzz-testcase-minimized-POIXWPFFuzzer-4791943399604224.docx | not-a-document | no | corrupt-zip |  | 0.1 | pass |
| poi/clusterfuzz-testcase-minimized-POIXWPFFuzzer-5564805011079168.docx | not-a-document | no | corrupt-zip |  | 0.1 | pass |
| poi/crash-517626e815e0afa9decd0ebb6d1dee63fb9907dd.docx | not-a-document | no | corrupt-zip |  | 0.1 | pass |
| poi/bib-chernigovka.netdo.ru_download_docs_17459.docx | docx | yes |  |  | 40.9 | pass |
| poi/SampleDoc.doc | legacy-doc | yes |  |  | 0.1 | pass |
| poi/PasswordProtected.doc | legacy-doc | yes |  |  | 0.1 | pass |
| libreoffice/tdf87533_bidi.docx | docx | yes |  |  | 2.7 | pass |
| libreoffice/math-malformed_xml.docx | docx | no | xml-malformed |  | 0.4 | pass |
| libreoffice/strict-lockedcanvas.docx | docx | yes |  | shape 1 | 1.8 | pass |
| libreoffice/ink.docx | docx | yes |  | shape 1 | 1.3 | pass |
| libreoffice/linked-picture.docx | docx | yes |  | remote-image 1 | 0.2 | pass |
| libreoffice/textbox-wps-only.docx | docx | yes |  | text-box 2 | 1.4 | pass |
| libreoffice/tdf165348_broken_package.docx | docx | no | xml-malformed |  | 0.1 | pass |
| libreoffice/tdf152200-bad_fldChar_end.docx | docx | yes |  |  | 1.2 | pass |
| libreoffice/tdf119039_bad_embedded_compound.docx | docx | yes |  | ole-object 1 | 1.4 | pass |
| libreoffice/smartart.docx | docx | yes |  | smartart 1 | 1.9 | pass |
| libreoffice/chart.docx | docx | yes |  | chart 1 | 1.1 | pass |
| libreoffice/activex_checkbox.docx | docx | yes |  | activex 1 | 1.2 | pass |
| libreoffice/test_ole_object.docx | docx | yes |  | ole-object 1 | 1.9 | pass |
| libreoffice/table-rtl.docx | docx | yes |  |  | 1.4 | pass |
| libreoffice/tdf141231_arabicHebrewNumbering.docx | docx | yes |  |  | 2.9 | pass |
| libreoffice/tdf146973_arabicDateField.docx | docx | yes |  |  | 1.6 | pass |
| libreoffice/testTrackChangesDeletedTableRow.docx | docx | yes |  | tracked-changes 3 | 3.4 | pass |
| libreoffice/99_Fields.docx | docx | yes |  |  | 1.4 | pass |
| libreoffice/math-mso2k7.docx | docx | yes |  |  | 1.5 | pass |
| libreoffice/FileWithInvalidImageLink.docx | docx | yes |  | remote-image 1 | 1.5 | pass |
| libreoffice/tdf134619_numberingProps.doc | legacy-doc | yes |  |  | 0.1 | pass |
