// The reader's layout of the first paragraphs, for comparison with
// word-paragraphs.ps1: page, top position on the page (pt), line count,
// computed font, size and line height, and the start of the text.
//
//   node reader-paragraphs.mjs file.docx out.json [count]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, outFile, countArg] = process.argv.slice(2);
const count = Number(countArg || 80);
const inspect = process.env.LEANDOC_INSPECT;
const lines = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(lines[lines.length - 1]);
const output = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", output, file], { stdio: "pipe" });

const assets = process.env.LEANDOC_ASSETS || stageAssets();
const browser = await launchBrowser();
try {
  const host = await FakeHost.open(browser, assets, { viewport: { width: 1600, height: 1000 } });
  await host.openDocument({ bytes: readFileSync(output), report, fileName: path.basename(file) });
  const rows = await host.page.evaluate((limit) => {
    document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
    const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
    const out = [];
    const pt = (px) => Math.round(px * 0.75 * 100) / 100;
    pages.forEach((page, pageIndex) => {
      const scale = page.getBoundingClientRect().width / page.offsetWidth || 1;
      const pageTop = page.getBoundingClientRect().top;
      for (const p of page.querySelectorAll("article p")) {
        if (out.length >= limit) {
          return;
        }
        if (p.closest("td")) {
          continue;
        }
        const rects = Array.from(p.getClientRects());
        const range = document.createRange();
        range.selectNodeContents(p);
        const lineTops = new Set(Array.from(range.getClientRects())
          .filter((rect) => rect.height > 0).map((rect) => Math.round(rect.bottom / scale)));
        const style = getComputedStyle(p);
        const box = rects[0] || p.getBoundingClientRect();
        out.push({
          page: pageIndex + 1,
          top: pt((box.top - pageTop) / scale),
          height: pt(p.getBoundingClientRect().height / scale),
          lines: lineTops.size,
          font: style.fontFamily.split(",")[0],
          size: style.fontSize,
          lineHeight: style.lineHeight,
          before: style.marginTop,
          after: style.marginBottom,
          text: p.textContent.replace(/\s+/g, " ").trim().slice(0, 50)
        });
      }
    });
    return out;
  }, count);
  writeFileSync(outFile, JSON.stringify(rows, null, 1));
  await host.close();
} finally {
  await browser.close();
}
