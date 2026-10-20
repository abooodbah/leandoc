# Owner scripts

These scripts run on the owner's Windows laptop against a release build. They
produce the only figures LeanDoc may publish: CI runners decide pass or fail,
but their numbers are never product claims. Run them from a PowerShell 7
prompt in a checkout of the release tag, with every LeanDoc and Word window
closed. Each script prints Markdown to paste back; none of them sends anything
anywhere.

`LeanDoc.exe` is found at `%LOCALAPPDATA%\Programs\LeanDoc\LeanDoc.exe` (the
per-user install) or at `dist\LeanDoc.exe`; pass `-ExePath` to use another
copy, for example the extracted release ZIP.

## Measure-Performance.ps1

Measures start-up and memory with LeanMark's method. Each scenario (an empty
window, then each document) is launched once to warm up and then 10 times.
Before every launch the script waits until no WebView2 process still uses
LeanDoc's profile folder. LeanDoc starts with `--trace-timing` and
`--exit-after-render=MS`, so the script reads the window, web view, and first
page times from LeanDoc itself, samples the private memory and working set of
LeanDoc.exe and every descendant WebView2 process 2 seconds after the first
page, and lets LeanDoc close itself. A launch with fewer than three processes
in its tree is excluded and counted.

```powershell
pwsh -File tests\owner\Measure-Performance.ps1 -DocumentPath C:\Docs\short-report.docx, C:\Docs\long-report.docx -OutputPath perf.json
```

Duration: about 30 seconds per launch, so 6 to 8 minutes for an empty window
and two documents. Expected output: a "LeanDoc performance" heading, the
LeanDoc version, the machine (model, processor, logical processors, memory),
Windows build and WebView2 Runtime version, the method in one line, then a
table with one row per scenario: window visible (ms), first page (ms), pages,
private memory (MiB), working set (MiB), processes, and excluded launches.
`-OutputPath` also writes every raw sample as JSON.

## Compare-WithWord.ps1

Opens the same documents in LeanDoc and in Microsoft Word, alternating, one
warm-up round and then 5 measured rounds. Word runs through COM with
`Visible = $true`, opens each file read-only without adding it to Word's
recent list, never exports or converts it, and closes without saving. The
script refuses to start while Word or LeanDoc is running.

```powershell
pwsh -File tests\owner\Compare-WithWord.ps1 -DocumentPath C:\Docs\short-report.docx, C:\Docs\long-report.docx
```

Duration: about 1 minute per document per round, so 10 to 15 minutes for two
documents. Expected output: a "LeanDoc and Microsoft Word" heading, both
versions, the machine, the method, and a table with two rows per document
(LeanDoc and Word): first page (ms), pages, private memory (MiB), working set
(MiB), and runs. Word's first page is the time from starting Word to
`Documents.Open` returning; LeanDoc's is its `rendered` message. Page counts
that differ point at a pagination gap worth reporting.

## Scan-Folder.ps1

Runs `leandoc-inspect` over every `.docx`, `.dotx`, `.docm`, `.dotm`, `.doc`,
`.rtf`, and `.odt` file in a private folder and its subfolders, one file at a
time with a 10 second limit. It prints only file names, kinds, results, times,
and feature counts; never paths, titles, authors, headings, or text. It
writes nothing into the folder.

```powershell
pwsh -File tests\owner\Scan-Folder.ps1 -Path "$env:USERPROFILE\Documents"
```

Duration: well under a second per file, so about a minute for a few hundred
documents. Expected output: a table with one row per file (file, kind such as
`docx` or `legacy-doc`, result `ok` or an error code such as `xml-doctype`,
`hang`, or `crash`, milliseconds, and features such as `text-box 2,
tracked-changes 14`), then a summary that counts each result and the files
slower than 2 seconds. Rename any file whose name itself is private before
sharing the output.

## Test hooks the scripts use

Every LeanDoc host accepts these flags. They do nothing unless given.

- `--trace-timing` prints `LEANDOC_TIMING <event> <ms since process start>`
  lines to standard output for `process-start`, `window-visible`,
  `webview-ready`, `document-requested` (`tab`, `generation`),
  `package-served` (`coreMs`, `bytes`), and `rendered` (`pages`,
  `readerMs`). On Windows standard output exists only when the caller
  redirects it, as these scripts do.
- `--exit-after-render=MS` closes LeanDoc MS milliseconds (0 to 600000) after
  the first `rendered` message. A launch with this flag never joins a running
  LeanDoc window.
- `--smoke-test FILE` renders FILE, checks the page, and exits 0 or 1 within
  20 seconds.
