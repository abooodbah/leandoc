// Fills the winget installer manifest after a release is published.
//
//   node scripts/Update-WingetManifest.mjs
//       downloads LeanDoc-vX-windows-x64.zip from the GitHub Release, checks it
//       against the release's .sha256 sidecar, and writes InstallerSha256 and
//       ReleaseDate into packaging/winget/abooodbah.LeanDoc/X/
//   node scripts/Update-WingetManifest.mjs --zip release/LeanDoc-vX-windows-x64.zip
//       hashes a local ZIP instead (for a dry run before the release)
//   node scripts/Update-WingetManifest.mjs --check
//       only checks that InstallerUrl answers and matches the manifest hash
//
// Options: --version X (default: package.json), --date YYYY-MM-DD (default:
// today in UTC).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const option = (name) => {
  const index = argumentsList.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argumentsList[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
};

const version = option("--version") ?? JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;
const asset = `LeanDoc-${tag}-windows-x64.zip`;
const url = `https://github.com/abooodbah/leandoc/releases/download/${tag}/${asset}`;
const manifestPath = path.join(
  root, "packaging", "winget", "abooodbah.LeanDoc", version, "abooodbah.LeanDoc.installer.yaml");
let manifest = readFileSync(manifestPath, "utf8");

if (!manifest.includes(`InstallerUrl: ${url}`)) {
  throw new Error(`${manifestPath} does not point at ${url}`);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex").toUpperCase();

async function download(address) {
  const response = await fetch(address, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${address} answered HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

let digest;
const localZip = option("--zip");
if (localZip) {
  digest = sha256(readFileSync(path.resolve(localZip)));
  console.log(`Hashed local ${localZip}`);
} else {
  const zip = await download(url);
  digest = sha256(zip);
  const sidecar = (await download(`${url}.sha256`)).toString("utf8").trim();
  const match = sidecar.match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/);
  if (!match || match[2] !== asset) {
    throw new Error(`The release sidecar is malformed: ${sidecar}`);
  }
  if (match[1].toUpperCase() !== digest) {
    throw new Error(`The downloaded ZIP does not match its release sidecar (${match[1]}).`);
  }
  console.log(`Downloaded ${url} (${zip.length} bytes); it matches its .sha256 sidecar.`);
}

if (argumentsList.includes("--check")) {
  const recorded = manifest.match(/InstallerSha256: ([0-9A-F]{64})/);
  if (!recorded || recorded[1] !== digest) {
    throw new Error(`The manifest hash ${recorded ? recorded[1] : "(none)"} does not match ${digest}.`);
  }
  console.log("The winget manifest matches the published ZIP.");
} else {
  const date = option("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`--date must be YYYY-MM-DD: ${date}`);
  }
  manifest = manifest
    .replace(/InstallerSha256: [0-9A-Fa-f]{64}/, `InstallerSha256: ${digest}`)
    .replace(/^ReleaseDate: .*$/m, `ReleaseDate: ${date}`);
  writeFileSync(manifestPath, manifest);
  console.log(`Wrote InstallerSha256 ${digest} and ReleaseDate ${date} to ${path.relative(root, manifestPath)}.`);
}
