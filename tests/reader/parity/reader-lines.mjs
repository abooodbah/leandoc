// The text of each line of one body paragraph as the reader lays it out, with
// the fonts its runs use and the width of the text column.
//   node reader-lines.mjs file.docx paragraphIndex(1-based, body paragraphs outside tables)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, indexArg] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const out = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(out[out.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const assets = process.env.LEANDOC_ASSETS || stageAssets();
const browser = await launchBrowser();
try {
  const host = await FakeHost.open(browser, assets, { viewport: { width: 1600, height: 1000 } });
  await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
  const result = await host.page.evaluate((index) => {
    document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
    const paragraphs = Array.from(document.querySelectorAll("#docBody section.docx article p")).filter((p) => !p.closest("td"));
    const p = paragraphs[index - 1];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const lines = [];
    let current = "";
    let lastTop = null;
    const range = document.createRange();
    const fonts = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const style = getComputedStyle(node.parentElement);
      fonts.add(`${style.fontFamily} ${style.fontSize} kern=${style.fontKerning} lig=${style.fontVariantLigatures} ls=${style.letterSpacing} ws=${style.wordSpacing}`);
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = Array.from(range.getClientRects()).find((r) => r.width > 0) || range.getBoundingClientRect();
        const top = Math.round(rect.top);
        if (lastTop !== null && top > lastTop + 3) {
          lines.push(current);
          current = "";
        }
        if (rect.width > 0 || lastTop === null) {
          lastTop = top;
        }
        current += node.data[i];
      }
    }
    lines.push(current);
    const article = p.closest("article");
    const ps = getComputedStyle(p);
    return {
      width: p.clientWidth * 0.75, articleWidth: article.clientWidth * 0.75,
      textAlign: ps.textAlign, paddingLeft: ps.paddingLeft, fonts: Array.from(fonts), lines
    };
  }, Number(indexArg));
  console.log(`paragraph width ${result.width}pt, article ${result.articleWidth}pt, align ${result.textAlign}`);
  result.fonts.forEach((font) => console.log(`font: ${font}`));
  result.lines.forEach((line, i) => console.log(`${String(i + 1).padStart(2)} [${String(line.length).padStart(3)}] ${line}`));
  await host.close();
} finally {
  await browser.close();
}
