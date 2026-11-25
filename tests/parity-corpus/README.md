# Parity corpus

38 long public Word documents (5 to 177 pages, 1,296 pages in all) for
comparing LeanDoc's page view with Word's. The `tests/corpus` set is mostly
one-page unit-test files, which say little about page breaks; this set has
long tables that split across pages, repeated header rows, footnotes,
several sections, landscape and multi-column sections, headers and footers,
floating pictures, and a few right-to-left and East Asian documents.

The files are downloaded on demand into `tests/parity-corpus/cache/`
(gitignored) and never committed.

```sh
node tests/corpus/fetch-corpus.mjs --corpus parity-corpus
```

`manifest.json` lists each file with its URL pinned to an upstream commit or
a fixed publication address, the source, the licence, a note on its layout
features, Word's page count, and its SHA-256. The fetcher refuses changed
bytes unless run with `--update`.

## Word's results

`tests/reader/parity/word-public.json` holds Word's page count and the first
text of every page for each file, recorded with `word-pages.ps1`'s method
(Microsoft 365 Word on Windows 11, final view without markup, macros and link
updates off). Each `file` is a path from the repository root, so score from
the repository root:

```sh
LEANDOC_INSPECT=build/release/tools/inspect/leandoc-inspect LEANDOC_CHROMIUM=... \
  node tests/reader/parity/probe.mjs reader.json tests/parity-corpus/cache/*.docx
node tests/reader/parity/compare.mjs tests/reader/parity/word-public.json reader.json
```

A file added to the manifest needs its Word results recorded on Windows with
Word before it can be scored.

## Sources

| Source | Files | Pages | Licence |
| --- | ---: | ---: | --- |
| [GOV.UK](https://www.gov.uk) publications | 9 | 341 | Open Government Licence v3.0 |
| [Apache POI](https://github.com/apache/poi) test data | 5 | 271 | Apache-2.0 |
| [FedRAMP](https://github.com/FedRAMP/docs-legacy) templates | 7 | 232 | US federal government work |
| [Open-XML-SDK](https://github.com/dotnet/Open-XML-SDK) test files | 5 | 208 | MIT |
| [docx4j](https://github.com/plutext/docx4j) samples | 7 | 184 | Apache-2.0 |
| [Apache Tika](https://github.com/apache/tika) test documents | 3 | 32 | Apache-2.0 |
| [LibreOffice](https://github.com/LibreOffice/core) test data | 1 | 23 | MPL-2.0 |
| [Open-Xml-PowerTools](https://github.com/OpenXmlDev/Open-Xml-PowerTools) test files | 1 | 5 | MIT |

Some test-data files are other people's documents that those projects carry
as test cases; for them the repository's licence is the only licence given,
and the manifest note says so. Three GOV.UK templates were left out because
they are locked for editing and Word will not repaginate them.
