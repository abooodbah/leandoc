// Dumps the structure and line geometry of one body paragraph in normal layout.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
const [file, indexArg] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const r = await host.page.evaluate((index) => {
  const ps = Array.from(document.querySelectorAll("#docBody section.docx article p")).filter((p) => !p.closest("td"));
  const p = ps[index - 1];
  const pr = p.getBoundingClientRect();
  const st = getComputedStyle(p);
  const kids = Array.from(p.childNodes).slice(0, 6).map((n) => n.nodeType === 3 ? `#text(${JSON.stringify(n.data.slice(0, 20))})` : `<${n.tagName} style="${n.getAttribute("style")}" class="${n.className}">${JSON.stringify(n.textContent.slice(0, 20))} font=${getComputedStyle(n).font} ls=${getComputedStyle(n).letterSpacing} ws=${getComputedStyle(n).wordSpacing}`);
  const range = document.createRange(); range.selectNodeContents(p);
  const rects = Array.from(range.getClientRects()).filter((x) => x.width > 0);
  const lines = [];
  for (const x of rects) { const l = lines.find((y) => Math.abs(y.top - x.top) < 3); if (l) { l.left = Math.min(l.left, x.left); l.right = Math.max(l.right, x.right); } else lines.push({ top: x.top, left: x.left, right: x.right }); }
  return { box: { left: pr.left, right: pr.right, width: pr.width }, pad: [st.paddingLeft, st.paddingRight, st.marginLeft, st.marginRight, st.textIndent, st.textAlign, st.font], zoom: getComputedStyle(p.closest("section")).zoom, transform: getComputedStyle(p.closest(".docx-wrapper") || p).transform, kids, lines: lines.slice(0, 5).map((l) => [Math.round(l.left * 10) / 10, Math.round(l.right * 10) / 10, Math.round((l.right - l.left) * 10) / 10]) };
}, Number(indexArg));
console.log(JSON.stringify(r, null, 1));
await host.close(); await browser.close();
