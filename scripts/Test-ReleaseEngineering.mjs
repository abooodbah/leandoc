// Release-engineering gates, modelled on LeanRows' Test-ReleaseEngineering.ps1.
// Runs on every CI operating system with only Node.js.
//
//   node scripts/Test-ReleaseEngineering.mjs            pull request checks
//   node scripts/Test-ReleaseEngineering.mjs --release  also requires the
//                                                       files a tag must ship
//
// It pins the package.json version across every file that names it, checks
// the writing rules in SPEC section 9 over tracked text files, checks that
// documented artifact names are ones the workflow creates, and checks the
// third-party notices.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseMode = process.argv.includes("--release");
const failures = [];
const notes = [];

const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => existsSync(path.join(root, relative));
function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const version = JSON.parse(read("package.json")).version;
check(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),
  `package.json version is not a release version: ${version}`);
const tag = `v${version}`;
const artifacts = [
  `LeanDoc-${tag}-windows-x64.zip`,
  `LeanDoc-${tag}-windows-x64.zip.sha256`,
  `LeanDoc-${tag}-linux-x86_64.deb`,
  `LeanDoc-${tag}-linux-x86_64.deb.sha256`,
  `LeanDoc-${tag}-macos-universal-preview.zip`,
  `LeanDoc-${tag}-macos-universal-preview.zip.sha256`,
  `LeanDoc-${tag}-macos-universal-preview.zip.metadata.json`
];
const extensions = ["docx", "dotx", "docm", "dotm", "doc", "rtf", "odt"];

// --- Version pins -----------------------------------------------------------

const rootCmake = read("CMakeLists.txt");
check(/string\(JSON LEANDOC_MANIFEST_VERSION GET "\$\{LEANDOC_PACKAGE_JSON\}" version\)/.test(rootCmake),
  "CMakeLists.txt must read the project version from package.json");
check(!/VERSION\s+"?\d+\.\d+\.\d+/.test(rootCmake.replace(/cmake_minimum_required\([^)]*\)/g, "")),
  "CMakeLists.txt must not hardcode a project version");

const metainfo = read("packaging/linux/io.github.abooodbah.leandoc.metainfo.xml.in");
const firstRelease = metainfo.match(/<release version="([^"]+)" date="(\d{4}-\d{2}-\d{2})"/);
check(firstRelease && firstRelease[1] === version,
  `AppStream metainfo must list ${version} as its newest release`);

if (exists("macos/Info.plist.in")) {
  const plist = read("macos/Info.plist.in");
  check(/<key>CFBundleShortVersionString<\/key>\s*<string>@PROJECT_VERSION@<\/string>/.test(plist),
    "macOS Info.plist must take its version from CMake");
}
check(read("src/windows/LeanDoc.manifest.in").includes('version="@PROJECT_VERSION@.0"'),
  "the Windows application manifest must take its version from CMake");
const resource = read("src/windows/LeanDoc.rc");
check(resource.includes("FILEVERSION LEANDOC_VERSION_MAJOR") &&
  !/\b\d+,\d+,\d+,\d+\b/.test(resource),
  "LeanDoc.rc must take its version from the generated header");

const changelog = read("CHANGELOG.md");
const firstHeading = changelog.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m);
check(firstHeading && firstHeading[1] === version,
  `CHANGELOG.md must start with the ${version} entry`);

const notesPath = `docs/releases/${tag}.md`;
check(exists(notesPath), `release notes are missing: ${notesPath}`);
if (exists(notesPath)) {
  const releaseNotes = read(notesPath);
  for (const artifact of artifacts.filter((name) => !name.endsWith(".sha256") &&
    !name.endsWith(".metadata.json"))) {
    check(releaseNotes.includes(artifact), `${notesPath} must name ${artifact}`);
  }
}

const install = read("installer/install.ps1");
const declared = install.match(/\$Extensions\s*=\s*@\(([^)]*)\)/);
check(declared && JSON.stringify([...declared[1].matchAll(/'\.([a-z]+)'/g)].map((m) => m[1]).sort()) ===
  JSON.stringify([...extensions].sort()),
  "installer/install.ps1 must register exactly the seven document extensions");
check(install.includes(`$FallbackVersion = '${version}'`),
  `installer/install.ps1 fallback version must be ${version}`);
check(read("scripts/package-release.ps1").includes("'LeanDoc-v{0}-windows-{1}'"),
  "scripts/package-release.ps1 must name the Windows ZIP LeanDoc-vX-windows-x64");

// --- winget manifests ---------------------------------------------------------

const wingetDirectory = `packaging/winget/abooodbah.LeanDoc/${version}`;
check(exists(wingetDirectory), `winget manifests are missing: ${wingetDirectory}`);
if (exists(wingetDirectory)) {
  const versionManifest = read(`${wingetDirectory}/abooodbah.LeanDoc.yaml`);
  const installer = read(`${wingetDirectory}/abooodbah.LeanDoc.installer.yaml`);
  const locale = read(`${wingetDirectory}/abooodbah.LeanDoc.locale.en-US.yaml`);
  for (const [name, text, kind] of [
    ["version", versionManifest, "version"],
    ["installer", installer, "installer"],
    ["locale", locale, "defaultLocale"]
  ]) {
    check(text.includes(`$schema=https://aka.ms/winget-manifest.${kind}.1.12.0.schema.json`),
      `winget ${name} manifest must use schema 1.12.0`);
    check(/^PackageIdentifier: abooodbah\.LeanDoc$/m.test(text),
      `winget ${name} manifest must use abooodbah.LeanDoc`);
    check(new RegExp(`^PackageVersion: ${escapeRegExp(version)}$`, "m").test(text),
      `winget ${name} manifest must pin ${version}`);
    check(/^ManifestVersion: 1\.12\.0$/m.test(text), `winget ${name} manifest version must be 1.12.0`);
    check(!text.includes("\t"), `winget ${name} manifest must not contain tabs`);
  }
  const url = `https://github.com/abooodbah/leandoc/releases/download/${tag}/LeanDoc-${tag}-windows-x64.zip`;
  check(installer.includes(`InstallerUrl: ${url}`), `winget InstallerUrl must be ${url}`);
  check(/^InstallerType: zip$/m.test(installer), "winget InstallerType must be zip");
  check(/^NestedInstallerType: portable$/m.test(installer), "winget nested installer must be portable");
  check(installer.includes(`RelativeFilePath: LeanDoc-${tag}-windows-x64\\LeanDoc.exe`),
    "winget RelativeFilePath must point into the ZIP's top-level folder");
  check(/PortableCommandAlias: leandoc$/m.test(installer), "winget alias must be leandoc");
  check(/^ArchiveBinariesDependOnPath: true$/m.test(installer),
    "winget must set ArchiveBinariesDependOnPath");
  check(/PackageIdentifier: Microsoft\.EdgeWebView2Runtime/.test(installer),
    "winget must declare the WebView2 runtime dependency");
  check(/InstallerSha256: [0-9A-F]{64}$/m.test(installer),
    "winget InstallerSha256 must be 64 upper-case hex digits");
  const listed = [...installer.matchAll(/^- (docx|dotx|docm|dotm|doc|rtf|odt)$/gm)].map((m) => m[1]);
  check(JSON.stringify(listed.sort()) === JSON.stringify([...extensions].sort()),
    "winget FileExtensions must list the seven document extensions");
  check(locale.includes(`ReleaseNotesUrl: https://github.com/abooodbah/leandoc/releases/tag/${tag}`),
    "winget ReleaseNotesUrl must point at this release");
  check(/^License: MIT$/m.test(locale) && /^Publisher: Abdulfatah Bahbouh$/m.test(locale),
    "winget locale must name the MIT licence and the publisher");
  if (releaseMode) {
    check(!/InstallerSha256: 0{64}$/m.test(installer),
      "a release needs the real InstallerSha256; run scripts/Update-WingetManifest.mjs");
  }
}

// --- Workflow and documented artifact names -----------------------------------

const workflow = read(".github/workflows/build.yml");
const workflowArtifacts = artifacts.map((name) =>
  name.replace(tag, "v${LEANDOC_VERSION}"));
for (const name of workflowArtifacts) {
  check(workflow.includes(`"${name}"`), `build.yml must verify the release asset ${name}`);
}
check(workflow.includes("--notes-file") && workflow.includes("docs/releases/${LEANDOC_TAG}.md"),
  "build.yml must publish notes from docs/releases/<tag>.md");
check(!workflow.includes("\t"), "build.yml must not contain tabs");

const documented = [];
for (const file of ["README.md", notesPath, "installer/README.md", "site/index.html"]) {
  if (!exists(file)) {
    continue;
  }
  for (const match of read(file).matchAll(/LeanDoc-v[0-9A-Za-z.${}-]+?-(?:windows|linux|macos)[0-9A-Za-z._-]*/g)) {
    documented.push([file, match[0].replace(/[.,)]+$/, "")]);
  }
}
for (const [file, name] of documented) {
  const normalized = name.replace(/v(?:\d+\.\d+\.\d+|X|\$\{[^}]+\})/, tag);
  check(artifacts.includes(normalized) || artifacts.some((artifact) => artifact.startsWith(`${normalized}.`)) ||
    artifacts.some((artifact) => artifact.replace(/\.(zip|deb)$/, "") === normalized),
    `${file} names ${name}, which the workflow does not create`);
}

// --- README and site version pins --------------------------------------------------

const downloadBase = `https://github.com/abooodbah/leandoc/releases/download/${tag}/`;
const downloadable = artifacts.filter((name) => /\.(zip|deb)$/.test(name));
const readme = read("README.md");
for (const artifact of downloadable) {
  check(readme.includes(`${downloadBase}${artifact}`), `README.md must link ${downloadBase}${artifact}`);
}
check(readme.includes(`https://github.com/abooodbah/leandoc/releases/tag/${tag}`),
  `README.md must link the ${tag} release page`);
for (const match of readme.matchAll(/releases\/(?:download|tag)\/(v[^/)\s]+)/g)) {
  check(match[1] === tag, `README.md links release ${match[1]}; package.json is ${version}`);
}
check(readme.includes("winget install abooodbah.LeanDoc"), "README.md must give the winget command");

if (exists("site/index.html")) {
  const site = read("site/index.html");
  const structured = site.match(/"softwareVersion":\s*"([^"]+)"/);
  check(structured && structured[1] === version,
    `site/index.html JSON-LD softwareVersion must be ${version}`);
  for (const artifact of downloadable) {
    check(site.includes(`href="${downloadBase}${artifact}"`), `site/index.html must link ${downloadBase}${artifact}`);
  }
  for (const match of site.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)) {
    check(match[1] === version, `site/index.html names v${match[1]}; package.json is ${version}`);
  }
} else {
  check(!releaseMode, "a release must ship site/index.html");
}

// --- Privacy policy and signing claims ------------------------------------------

// The Microsoft Store listing links github.com/abooodbah/leandoc#privacy, and
// the release notes link #privacy-policy, so both README sections must stay.
// SignPath Foundation declined the code signing application in October 2026
// (docs/code-signing.md), so no public text may credit SignPath.
const privacySentence = "This program will not transfer any information to other networked systems " +
  "unless specifically requested by the user or the person installing or operating it.";
check(/^## Privacy$/m.test(readme), 'README.md must keep its "Privacy" section (the Store listing links #privacy)');
check(/^## Privacy policy$/m.test(readme) && /^## Uninstall$/m.test(readme),
  'README.md must have "Privacy policy" and "Uninstall" sections');
check(readme.includes(privacySentence), "README.md must state the privacy policy sentence");
check(exists("docs/releases/TEMPLATE.md"), "docs/releases/TEMPLATE.md is missing");
if (exists("docs/releases/TEMPLATE.md")) {
  const template = read("docs/releases/TEMPLATE.md");
  check(template.includes(privacySentence), "docs/releases/TEMPLATE.md must state the privacy policy sentence");
  check(template.includes("https://github.com/abooodbah/leandoc#privacy-policy"),
    "docs/releases/TEMPLATE.md must link the README privacy policy");
}
for (const [file, text] of [["README.md", readme], ["docs/releases/TEMPLATE.md", read("docs/releases/TEMPLATE.md")]]) {
  check(!/Free code signing provided by|certificate by \[SignPath Foundation\]|^#{2,3} Code signing policy$/m.test(text),
    `${file} must not claim SignPath code signing`);
}

// The artifact configuration signs exactly the two LeanDoc programs and checks
// their product name and version; WebView2Loader.dll is Microsoft's.
const signpathConfigPath = ".signpath/artifact-configuration.xml";
check(exists(signpathConfigPath), `${signpathConfigPath} is missing`);
if (exists(signpathConfigPath)) {
  const config = read(signpathConfigPath);
  check(config.includes('xmlns="http://signpath.io/artifact-configuration/v1"'),
    `${signpathConfigPath} must use the SignPath artifact-configuration v1 namespace`);
  check(/<parameter name="version" required="true" \/>/.test(config),
    `${signpathConfigPath} must take the release version as a required parameter`);
  const signedFiles = [...config.matchAll(/<pe-file path="([^"]+)"([^>]*)>\s*<authenticode-sign \/>/g)];
  check(JSON.stringify(signedFiles.map((m) => m[1]).sort()) ===
    JSON.stringify(["LeanDoc.exe", "tools/leandoc-inspect.exe"]),
    `${signpathConfigPath} must sign exactly LeanDoc.exe and tools/leandoc-inspect.exe`);
  for (const [, file, attributes] of signedFiles) {
    check(attributes.includes('product-name="LeanDoc"') && attributes.includes('product-version="${version}"'),
      `${signpathConfigPath} must require ProductName LeanDoc and the release ProductVersion for ${file}`);
  }
  check(!/<(?!!--)[^>]*WebView2Loader/i.test(config.replace(/<!--[\s\S]*?-->/g, "")),
    `${signpathConfigPath} must never sign WebView2Loader.dll`);
}

// Both signed programs carry ProductName LeanDoc and the generated version.
const inspectResource = exists("tools/inspect/leandoc-inspect.rc") ? read("tools/inspect/leandoc-inspect.rc") : "";
for (const [file, text] of [["src/windows/LeanDoc.rc", resource], ["tools/inspect/leandoc-inspect.rc", inspectResource]]) {
  check(text.includes('VALUE "ProductName", "LeanDoc"'), `${file} must set ProductName to LeanDoc`);
  check(text.includes('VALUE "ProductVersion", LEANDOC_VERSION_STRING') &&
    text.includes("PRODUCTVERSION LEANDOC_VERSION_MAJOR") && !/\b\d+,\d+,\d+,\d+\b/.test(text),
    `${file} must take ProductVersion from the generated header`);
}
check(read("cmake/Hosts.cmake").includes(
  'target_sources(leandoc-inspect PRIVATE "${LEANDOC_ROOT}/tools/inspect/leandoc-inspect.rc")'),
  "cmake/Hosts.cmake must compile the leandoc-inspect version resource on Windows");

// The workflow signs only on a release tag once SignPath is configured, sends
// only the two programs, and packages the signed files with -Signed.
const signingGuard = "if: vars.SIGNPATH_ORGANIZATION_ID != '' && startsWith(github.ref, 'refs/tags/v')";
check(workflow.split(signingGuard).length - 1 === 3,
  "build.yml must guard the three signing steps with the SIGNPATH_ORGANIZATION_ID and tag condition");
for (const required of [
  "uses: signpath/github-action-submit-signing-request@v2",
  "organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}",
  "api-token: ${{ secrets.SIGNPATH_API_TOKEN }}",
  "project-slug: leandoc",
  "signing-policy-slug: release-signing",
  "github-artifact-id: ${{ steps.signing-input.outputs.artifact-id }}",
  "wait-for-completion: true",
  "output-artifact-directory: ${{ runner.temp }}/signed",
  "&& '-Signed' || ''"
]) {
  check(workflow.includes(required), `build.yml signing must include: ${required}`);
}
const signingUpload = workflow.match(/name: signing-input-windows-x64\s+path: \|\s+([\s\S]*?)\n\s+if-no-files-found/);
check(signingUpload && signingUpload[1].split(/\s+/).filter(Boolean).join(" ") ===
  "dist/LeanDoc.exe dist/tools/leandoc-inspect.exe",
  "build.yml must send exactly dist/LeanDoc.exe and dist/tools/leandoc-inspect.exe for signing");

// --- Notices --------------------------------------------------------------------

check(exists("THIRD_PARTY_NOTICES.md"), "THIRD_PARTY_NOTICES.md is missing");
check(!exists("docs/notices"), "docs/notices/ was merged into THIRD_PARTY_NOTICES.md; remove it");
if (exists("THIRD_PARTY_NOTICES.md")) {
  const notices = read("THIRD_PARTY_NOTICES.md");
  for (const required of ["docx-preview", "JSZip", "IBM Plex", "miniz", "pugixml", "WebView2"]) {
    check(notices.includes(required), `THIRD_PARTY_NOTICES.md must cover ${required}`);
  }
  check(notices.includes("Microsoft WebView2 SDK and Loader 1.0.4078.44"),
    "THIRD_PARTY_NOTICES.md must cover the WebView2 SDK and loader 1.0.4078.44");
  check(notices.includes("Apache License") && notices.includes("END OF TERMS AND CONDITIONS"),
    "THIRD_PARTY_NOTICES.md must carry the full Apache License 2.0 for docx-preview");
}

// --- Writing rules over tracked text files ---------------------------------------

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0").filter(Boolean);
  } catch {
    notes.push("git is unavailable; walked the tree instead of tracked files.");
    const skip = new Set([".git", "node_modules", "build", "dist", "obj", "release", "bin"]);
    const files = [];
    const walk = (relative) => {
      for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) {
            walk(child);
          }
        } else {
          files.push(child);
        }
      }
    };
    walk("");
    return files;
  }
}

const binary = /\.(png|ico|icns|docx|dotx|docm|dotm|doc|odt|woff2?|ttf|zip|deb|pdf|jpg|jpeg|gif)$/i;
// The spec and the handoff define the rules, and these checks enforce them, so
// they quote the banned phrases.
const ruleSources = new Set([
  "docs/SPEC.md", "docs/HANDOFF.md", "scripts/Test-ReleaseEngineering.mjs",
  "tests/reader/fixups.test.mjs"
]);
// Built from parts so this file does not contain the phrases it bans.
const join = (...parts) => parts.join("");
const bannedPhrases = [
  join("ultra", "-lightweight"), join("blazing", " fast"), join("zero", " dependency"),
  join("zero", "-dependency"), join("completely", " secure")
];
const attribution = [
  join("Co-Authored", "-By"), join("Claude", "-Session"), join("Generated", " with"),
  join("noreply", "@anthropic.com"), join("\u{1F916}")
];
const publicText = /^(README\.md|CHANGELOG\.md|site\/.*\.(html|md)|docs\/releases\/.*\.md|packaging\/.*|installer\/README\.md)$/;
const emDash = "\u2014";

for (const file of trackedFiles()) {
  if (binary.test(file) || file.startsWith("third_party/") || !exists(file) ||
      !statSync(path.join(root, file)).isFile()) {
    continue;
  }
  const text = read(file);
  check(!text.includes(emDash), `${file} contains an em dash`);
  if (!ruleSources.has(file)) {
    const lower = text.toLowerCase();
    for (const phrase of bannedPhrases) {
      check(!lower.includes(phrase), `${file} uses the banned phrase "${phrase}"`);
    }
    for (const marker of attribution) {
      check(!lower.includes(marker.toLowerCase()), `${file} contains AI attribution (${marker})`);
    }
  }
  if (publicText.test(file)) {
    check(!/\bsecure\b/i.test(text), `${file} claims "secure"; state what the code does instead`);
    check(!/no network access/i.test(text), `${file} claims "no network access"`);
  }
}

for (const note of notes) {
  console.log(`NOTE  ${note}`);
}
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL  ${failure}`);
  }
  console.error(`${failures.length} release-engineering check(s) failed.`);
  process.exit(1);
}
console.log(`LeanDoc ${version} release-engineering checks passed${releaseMode ? " (release mode)" : ""}.`);
