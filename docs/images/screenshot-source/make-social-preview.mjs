// Renders social-preview.html to site/assets/social-preview.png (1280x640)
// with headless Chromium from playwright-core.
//   node docs/images/screenshot-source/make-social-preview.mjs
// Chromium comes from LEANDOC_CHROMIUM or the Playwright cache in
// /opt/pw-browsers or ~/.cache/ms-playwright.
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

function findChromium() {
  if (process.env.LEANDOC_CHROMIUM) {
    return process.env.LEANDOC_CHROMIUM;
  }
  for (const cache of ["/opt/pw-browsers", path.join(os.homedir(), ".cache", "ms-playwright")]) {
    if (!existsSync(cache)) {
      continue;
    }
    for (const build of readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const candidate = path.join(cache, build, "chrome-linux", "chrome");
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error("No Chromium found. Set LEANDOC_CHROMIUM.");
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--allow-file-access-from-files"]
});
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.goto(pathToFileURL(path.join(here, "social-preview.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
const output = path.join(root, "site", "assets", "social-preview.png");
await page.screenshot({ path: output });
await browser.close();
console.log(`Wrote ${output}`);
