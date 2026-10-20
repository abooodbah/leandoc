# LeanDoc per-user installer

These scripts install LeanDoc for the current Windows user. They need no
administrator access and never edit or delete Windows UserChoice values.

## Check the payload first

From the extracted release ZIP, this reads the files and changes nothing:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1 -ValidateOnly

## Install

From the extracted `LeanDoc-vX-windows-x64` folder, or from the repository
root after `scripts\build.ps1`:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1

The installer looks for `LeanDoc.exe` in the folder above `installer\`, then in
`dist\`. To choose a payload explicitly:

    .\installer\install.ps1 -SourceDirectory 'C:\path\to\payload'

The payload must contain `LeanDoc.exe`, `WebView2Loader.dll`, and the reader
assets. `tools\`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `README.md` are
copied when present. The per-user destination is
`%LOCALAPPDATA%\Programs\LeanDoc`.

## Default-app behaviour

LeanDoc registers `.docx`, `.dotx`, `.docm`, `.dotm`, `.doc`, `.rtf`, and
`.odt` through its per-user capabilities, the `LeanDoc.Document` ProgID, an
Applications entry, an App Paths entry, and each extension's
`OpenWithProgids` list.

For each extension, `install.ps1` checks the protected Explorer UserChoice key.
It writes a direct `HKCU\Software\Classes` extension default only when
UserChoice does not exist. It then calls SHChangeNotify and asks Windows which
executable is actually used.

When another application stays the default, an interactive install offers to
open LeanDoc's page in Windows Default Apps. These switches also exist:

- `-OpenDefaultAppsSettings`: open the settings page when it is needed.
- `-Quiet`: do not show the interactive settings prompt.
- `-ValidateOnly`: check the payload and exit without changing anything.

Windows asks the user before an existing default changes; the scripts do not
work around that.

## Uninstall

Use Settings > Apps > Installed apps > LeanDoc, or run:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $env:LOCALAPPDATA\Programs\LeanDoc\uninstall.ps1

The uninstaller checks that the recorded location is exactly
`%LOCALAPPDATA%\Programs\LeanDoc` and rejects reparse points. It removes
LeanDoc's own registry keys (including its theme, view, and recent-file
settings), only LeanDoc's values from shared keys, the Start menu shortcut only
when it still points at this installation, and only the files listed in the
install manifest.

If the manifest is missing or invalid, a short list of known LeanDoc files is
used. Unknown files and non-empty folders are kept. A previous direct Classes
default is restored only if the current value is still `LeanDoc.Document`. A
later user choice is kept, and UserChoice is never changed or deleted.

## Unsigned builds

The Windows build is not signed. Windows may show an unknown-publisher or
SmartScreen warning. Compare the downloaded ZIP with the `.sha256` file from
the same GitHub Release before you run it.
