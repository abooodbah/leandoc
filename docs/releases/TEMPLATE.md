# LeanDoc vX.Y.Z

Copy this file to `docs/releases/vX.Y.Z.md` for a new release, replace X.Y.Z,
and write the summary, fixes, measurements, and known gaps. Delete this
paragraph. Keep the "Code signing policy" section: SignPath Foundation
requires it in the release notes, and `scripts/Test-ReleaseEngineering.mjs`
checks it for every release after 0.1.2. If signing was not set up for this
release, keep the second sentence of that section as it is below; if it was,
replace it with "LeanDoc.exe and tools\leandoc-inspect.exe in the Windows ZIP
are signed."

## Release assets

| Platform | Artifact |
| --- | --- |
| Windows 10 and 11, x64 | **LeanDoc-vX.Y.Z-windows-x64.zip** |
| Ubuntu 24.04 and compatible, x86-64 | **LeanDoc-vX.Y.Z-linux-x86_64.deb** |
| macOS 12 or later, Intel and Apple silicon | **LeanDoc-vX.Y.Z-macos-universal-preview.zip** |

Every artifact has an adjacent **.sha256** sidecar. The macOS preview also has
a **.metadata.json** file that records how it was signed.

## Fixes

## Known gaps

## Installing

On Windows, run the installer from the extracted ZIP:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1 -OpenDefaultAppsSettings
```

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

The Windows programs in this release are not signed.

Committers and reviewers: [abooodbah](https://github.com/abooodbah).
Approvers: [abooodbah](https://github.com/abooodbah). LeanDoc is a one-person
project.

Privacy policy: This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.
LeanDoc's own code makes no network requests and never fetches anything a
document points to. The page is drawn by the system web runtime (the Microsoft Edge WebView2
Runtime on Windows, a Microsoft component), which may contact its vendor on
its own. The full policy, including how to uninstall, is in the
[README](https://github.com/abooodbah/leandoc#code-signing-policy).
