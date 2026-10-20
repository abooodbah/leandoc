# Security policy

LeanDoc treats every document as untrusted input. Reports are welcome for the
core's ZIP and XML handling, the sanitized package, the reader, the native
hosts and their web runtime settings, the installer, the packages, and bundled
dependencies.

## What LeanDoc's code does

- The core reads one file within fixed limits, refuses DTDs and entity
  declarations, and writes a new package that holds only allow-listed parts.
  It removes macros, ActiveX and OLE payloads, external relationships other
  than web and mail hyperlinks, attached templates, linked images, and
  embedded fonts. The reader never receives the original file.
- The reader's Content Security Policy allows scripts, styles, fonts,
  images, and fetches only from LeanDoc's own app origin, which each host
  answers from its own files and memory.
- Hosts refuse navigation away from the app origin, new windows, downloads,
  permission requests, and script dialogs. Links open in the system handler
  only for `http`, `https`, and `mailto`, and only after a click.
- The editor is started with an argument list, never through a shell.

These describe the code. They are not a guarantee about the web runtime the
operating system provides.

## Supported versions

Fixes target the latest release and the `main` branch. Please check the
newest release before reporting.

## Report a vulnerability

Do not open a public issue with exploit details.

1. Open the repository's **Security** tab and choose **Report a
   vulnerability** to send a private report.
2. If private reporting is unavailable, open a minimal issue titled
   `Security contact requested`, with no technical details, documents, or
   proof of concept.

Please include, when you can:

- the LeanDoc version or commit;
- the operating system and the WebView2, WebKitGTK, or macOS version;
- steps to reproduce and a minimal, non-private test file;
- the impact and the user interaction it needs;
- a proof of concept or a suggested fix.

A maintainer will confirm the report and coordinate a fix and disclosure.
Please wait for the fix or an agreed date before publishing. Credit is given
on request.

Use the public bug form for crashes, rendering errors, and hardening ideas
that do not expose a vulnerability.
