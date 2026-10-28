// Dumps the box model of the first data cell of the n-th table.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
const [file, n] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
console.log(JSON.stringify(await host.page.evaluate((n) => {
  const t = document.querySelectorAll("#docBody article > table")[n - 1];
  const tr = t.rows[1], td = tr.cells[0], p = td.querySelector("p"), sp = p && p.querySelector("span");
  const cs = (e) => { const s = getComputedStyle(e); return { h: e.getBoundingClientRect().height * 0.75, pad: [s.paddingTop, s.paddingBottom], border: [s.borderTopWidth, s.borderBottomWidth], margin: [s.marginTop, s.marginBottom], font: s.fontSize + " " + s.fontFamily.split(",")[0], lh: s.lineHeight, va: s.verticalAlign, collapse: s.borderCollapse }; };
  return { table: cs(t), tr: cs(tr), td: cs(td), p: p && cs(p), span: sp && cs(sp), html: td.outerHTML.slice(0, 600) };
}, Number(n)), null, 1));
await host.close(); await browser.close();
