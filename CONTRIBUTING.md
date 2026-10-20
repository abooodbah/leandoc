# Contributing to LeanDoc

Thank you for helping improve LeanDoc. Bug reports, focused feature ideas,
documentation fixes, tests, and code changes are welcome.

## Before you start

- Search existing issues before opening a new one.
- Use the bug or feature form so the report has what review needs.
- Follow [SECURITY.md](SECURITY.md) for vulnerabilities. Do not put security
  details in a public issue.
- Open a feature request before a large change, a new dependency, or a change
  to the installer, the core's limits, or the rendering architecture.
- Never attach a private document. Make a small file that shows the problem,
  or describe it with `leandoc-inspect` output.

## Development setup

Every build needs CMake 3.22 or newer and Node.js 20 or newer. Node.js only
stages the pinned reader packages and fonts at build time; LeanDoc does not
run it.

- Windows: Visual Studio 2022 or newer with the C++ workload, and the
  Microsoft Edge WebView2 Runtime. `scripts/build.ps1` downloads the pinned
  WebView2 SDK from nuget.org and checks its SHA-256.
- Ubuntu 24.04: a C++17 compiler, Ninja, pkg-config, and the GTK 4 and
  WebKitGTK 6.0 development packages (`libgtk-4-dev`,
  `libwebkitgtk-6.0-dev`).
- macOS 12 or later: Xcode or its command-line tools.

```sh
npm ci --ignore-scripts
```

Windows:

```powershell
.\scripts\build.ps1 -Configuration Release
.\tests\Test-LeanDoc.ps1 -Smoke -Runtime
.\scripts\package-release.ps1 -Version 0.1.0 -Platform x64
```

Linux:

```sh
cmake -S . -B build/linux -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_TESTING=ON -DLEANDOC_ENABLE_GUI_TESTS=ON
cmake --build build/linux
dbus-run-session -- ctest --test-dir build/linux --output-on-failure
bash scripts/package-linux.sh --version 0.1.0
```

macOS:

```sh
cmake -S . -B build/macos -G Xcode -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" -DBUILD_TESTING=ON
cmake --build build/macos --config Release
ctest --test-dir build/macos -C Release --output-on-failure
cmake --build build/macos --config Release --target package_macos
```

Reader tests run in Chromium with a fake host: `npm run test:reader`.

## Project layout

- `src/core/`: the portable C++ core that reads, checks, and sanitizes
  documents. `src/core/DocCore.h` is its contract.
- `tools/inspect/`: `leandoc-inspect`, the core on the command line.
- `assets/`: the shared reader page, styles, and scripts.
- `src/windows/`, `src/linux/`, `macos/`: the Win32 and WebView2, GTK and
  WebKitGTK, and AppKit and WKWebView hosts. See
  [docs/architecture/hosts.md](docs/architecture/hosts.md).
- `installer/`: the optional per-user Windows install and uninstall scripts.
- `packaging/`: Linux desktop metadata and winget manifests.
- `tests/`: core, reader, host, package, and owner measurement checks.

## Conventions

- Keep LeanDoc a focused, read-only viewer. Treat every document as
  untrusted input.
- Keep each host's navigation, origin, permission, download, and link rules
  unless the change explains why in review.
- C++17, and the formatting in `.editorconfig`.
- Pin every dependency. Update `THIRD_PARTY_NOTICES.md` when one changes.
- Add or update a fixture and a test when behaviour changes.
- Writing: plain, short sentences and no em dashes. Do not call LeanDoc
  "secure", do not claim it has no network access, and name the machine,
  method, and document for any time or memory figure.
  `node scripts/Test-ReleaseEngineering.mjs` checks the wording rules and the
  version pins.

## Release a version

Merge the version bump, the changelog entry, and `docs/releases/v<version>.md`
to `main`. Then either push an annotated `v<version>` tag on that commit, or run
the **Tag a release** workflow from the Actions tab with the version number.
Either route runs the full build on the tag and publishes the GitHub Release
with every asset and its `.sha256` file. The website deploys from `main` when
the release pull request merges.

## Submit a pull request

Keep the change focused, explain its visible effect, and link the issue. The
pull request template lists the checks. Contributions are made under the
repository's [MIT License](LICENSE).
