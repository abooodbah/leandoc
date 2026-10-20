// Rasterizes brand/leandoc-mark.svg with headless Chromium and writes the
// committed icon files:
//
//   src/windows/LeanDoc.ico      16, 24, 32, 48, 64, 128, and 256 px PNG frames
//   brand/leandoc-icon-256.png   Linux hicolor 256x256 and the site
//   brand/leandoc-icon-512.png   Linux hicolor 512x512
//   macos/LeanDoc.icns           16 to 1024 px PNG entries
//
// Usage: node scripts/build-brand-assets.mjs
// Chromium comes from LEANDOC_CHROMIUM, or the Playwright browser cache in
// /opt/pw-browsers or ~/.cache/ms-playwright.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markPath = path.join(root, "brand", "leandoc-mark.svg");

function findChromium() {
  if (process.env.LEANDOC_CHROMIUM) {
    return process.env.LEANDOC_CHROMIUM;
  }
  const caches = ["/opt/pw-browsers", path.join(os.homedir(), ".cache", "ms-playwright")];
  for (const cache of caches) {
    if (!existsSync(cache)) {
      continue;
    }
    const builds = readdirSync(cache)
      .filter((name) => /^chromium_headless_shell-\d+$/.test(name) || /^chromium-\d+$/.test(name))
      .sort()
      .reverse();
    for (const build of builds) {
      for (const candidate of [
        path.join(cache, build, "chrome-linux", "headless_shell"),
        path.join(cache, build, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        path.join(cache, build, "chrome-linux", "chrome")
      ]) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  throw new Error("Chromium was not found. Set LEANDOC_CHROMIUM to a Chromium executable.");
}

function pngSize(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Chromium did not write a PNG.");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function render(chromium, workDirectory, size) {
  const page = path.join(workDirectory, `mark-${size}.html`);
  const output = path.join(workDirectory, `mark-${size}.png`);
  writeFileSync(
    page,
    "<!doctype html><html><head><style>html,body{margin:0;padding:0;" +
      "background:transparent;overflow:hidden}img{display:block}</style></head>" +
      `<body><img src="${pathToFileURL(markPath).href}" width="${size}" height="${size}" alt=""></body></html>`
  );
  execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--user-data-dir=${path.join(workDirectory, "profile")}`,
      `--window-size=${size},${size}`,
      `--screenshot=${output}`,
      pathToFileURL(page).href
    ],
    { stdio: "ignore" }
  );
  const png = readFileSync(output);
  const actual = pngSize(png);
  if (actual.width !== size || actual.height !== size) {
    throw new Error(`Expected a ${size}px render, got ${actual.width}x${actual.height}.`);
  }
  return png;
}

// ICO with PNG-compressed frames, as Windows Vista and later read them.
function writeIco(frames, target) {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  writeFileSync(target, Buffer.concat([header, ...frames.map((frame) => frame.png)]));
}

// ICNS with PNG entries. Each type code names a pixel size.
function writeIcns(pngs, target) {
  const entries = [
    ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256],
    ["ic09", 512], ["ic10", 1024], ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512]
  ].map(([type, size]) => {
    const png = pngs.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  writeFileSync(target, Buffer.concat([head, body]));
}

const chromium = findChromium();
const work = mkdtempSync(path.join(os.tmpdir(), "leandoc-brand-"));
try {
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const pngs = new Map();
  for (const size of sizes) {
    pngs.set(size, render(chromium, work, size));
  }
  writeIco(
    [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngs.get(size) })),
    path.join(root, "src", "windows", "LeanDoc.ico")
  );
  writeFileSync(path.join(root, "brand", "leandoc-icon-256.png"), pngs.get(256));
  writeFileSync(path.join(root, "brand", "leandoc-icon-512.png"), pngs.get(512));
  writeIcns(pngs, path.join(root, "macos", "LeanDoc.icns"));
  console.log(`Rendered ${sizes.length} sizes with ${chromium}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
