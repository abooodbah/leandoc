# Reader tests

These tests load the staged reader (`assets/` plus vendor files and fonts, as
`scripts/stage-runtime-assets.mjs` copies them) in Chromium with a fake host,
and check rendering, the fidelity bar, the chrome, and the host protocol.

```sh
npm ci --ignore-scripts
npm run test:reader
```

- `fixups.test.mjs`: unit tests for `assets/fixups.js` and
  `assets/fidelity.js` in plain Node.
- `run-reader-tests.mjs`: browser tests with the fake host in `fake-host.mjs`.
- `cases.json`: the fixture directory, the static reports file, each case's
  expectations, the fidelity wording cases, and the fallback cases. Repoint
  `fixtureDir` and `reportsFile` here and nowhere else.
- `make-dev-fixtures.py`: writes `dev-fixtures/*.docx` and
  `dev-fixtures/reports.json` (python-docx 1.2 and Pillow). The output is
  deterministic: fixed ZIP timestamps and core properties.
- `make-big-docx.mjs`: builds the 300-page document at test time with JSZip.

Screenshots of key states go to `artifacts/reader-screenshots/`, which git
ignores.

## Browser

The tests use `playwright-core` (pinned in `package.json`) with an existing
Chromium. They look in this order:

1. `LEANDOC_CHROMIUM`, a path to a Chromium or Chrome binary;
2. `/opt/pw-browsers/chromium-*/chrome-linux/chrome`, newest first;
3. `google-chrome`, `google-chrome-stable`, `chromium`, or `chromium-browser`
   on `PATH` (GitHub's Ubuntu runners have `google-chrome`).

## Reports and packages

Without configuration the fake host serves each fixture file unchanged and
uses the static report from `reports.json`, merged over a default report.

With `LEANDOC_INSPECT` set to the `leandoc-inspect` binary, the fake host runs
`leandoc-inspect FILE` and uses the last JSON line as the report, and runs
`leandoc-inspect --write-sanitized OUT FILE` to get the sanitized package it
serves. The fidelity wording tests always use their own synthetic reports.

## What the fake host does

- Serves the staged assets at `https://app.leandoc.invalid/`, the reader at
  `/reader.html`.
- Answers `/pkg/<tab>/<generation>/document.docx` from memory. Unknown paths
  answer 404.
- Aborts every request to any other origin and records it. Each test asserts
  that this list is empty, that no `securitypolicyviolation` event fired, and
  that the console has no errors.
- Injects `window.chrome.webview` before the page loads, as WebView2 does.
  The reader's `postMessage` calls reach the test through a Playwright binding.

## Host and reader contract

This is what stream C's hosts must match. SPEC section 4.3 lists the message
types.

### Reader to host

The reader posts every message as a **JSON string** (`JSON.stringify` of an
object with a `type`):

- WebView2: `window.chrome.webview.postMessage(text)`. Read it with
  `ICoreWebView2WebMessageReceivedEventArgs::TryGetWebMessageAsString`.
- WebKitGTK and WKWebView: `window.webkit.messageHandlers.leandoc.postMessage(text)`.
  Register a script message handler named `leandoc`; the body is a string
  (`jsc_value_to_string` on Linux, an `NSString` on macOS).

### Host to reader

A host delivers a message by dispatching a `leandoc-message` event on
`window` whose `detail` is the message object:

```js
window.dispatchEvent(new CustomEvent("leandoc-message", { detail: MESSAGE }));
```

- WebView2: `ExecuteScript(L"window.dispatchEvent(new CustomEvent('leandoc-message',{detail:" + json + L"}))")`.
- WebKitGTK: `webkit_web_view_evaluate_javascript()` with the same script and
  the JSON inlined, as LeanMark's `SendJson` does.
- WKWebView: `callAsyncJavaScript:@"window.dispatchEvent(new CustomEvent('leandoc-message',{detail: payload}))" arguments:@{@"payload": dictionary} ...`.

Two equivalent paths are also accepted, so LeanMark's host code can be kept:

- `window.LeanDocHost.receive(message)`, LeanMark's `LeanMarkHost.receive`
  renamed; and
- WebView2 `PostWebMessageAsJson(json)`, which the reader receives through
  `window.chrome.webview`'s `message` event.

In all three, `detail` or `message` may be the object or its JSON text.
Unknown types and text that is not JSON are ignored.

### Handshake

1. The page loads `reader.html`. Its scripts are deferred; the last one,
   `reader.js`, installs the listeners above and then posts `{"type":"ready"}`.
2. The host sends nothing before `ready`. A host that reloads the page waits
   for the next `ready`.
3. After `ready` the host sends, in this order: `host`, `theme`, `tabs` (hosts
   with tabs), then either `document`, `fallback`, or `empty`.
4. For each `document` the reader fetches `packageUrl` (same origin only,
   `fetch` with `cache: "no-store"`) and answers `rendered` or `renderFailed`
   with the message's `tab` and `generation`. It renders only the newest
   request; a result for an older one is discarded, never posted. A view
   switch renders again from the cached package and posts `rendered` again
   with the same generation; `pages` counts the rendered page sections (one
   or a few in reading view).

`document.documentElement.dataset.renderState` is `empty`, `loading`,
`ready`, `fallback`, or `failed`, and `dataset.pages` holds the page count,
for `--smoke-test` probes.

### Messages the reader relies on

Host to reader: `host` (`platform`: `windows`, `linux`, or `macos`, which
selects Command shortcuts; `editor.label` labels the "Open in ..." buttons,
which stay hidden until it is known; `tabs`), `theme` (`theme`, and `view`,
which switches the view without posting `setView`), `tabs`, `document`
(`report.outline[].paragraph`, also read as `paragraphIndex`), `fallback`,
`empty` (`recent`), `status`.

Reader to host: `ready`, `open`, `openRecent` {`path`}, `clearRecent`,
`openInEditor` {`tab`}, `link` {`href`} (only `http:`, `https:`, `mailto:`),
`setTheme` {`theme`}, `setView` {`view`}, `selectTab` {`id`}, `closeTab`
{`id`}, `reload` (F5, Ctrl+R), `rendered` {`tab`, `generation`, `pages`,
`ms`}, `renderFailed` {`tab`, `generation`, `message`}. Tab ids are posted back
with the type the host sent.

The reader keeps zoom for the session only and posts nothing for it.
