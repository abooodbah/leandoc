// Renders .docx files in the reader the way the app does and records each
// page's first text, for comparison with Word's own pagination.
//
//   node tests/reader/parity/probe.mjs out.json file1.docx [file2.docx ...]
//
// LEANDOC_INSPECT must name leandoc-inspect, which writes the sanitized
// package the real hosts pass to the reader. LEANDOC_CHROMIUM may name the
// browser; LEANDOC_ASSETS may name an already staged asset folder.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [outFile, ...files] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
if (!outFile || files.length === 0 || !inspect) {
  console.error("usage: LEANDOC_INSPECT=... node probe.mjs out.json file.docx ...");
  process.exit(2);
}

function sanitize(file) {
  const lines = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
  const report = JSON.parse(lines[lines.length - 1]);
  const output = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
  execFileSync(inspect, ["--write-sanitized", output, file], { stdio: "pipe" });
  return { bytes: readFileSync(output), report };
}

const assets = process.env.LEANDOC_ASSETS || stageAssets();
const browser = await launchBrowser();
const results = [];
try {
  for (const file of files) {
    const started = Date.now();
    let host;
    try {
      const { bytes, report } = sanitize(file);
      host = await FakeHost.open(browser, assets, {
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: Number(process.env.LEANDOC_SCALE || 1)
      });
      const rendered = await host.openDocument({ bytes, report, fileName: path.basename(file) });
      const pages = await host.page.evaluate(() => {
        const norm = (text) => text.replace(/\s+/g, " ").trim();
        return Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).map((page) => {
          const articles = page.querySelectorAll("article");
          // Header rows repeated on a continued table are not in Word's text.
          const own = (node) => node.cloneNode(true);
          const text = norm(Array.from(articles.length ? articles : [page]).map((a) => {
            const copy = own(a);
            copy.querySelectorAll("[data-ld-repeated]").forEach((row) => row.remove());
            return copy.textContent;
          }).join(" "));
          return { first: text.slice(0, 80), text, height: page.offsetHeight };
        });
      });
      results.push({ file, pages: rendered.pages, ms: Date.now() - started, firsts: pages.map((page) => page.first), texts: pages.map((page) => page.text) });
      console.log(`${rendered.pages}\t${path.basename(file)}`);
    } catch (error) {
      results.push({ file, error: String(error) });
      console.log(`ERR\t${path.basename(file)}\t${String(error).slice(0, 200)}`);
    } finally {
      if (host) {
        await host.close();
      }
    }
  }
} finally {
  await browser.close();
}
writeFileSync(outFile, JSON.stringify(results, null, 1));
