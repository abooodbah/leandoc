// Line breaks of the first paragraph that contains a needle: each line's
// text, and the paragraph's width and font, for comparison with Word's.
//   node debug-cell-lines.mjs file.docx needle
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
const [file, needle] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const out = await host.page.evaluate((needle) => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  const p = Array.from(document.querySelectorAll("#docBody section.docx article p")).find((el) => el.textContent.includes(needle));
  const s = getComputedStyle(p);
  const lines = [];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let top = null; let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (let i = 0; i < node.data.length; i += 1) {
      const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (!rect) { text += node.data[i]; continue; }
      if (top === null || Math.abs(rect.top - top) > 2) { if (top !== null) lines.push(text); text = ""; top = rect.top; }
      text += node.data[i];
    }
  }
  lines.push(text);
  const span = p.querySelector("span") || p;
  const ss = getComputedStyle(span);
  return [`width ${(p.getBoundingClientRect().width * 0.75).toFixed(2)}pt font ${ss.fontFamily} ${ss.fontSize} ls ${ss.letterSpacing} ws ${ss.wordSpacing} wrap ${s.overflowWrap} lh ${s.lineHeight}`].concat(lines);
}, needle);
console.log(out.join("\n"));
await host.close(); await browser.close();
