// Lists the reader's drawing boxes (docx-preview's div per w:drawing): size,
// display, and whether they hold anything.
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
console.log((await host.page.evaluate(() => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  return Array.from(document.querySelectorAll("#docBody article svg")).slice(0, 12).map((d) => {
    const r = d.getBoundingClientRect(); const s = getComputedStyle(d);
    return `svg style="${d.getAttribute("style")}" w=${d.getAttribute("width")} h=${d.getAttribute("height")} -> ${Math.round(r.width)}x${Math.round(r.height)} display=${s.display} children=${d.children.length} parentP=${!!d.closest("p")}`;
  }).join("\n");
})));
await host.close(); await browser.close();
