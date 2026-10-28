// Each top-level table's height in the reader (pt), summed over the pages a
// split table spans, with its row count and first text, for comparison with
// word-tables.ps1. Also lists images with their size.
//   node reader-tables.mjs file.docx
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const rows = await host.page.evaluate(() => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
  const out = [];
  pages.forEach((page, index) => {
    const article = page.querySelector("article") || page;
    for (const table of article.querySelectorAll(":scope > table")) {
      const text = table.textContent.replace(/\s+/g, " ").trim().slice(0, 40);
      out.push({ kind: "table", page: index + 1, rows: table.rows.length, height: table.getBoundingClientRect().height * 0.75,
        firstRow: table.rows[0] ? table.rows[0].getBoundingClientRect().height * 0.75 : 0, text });
    }
    for (const img of article.querySelectorAll("img, svg")) {
      if (img.closest("table")) continue;
      const r = img.getBoundingClientRect();
      if (r.height < 20) continue;
      const p = img.closest("p");
      out.push({ kind: "image", page: index + 1, height: r.height * 0.75, width: r.width * 0.75,
        paragraph: p ? p.getBoundingClientRect().height * 0.75 : 0, lineHeight: p ? getComputedStyle(p).lineHeight : "" });
    }
  });
  return out;
});
await host.close();
await browser.close();
for (const r of rows) {
  if (r.kind === "table") console.log(`table  R${r.page}  rows ${r.rows}  height ${r.height.toFixed(1)}pt  first row ${r.firstRow.toFixed(1)}pt  ${r.text}`);
  else console.log(`image  R${r.page}  ${r.width.toFixed(1)}x${r.height.toFixed(1)}pt  paragraph ${r.paragraph.toFixed(1)}pt  line-height ${r.lineHeight}`);
}
