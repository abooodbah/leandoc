# Native hosts

LeanDoc has three native hosts: Win32 and WebView2 (`src/windows/`), GTK 4
and WebKitGTK 6.0 (`src/linux/`), and AppKit and WKWebView (`macos/`). They
were copied from LeanMark 0.3.0 and adapted to [SPEC section 5](../SPEC.md).
Each host owns files, dialogs, drag and drop, single instance, tabs,
settings, recent files, links, open-in-editor, and the web runtime's policy.
None of them parses a document: they read the file, call the core
(`src/core/DocCore.h`), serve the sanitized package to the shared reader
(`assets/`), and forward the JSON report.

## Build

All three hosts build with CMake from the root `CMakeLists.txt`, which
includes `cmake/Hosts.cmake`. There is no Visual Studio solution.

| Platform | Generator in CI | Output |
| --- | --- | --- |
| Windows | Visual Studio (`-A x64`), static C runtime | `LeanDoc.exe`, `WebView2Loader.dll` |
| Linux | Ninja | `leandoc`, installed under `/usr` by the `.deb` |
| macOS | Xcode, `arm64;x86_64` | `LeanDoc.app` (universal) |

The reader assets are staged into the build tree by the reader's own
`scripts/stage-runtime-assets.mjs` (Node.js at build time only). The WebView2
SDK NuGet package is downloaded by `scripts/Get-WebView2Sdk.ps1`, which checks
a pinned SHA-256 before extracting only `build/native/` and the licence.
`-DLEANDOC_BUILD_HOSTS=OFF` builds only the core and `leandoc-inspect`, which
the corpus workflow uses.

## App origin and package serving

The reader is served from a read-only app origin, and each tab's sanitized
package is answered from memory at `<origin>/pkg/<tab>/<generation>/document.docx`.
Only the active tab's current generation is served; anything else, including
an older generation, answers 404. No folder of the user's is ever mapped.
Every answer carries `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`.

| Host | Origin | Mechanism |
| --- | --- | --- |
| Windows | `https://app.leandoc.invalid/` | `WebResourceRequested` with the filter `https://app.leandoc.invalid/*` answers both the assets (from the `assets` folder next to the executable) and the packages (from memory). |
| Linux | `leandoc://app/` | A custom URI scheme registered as secure on a private `WebKitWebContext`. It is not registered as local: WebKit loads no blob: URL from a local origin, and docx-preview serves every image as one. CORS answers name only `leandoc://app`. |
| macOS | `leandoc://app/` | A `WKURLSchemeHandler` per window. CORS answers name only `leandoc://app`. |

The package is same-origin with the reader on all three hosts, so the
reader's `connect-src 'self'` reaches it and nothing else.

Decision (Windows): the first version mapped the assets with
`SetVirtualHostNameToFolderMapping` and answered only `/pkg/*` through
`WebResourceRequested`. On the CI runner (WebView2 154) the reader's fetch of
the package failed with "Failed to fetch": a mapped host answers every path
from disk, and a path that is not a file fails before `WebResourceRequested`
is asked. The host now answers the whole origin itself, with the same path
rules as the Linux host (plain names only, no empty, `.` or `..` segments,
inside the assets folder, a fixed list of content types, at most 64 MiB).
This keeps one origin, so the reader's Content Security Policy did not need
to change.

## Reader protocol

The reader posts JSON text (`chrome.webview.postMessage` on Windows,
`webkit.messageHandlers.leandoc.postMessage` on Linux and macOS). Hosts accept
messages only from the reader page in the main frame. Hosts deliver messages
as a `leandoc-message` event on `window`:

- Windows: `PostWebMessageAsJson`, which the reader receives through
  `chrome.webview`'s `message` event.
- Linux: `webkit_web_view_evaluate_javascript` with
  `window.dispatchEvent(new CustomEvent("leandoc-message",{detail:<json>}))`.
- macOS: `callAsyncJavaScript` with the JSON text as an argument, parsed in
  the page, so booleans and numbers keep their JSON types.

Nothing is sent before the reader's `ready`. Then the host sends `host`,
`theme`, `tabs` (Windows and Linux), and `document`, `fallback`, or `empty`.
`rendered` and `renderFailed` for a stale tab or generation are ignored.

## Tabs and single instance

| Host | Tabs | A later launch |
| --- | --- | --- |
| Windows | The reader's tab strip; one window | Finds the window of the same executable path and hands its paths over with `WM_COPYDATA`, then exits. A named mutex per executable path keeps an installed copy and a portable copy apart. |
| Linux | The reader's tab strip; one window | `GApplication` with `G_APPLICATION_HANDLES_OPEN` forwards the files over D-Bus to the running instance. |
| macOS | System window tabs (`NSWindowTabbingModePreferred`); the reader's strip stays hidden (`tabs: false`) | macOS LaunchServices delivers the files to the running app as `NSDocument`s. |

On Windows and Linux a tab keeps only its path, file stamp, and generation.
Background tabs keep no package or DOM; selecting a tab reads the file again.

macOS differs, because its tabs are system window tabs: each document is an
`NSDocument` with its own window and its own `WKWebView`, so a background
tab keeps its rendered DOM and its web content process (which the system may
suspend). The host keeps the sanitized package only until the reader has
fetched it, then drops it and reads the file again when the reader asks for
the document again (a reload, a renderer recovery, or a file change). M-05
on macOS measures what five open windows cost. The active file is
watched (Windows polls every 500 ms, Linux uses a `GFileMonitor` on the
folder, macOS polls every 500 ms) and reloads after it has been stable for
350 ms.

Keyboard focus stays in the page. The reader wraps Tab from the last control
to the first (and Shift+Tab the other way), so the focus never leaves the
web view for a native window that has nothing else to focus. On Linux, GTK
uses Ctrl+Tab to move the focus to a hidden widget inside the web view; the
host watches the window's `focus-widget` and gives the focus back to the web
view whenever it lands anywhere but the web view or a popover (the context
menu).

## Settings

| Host | Where | What |
| --- | --- | --- |
| Windows | `HKCU\Software\LeanDoc` | `Theme`, `View`, `Recent` (up to 10) |
| Linux | `$XDG_CONFIG_HOME/leandoc/settings.ini`, group `[Reader]` | `Theme`, `View`, `Recent` (up to 10) |
| macOS | `NSUserDefaults` | `LeanDocTheme`, `LeanDocView`, `LeanDocRecent` (up to 10) |

Zoom stays per session in the reader. The smoke test writes no settings.

## Links and open in editor

Links open only for `http` and `https` with a host, and `mailto`, through the
system handler (`ShellExecuteW`, `g_app_info_launch_default_for_uri`,
`NSWorkspace openURL:`), after the reader posts `link` on a click. All three
hosts apply one rule from the core, `NormalizeExternalLink` in
`src/core/Links.h`: the scheme is compared without case, raw spaces,
controls, non-ASCII bytes, quotes, backslashes, angle brackets, and backticks
are refused (the reader percent-encodes them), and a `mailto` link is rebuilt
from its addresses and only its `subject`, `body`, `cc`, and `bcc`
parameters, so a parameter such as `attach=` never reaches a mail client.
The reader rebuilds `mailto` links the same way before it posts them.

The editor is resolved once per launch and its label is sent in `host`:

| Order | Windows | Linux | macOS |
| --- | --- | --- | --- |
| 1 | Word: App Paths `WINWORD.EXE` or the `Word.Document.12` association | (none) | `com.microsoft.Word` |
| 2 | LibreOffice: App Paths `soffice.exe` or Program Files | `libreoffice` or `soffice` on `PATH`, or `libreoffice-writer.desktop` | `org.libreoffice.script` |
| 3 | | | `com.apple.iWork.Pages` |
| 4 | The default `.docx` handler when it is not LeanDoc | The default GIO app for the file's own content type when it is not LeanDoc, looked up when the button is pressed; the label follows the active file | The default app for `.docx` when it is not LeanDoc |
| 5 | Word for the web (`https://www.office.com/launch/word`) with a status message that the file must be uploaded there | same | same |

Labels: "Open in Word", "Open in LibreOffice", "Open in Pages",
"Open in <AppName>" or "Open with default app", "Open Word for the web".
Editors start with an argument vector: `CreateProcessW` with a quoted
command line and no shell on Windows, `g_subprocess_newv` or
`g_app_info_launch` on Linux, `NSWorkspace openURLs:withApplicationAtURL:`
on macOS.

## Web runtime policy

All hosts refuse navigation away from the reader page (Windows, Linux, and
macOS allow only `reader.html` itself), new windows, downloads, permission
requests, file choosers, and script dialogs, and turn off developer tools and
the inspector.

The page's context menu keeps only copy and text-editing items, because the
web runtimes' own items ("Download Linked File", "Open Link", "Save link as",
"Open Image in New Window") would fetch what the document points to. Linux
filters by `WebKitContextMenuAction` in the `context-menu` signal, Windows by
item name in `ContextMenuRequested` (`src/windows/ContextMenu.h`), and macOS
by identifier and action in `willOpenMenu:withEvent:` of its `WKWebView`
subclass.

When the web content process dies, a host reloads the reader at most three
times a minute; after that the active document shows an error page
("renderer-stopped") until the user reloads it with F5.

- Windows: one user-data folder per user at
  `%LOCALAPPDATA%\LeanDoc\WebView2`, with identical environment options for
  every LeanDoc process. Tracking prevention, password autosave, autofill,
  SmartScreen reputation checks, browser accelerator keys, the status bar,
  and the built-in error page are off.
- Linux: an ephemeral `WebKitNetworkSession` (nothing is written to disk), the
  document-viewer cache model, and no local storage, databases, WebGL,
  WebAudio, or media.
- macOS: `WKWebsiteDataStore.nonPersistentDataStore`.

### WebView2 browser arguments

SPEC section 5 asks for LeanMark's arguments to be re-measured, not copied.
LeanDoc ships:

```text
--disable-background-networking --disable-component-update --disable-sync
--no-first-run --disk-cache-size=1048576 --media-cache-size=1048576
--disable-gpu --disable-software-rasterizer
--enable-features=NetworkServiceInProcess2
```

`tests/hosts/Compare-BrowserArguments.ps1` runs in the Windows CI job and
compares three profiles (`LEANDOC_BROWSER_PROFILE`): the shipped arguments,
the same with the GPU kept (`gpu`), and no extra arguments (`plain`). The
first runner result (GitHub `windows-latest`, Windows Server 2025 build 26100,
WebView2 154.0.4258.62, 4 logical processors, `tests/hosts/fixtures/smoke.docx`,
median of 3 launches after one warm-up, private memory of the whole process
tree 2 s after the first page):

| Profile | First page (ms) | Private memory (MiB) | Processes |
| --- | ---: | ---: | ---: |
| Shipped arguments | 524 | 91.7 | 6 |
| GPU kept | 522 | 96.2 | 6 |
| No extra arguments | 530 | 101.0 | 7 |

Decision: keep the shipped arguments. They use the least memory with the same
first-page time; without them WebView2 also starts a separate network service
process. These are runner figures for comparison only, never a product
claim. The owner's `tests/owner/Measure-Performance.ps1` run decides the
published numbers, and the CI step re-measures on every build, so a WebView2
update that changes the picture shows up in the job's notice.

## Test hooks

All three hosts accept these flags; each does nothing unless given.

| Flag | Effect |
| --- | --- |
| `--smoke-test FILE` | Renders FILE in its own instance, waits for `rendered`, checks that `data-render-state` is `ready`, that a page with text exists, that no resource came from outside the app origin, and that the CSP reported nothing, then exits 0 or 1 within 20 s. A file that cannot render fails. Windows writes the result to standard error, Linux and macOS to standard output or error. |
| `--trace-timing` | Prints `LEANDOC_TIMING <event> <ms since process start> [key=value ...]` to standard output, one flushed line per event: `process-start`, `window-visible`, `webview-ready`, `document-requested` (`tab`, `generation`), `package-served` (`tab`, `generation`, `coreMs`, `bytes`), `rendered` (`tab`, `generation`, `pages`, `readerMs`). |
| `--exit-after-render=MS` | Quits cleanly MS milliseconds (0 to 600000) after the first `rendered`, so a harness can sample memory first. Such a launch starts its own instance and never joins a running window. |

The Linux host also accepts a fourth hook for the
[test plan](../TEST_PLAN.md) drivers in `tests/usage/` and `tests/perf/`:

| Flag | Effect |
| --- | --- |
| `--test-script FILE` | After the reader's first `ready`, reads FILE one line at a time and runs each command before reading the next. FILE may be a FIFO, so a harness can drive the window interactively, sample memory, and continue. Each command answers with one line on standard output: `LEANDOC_TEST <line> <command> <ok\|error> <ms> [result]`. The launch keeps normal single-instance behaviour, so a second launch still joins it. The process exits 0 after `quit` if no command failed, otherwise 1. |

| Command | Effect and answer |
| --- | --- |
| `js BODY` | Runs BODY as an async function in the reader page (`webkit_web_view_call_async_javascript_function`) and answers its return value as JSON. Reader actions go through the real bridge: clicking chrome buttons, dispatching key events, or `webkit.messageHandlers.leandoc.postMessage`. |
| `wait EXPR` | Evaluates EXPR every 25 ms until it is truthy or the timeout passes. |
| `wait-render` | Waits for the next accepted `rendered` or `renderFailed` after the last action (`js`, `open`, `drop`, `system-theme`, `resize`); the answer gives the time since that action, the pages, and the reader's ms. |
| `open PATH` | Opens PATH as a tab, as a later launch does. |
| `drop PATH` | Hands PATH to the window's drop handler as a dropped file list; answers `accepted` or `refused`. |
| `sleep MS`, `timeout MS`, `mark LABEL` | Waits; sets the wait timeout (30 s by default); answers LABEL at once so a harness can sample. |
| `system-theme light\|dark` | Sets GTK's `gtk-application-prefer-dark-theme`, standing in for the desktop switching its colour scheme. |
| `resize W H` | Sets the window size. |
| `quit` | Quits the application. |

Without the flag no script is opened and none of these commands exist.

Process start is the kernel's start time of the process: `GetProcessTimes`
on Windows, field 22 of `/proc/self/stat` on the boot-time clock on Linux,
and `kp_proc.p_starttime` from `sysctl` on macOS. On Windows standard output
exists only when the caller redirects it. On macOS the document is read
before its window exists, so `document-requested` can come before
`window-visible`; `tests/hosts/Test-TimingHooks.sh` checks the events as two
chains that meet at `rendered`.

## Process tree

Memory figures count the whole tree, as LeanMark does.

- Windows: `LeanDoc.exe` starts `msedgewebview2.exe` (the browser process),
  which starts its renderer, GPU, utility, and crash handler processes. All of
  them are descendants of `LeanDoc.exe`; with the shipped arguments the CI
  runner shows 6 processes including `LeanDoc.exe`. The test harness finds
  them with a Toolhelp parent map (`tests/TestSupport.psm1`).
- Linux: `leandoc` starts `WebKitNetworkProcess` and, inside `bwrap`
  sandboxes, `WebKitWebProcess` and `xdg-dbus-proxy`. All are descendants of
  `leandoc`. The desktop portal services (`xdg-desktop-portal` and friends)
  are D-Bus activated, shared with other apps, and not part of the tree.
  Two settings keep the tree from holding memory it no longer uses: the web
  context's memory pressure settings (a 300 MiB limit, checked every 5 s)
  make WebKit release caches and collect in the web process, and 3 s after a
  document is shown or its package dropped, the UI process calls glibc's
  `malloc_trim(0)` once, which returns the heap pages that reading and
  sanitizing freed (about 20 MiB in the session). Neither runs on a timer
  while nothing happens.
- macOS: WebKit runs its `com.apple.WebKit.WebContent`, `.Networking`, and
  `.GPU` XPC services under `launchd`, not as children of `LeanDoc`. A
  harness must attribute them by their responsible process
  (`LeanDoc`), not by parentage.

## Packages

- Windows: `scripts/build.ps1` stages `dist/` (`LeanDoc.exe`,
  `WebView2Loader.dll`, `assets/`, `tools/leandoc-inspect.exe`, `README.md`,
  `LICENSE`, `THIRD_PARTY_NOTICES.md`), and `scripts/package-release.ps1`
  makes `LeanDoc-vX-windows-x64.zip` with the installer scripts and a
  `.sha256`. `leandoc-inspect.exe` ships in the ZIP under `tools/` because
  the owner's folder scan and bug reports use it; it is not on `PATH` and the
  winget alias points only at `LeanDoc.exe`.
- Linux: `scripts/package-linux.sh` builds the `.deb` with CPack, with the
  desktop entry, AppStream metadata, icons, and notices, and
  `tests/hosts/Test-DebianPackage.sh` checks its contents and dependencies.
- macOS: `macos/scripts/package-macos.sh` makes the ad-hoc signed universal
  ZIP, its `.sha256`, and `.metadata.json`, which states that the build is
  not notarized.
- winget: `packaging/winget/abooodbah.LeanDoc/<version>/` (schema 1.12.0).
  `winget validate` runs on `windows-latest` in CI (`scripts/Test-WingetManifest.ps1`);
  the runner's winget 1.11 reports "valid with warnings" because it does not
  know the 1.12.0 schema header, which the check accepts and reports.
  `scripts/Update-WingetManifest.mjs` fills `InstallerSha256` after the
  release.
