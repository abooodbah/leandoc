#!/usr/bin/env node
// Downloads the public corpus listed in manifest.json into tests/corpus/cache/.
// The first download of a file records its SHA-256 in the manifest; later
// runs verify it. Pass --update to accept new upstream bytes.
//
// Behind an HTTPS proxy, Node's fetch needs NODE_USE_ENV_PROXY=1 (Node 22.21+).

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "manifest.json");
const cacheRoot = join(here, "cache");
const update = process.argv.includes("--update");
const maximumBytes = 64 * 1024 * 1024;

// Names are relative paths like "poi/sample.docx" and must stay in the cache.
function cachePath(name) {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._=&-]+)*$/.test(name) || name.split("/").includes("..")) {
    throw new Error(`unsafe corpus name: ${name}`);
  }
  const target = resolve(cacheRoot, name);
  if (relative(cacheRoot, target).startsWith("..")) {
    throw new Error(`unsafe corpus name: ${name}`);
  }
  return target;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) {
    throw new Error(`larger than ${maximumBytes} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) {
    throw new Error(`larger than ${maximumBytes} bytes`);
  }
  return bytes;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let changed = false;
let failures = 0;
let fetched = 0;
let cached = 0;

for (const file of manifest.files) {
  const target = cachePath(file.name);
  try {
    const existing = await readFile(target).catch(() => null);
    if (existing && file.sha256 && sha256(existing) === file.sha256) {
      cached += 1;
      continue;
    }
    const bytes = await download(file.url);
    const digest = sha256(bytes);
    if (file.sha256 && file.sha256 !== digest && !update) {
      throw new Error(`SHA-256 changed upstream (${digest}); rerun with --update to accept it`);
    }
    if (file.sha256 !== digest) {
      file.sha256 = digest;
      changed = true;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.partial`, bytes);
    await rename(`${target}.partial`, target);
    fetched += 1;
    console.log(`fetched ${file.name} (${bytes.length} bytes)`);
  } catch (error) {
    failures += 1;
    console.error(`FAILED ${file.name}: ${error.message}`);
  }
}

if (changed) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("recorded new SHA-256 values in manifest.json");
}
console.log(`${fetched} fetched, ${cached} already cached, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
