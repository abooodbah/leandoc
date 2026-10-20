// Static policy checks of the GTK/WebKitGTK host and its packaging metadata.
// Each assertion names the guard it protects.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [host, header, main, editor, hosts, desktop, metainfo] = await Promise.all([
  read("src/linux/LinuxApp.cpp"),
  read("src/linux/LinuxApp.h"),
  read("src/linux/main.cpp"),
  read("src/linux/EditorChoice.h"),
  read("cmake/Hosts.cmake"),
  read("packaging/linux/io.github.abooodbah.leandoc.desktop"),
  read("packaging/linux/io.github.abooodbah.leandoc.metainfo.xml.in")
]);

for (const [guard, reason] of [
  [/webkit_network_session_new_ephemeral/, "WebKit data must stay nonpersistent"],
  [/WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER/, "the cache model must stay minimal"],
  [/webkit_web_context_register_uri_scheme\(webContext_, kScheme/, "one leandoc: scheme serves the app"],
  [/kReaderUrl\[\] = "leandoc:\/\/app\/reader\.html"/, "the reader origin is leandoc://app"],
  [/kPackagePrefix\[\] = "leandoc:\/\/app\/pkg\/"/, "packages are same-origin with the reader"],
  [/webkit_security_manager_register_uri_scheme_as_secure/, "the scheme must be secure"],
  [/"Access-Control-Allow-Origin", kAppOrigin/, "CORS answers name only the app origin"],
  [/"X-Content-Type-Options", "nosniff"/, "responses must not be sniffed"],
  [/"Cache-Control", "no-store"/, "responses must not be cached"],
  [/tab != packageTab_ \|\| generation != packageGeneration_ \|\| tab != activeTab_/,
    "only the active tab's current package is served"],
  [/FinishNotFound\(request\)/, "unknown paths answer 404"],
  [/core::IsPathWithin\(assetRoot_, candidate\)/, "assets stay inside the asset root"],
  [/segment == "\." \|\| segment == "\.\."/, "dot segments are refused"],
  [/script-message-received::leandoc/, "the reader bridge is window.webkit.messageHandlers.leandoc"],
  [/webkit_web_view_get_uri\(app->webView_\), kReaderUrl/, "messages are accepted only from the reader"],
  [/new CustomEvent\(\\"leandoc-message\\"/, "host messages arrive as a leandoc-message event"],
  [/WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION/, "navigation is decided by the host"],
  [/WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION/, "new windows are refused"],
  [/webkit_permission_request_deny/, "permission requests are denied"],
  [/WEBKIT_PERMISSION_STATE_DENIED/, "permission queries answer denied"],
  [/webkit_download_cancel/, "downloads are cancelled"],
  [/webkit_script_dialog_close/, "script dialogs are closed"],
  [/webkit_file_chooser_request_cancel/, "page file choosers are cancelled"],
  [/core::NormalizeExternalLink\(hrefView\)/, "links pass the shared rule (web and mail only, mailto rebuilt)"],
  [/g_app_info_launch_default_for_uri\(href->c_str\(\)/, "links open through the desktop handler"],
  [/g_signal_connect\(webView_, "context-menu", G_CALLBACK\(OnContextMenu\)/, "the context menu is filtered"],
  [/recoveriesInWindow_ > 4/, "renderer recoveries are capped"],
  [/"notify::focus-widget"/, "the keyboard focus returns to the web view"],
  [/malloc_trim\(0\)/, "freed heap pages go back to the system after a document is shown or dropped"],
  [/g_filename_to_uri\(path\.c_str\(\)/, "recent paths are stored as file URIs"],
  [/DefaultAppForFile\(path\)/, "the default editor is looked up per file type"],
  [/g_subprocess_newv\(argv/, "editors start with an argument vector"],
  [/g_app_info_launch\(/, "desktop entries start through GIO"],
  [/GDK_TYPE_FILE_LIST/, "dropped files open as tabs"],
  [/gtk_file_dialog_open_multiple/, "the open dialog accepts several files"],
  [/kMaximumRecent = 10/, "recent files are capped at ten"],
  [/"leandoc" \/ "settings\.ini"/, "settings live in $XDG_CONFIG_HOME/leandoc/settings.ini"],
  [/g_file_monitor_directory/, "the active file is watched for changes"],
  [/securitypolicyviolation/, "the smoke test counts CSP violations"],
  [/if \(testScript_ && !scriptStarted_\)/, "the test script hook runs only with --test-script"]
]) {
  assert.match(host, guard, `Linux host guard is missing: ${reason}`);
}

assert.doesNotMatch(host, /webkit_security_manager_register_uri_scheme_as_local/,
  "a local scheme cannot load blob: URLs, so every image would be an empty frame");
assert.doesNotMatch(host, /register_uri_scheme_as_cors_enabled/,
  "the scheme does not need to be CORS-enabled; answers name the app origin");
assert.doesNotMatch(host, /Access-Control-Allow-Origin", "\*"/,
  "a wildcard CORS answer would let any origin read packages");
assert.doesNotMatch(host, /webkit_web_context_set_sandbox_enabled/,
  "WebKitGTK 6.0 sandboxing is mandatory; the removed toggle must not be used");
for (const source of [host, main]) {
  assert.doesNotMatch(source, /\b(?:system|popen|execl|execlp|execv|execvp|fork)\s*\(/,
    "no shell or raw process API may be used");
  assert.doesNotMatch(source, /g_spawn_command_line/,
    "commands are never built as shell strings");
}
assert.match(header, /WebKitNetworkSession\* networkSession_/,
  "the ephemeral network session has explicit host ownership");
assert.match(main, /G_APPLICATION_HANDLES_OPEN/,
  "a later launch hands its files to the running window");
assert.match(main, /G_APPLICATION_NON_UNIQUE/,
  "the smoke test never joins a running reader");
assert.match(main, /g_application_get_is_remote/,
  "a second launch forwards and exits");

assert.match(editor, /Open in LibreOffice/);
assert.match(editor, /Open Word for the web/);
assert.match(editor, /https:\/\/www\.office\.com\/launch\/word/);

assert.match(hosts, /pkg_check_modules\(GTK4[^\n]*gtk4>=4\.10/);
assert.match(hosts, /pkg_check_modules\(WEBKITGTK[^\n]*webkitgtk-6\.0>=2\.44/);
assert.match(hosts, /scripts\/stage-runtime-assets\.mjs/);
assert.match(hosts, /CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON/);
assert.match(hosts, /"LeanDoc-v\$\{PROJECT_VERSION\}-linux-\$\{LEANDOC_RELEASE_ARCHITECTURE\}"/);

assert.match(desktop, /^Exec=leandoc %F$/m);
for (const type of [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  "application/vnd.ms-word.document.macroEnabled.12",
  "application/vnd.ms-word.template.macroEnabled.12",
  "application/msword",
  "application/rtf",
  "application/vnd.oasis.opendocument.text"
]) {
  assert.ok(desktop.includes(`${type};`), `desktop file must list ${type}`);
  assert.ok(metainfo.includes(`<mediatype>${type}</mediatype>`), `metainfo must list ${type}`);
}
assert.match(metainfo, /<id>io\.github\.abooodbah\.leandoc<\/id>/);
assert.match(metainfo, /<launchable type="desktop-id">io\.github\.abooodbah\.leandoc\.desktop<\/launchable>/);

console.log("LeanDoc Linux source policy checks passed.");
