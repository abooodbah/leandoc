// TEMPORARY stub for host development. Stream B replaces it with the real
// stage script that also copies vendor/ and fonts/ from node_modules.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = process.argv[2];
if (!destination || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/stage-runtime-assets.mjs <dest>");
}
const target = path.resolve(destination);
await mkdir(target, { recursive: true });
for (const name of ["reader.html", "reader.css", "reader.js"]) {
  await copyFile(path.join(root, "assets", name), path.join(target, name));
}
console.log(`Staged 3 stub reader assets in ${target}`);
