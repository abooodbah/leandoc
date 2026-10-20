import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const destinationArgument = process.argv[2];

if (!destinationArgument || process.argv.length !== 3) {
  throw new Error(
    "Usage: node scripts/stage-runtime-assets.mjs <assets-destination>"
  );
}

const destinationRoot = path.resolve(destinationArgument);
const authoredAssets = path.join(repositoryRoot, "assets");
const forbiddenDestinations = new Set([
  repositoryRoot,
  authoredAssets,
  path.join(repositoryRoot, "node_modules")
]);

if (forbiddenDestinations.has(destinationRoot)) {
  throw new Error(
    "The destination must be a dedicated build or package assets directory."
  );
}

function font(packageName, fileName) {
  return [
    `node_modules/@fontsource/${packageName}/files/${fileName}`,
    `fonts/${fileName}`
  ];
}

const files = [
  ["assets/reader.html", "reader.html"],
  ["assets/reader.css", "reader.css"],
  ["assets/reader.js", "reader.js"],
  ["assets/fixups.js", "fixups.js"],
  ["assets/fidelity.js", "fidelity.js"],
  ["node_modules/jszip/dist/jszip.min.js", "vendor/jszip.min.js"],
  ["node_modules/docx-preview/dist/docx-preview.min.js", "vendor/docx-preview.min.js"],
  font("ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2"),
  font("ibm-plex-sans", "ibm-plex-sans-latin-500-normal.woff2"),
  font("ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff2"),
  font("ibm-plex-serif", "ibm-plex-serif-latin-600-normal.woff2"),
  font("ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"),
  font("ibm-plex-sans-arabic", "ibm-plex-sans-arabic-arabic-400-normal.woff2"),
  font("ibm-plex-sans-arabic", "ibm-plex-sans-arabic-arabic-600-normal.woff2")
];

for (const [sourceRelative, destinationRelative] of files) {
  const source = path.join(repositoryRoot, sourceRelative);
  try {
    const sourceInfo = await stat(source);
    if (!sourceInfo.isFile()) {
      throw new Error("not a regular file");
    }
  } catch (error) {
    throw new Error(
      `Required runtime asset is missing: ${sourceRelative}. Run npm ci first. (${error.message})`
    );
  }

  const destination = path.join(destinationRoot, destinationRelative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(
  `Staged ${files.length} offline runtime assets in ${destinationRoot}`
);
