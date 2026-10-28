// Structure of reader pages: each section (article) with its columns and
// height, and each block with its size and position in the section.
//   node debug-page.mjs file.docx pageNumber [pageNumber ...]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, ...pageArgs] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const out = await host.page.evaluate((nums) => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
  return nums.map((n) => {
    const page = pages[n - 1];
    const lines = [`R${n} height=${page.offsetHeight} min=${getComputedStyle(page).minHeight}`];
    for (const a of page.querySelectorAll(":scope > article")) {
      const box = a.getBoundingClientRect();
      lines.push(`  article cols=${getComputedStyle(a).columnCount} h=${Math.round(box.height)} style="${a.getAttribute("style") || ""}"`);
      for (const b of a.children) {
        const r = b.getBoundingClientRect();
        lines.push(`    ${b.nodeName}.${String(b.className || "").slice(0, 36)} h=${Math.round(r.height)} w=${Math.round(r.width)} top=${Math.round(r.top - box.top)} left=${Math.round(r.left - box.left)} "${norm(b.textContent).slice(0, 40)}"`);
      }
    }
    return lines.join("\n");
  });
}, pageArgs.map(Number));
console.log(out.join("\n"));
await host.close();
await browser.close();
