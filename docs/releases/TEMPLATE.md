# LeanDoc vX.Y.Z

Copy this file to `docs/releases/vX.Y.Z.md` for a new release, replace X.Y.Z,
and write the summary, fixes, measurements, and known gaps. Delete this
paragraph. Keep the "Signing and privacy" section as it is below.

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

## Signing and privacy

The Windows programs in the GitHub ZIP are not signed.

Privacy policy: This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.
LeanDoc's own code makes no network requests and never fetches anything a
document points to. The page is drawn by the system web runtime (the Microsoft Edge WebView2
Runtime on Windows, a Microsoft component), which may contact its vendor on
its own. The full policy, including how to uninstall, is in the
[README](https://github.com/abooodbah/leandoc#privacy-policy).
