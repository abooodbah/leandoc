// Box geometry of the paragraphs starting at the one that contains a needle.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
const [file, needle, countArg] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const rows = await host.page.evaluate(({ needle, count }) => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  const ps = Array.from(document.querySelectorAll("#docBody section.docx article p"));
  const i = ps.findIndex((p) => p.textContent.includes(needle));
  return ps.slice(i, i + count).map((p) => {
    const s = getComputedStyle(p); const r = p.getBoundingClientRect();
    return `top ${(r.top * 0.75).toFixed(2)} h ${(r.height * 0.75).toFixed(2)}pt mt ${s.marginTop} mb ${s.marginBottom} lh ${s.lineHeight} fs ${s.fontSize} ${s.fontFamily.split(",")[0]} | ${p.textContent.slice(0, 30)}`;
  });
}, { needle, count: Number(countArg || 6) });
console.log(rows.join("\n"));
await host.close(); await browser.close();
