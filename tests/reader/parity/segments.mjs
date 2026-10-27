// For each Word page (word-pages.ps1), how tall the same content is in the
// reader: the distance from where Word's page starts to where Word's next
// page starts, measured in the reader's layout. A Word page taller than the
// reader's text area did not fit, and is where the reader runs long.
//   node segments.mjs file.docx word.json
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, wordFile] = process.argv.slice(2);
const word = [].concat(JSON.parse(readFileSync(wordFile, "utf8").replace(/^﻿/, "")))
  .find((d) => path.resolve(d.file).toLowerCase() === path.resolve(file).toLowerCase());
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const rows = await host.page.evaluate((firsts) => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
  // All text in reading order with page index and a locator per character.
  const chars = [];
  pages.forEach((page, pageIndex) => {
    const article = page.querySelector("article") || page;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.length; i++) {
        if (/[\p{L}\p{N}]/u.test(n.data[i])) chars.push({ c: n.data[i].toLowerCase(), n, i, page: pageIndex });
      }
    }
  });
  const flat = chars.map((x) => x.c).join("");
  const key = (s) => (s || "").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase().slice(0, 30);
  const geometry = pages.map((page) => {
    const article = page.querySelector("article") || page;
    const style = getComputedStyle(page);
    const top = page.getBoundingClientRect().top + parseFloat(style.paddingTop);
    const height = page.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return { top, height };
  });
  let from = 0;
  const positions = firsts.map((first) => {
    const k = key(first);
    const at = k ? flat.indexOf(k, from) : -1;
    if (at < 0) return null;
    from = at + 1;
    const ch = chars[at];
    const r = document.createRange();
    r.setStart(ch.n, ch.i); r.setEnd(ch.n, ch.i + 1);
    const rect = r.getBoundingClientRect();
    return { page: ch.page, y: rect.top - geometry[ch.page].top };
  });
  const area = geometry.length ? geometry[0].height : 0;
  return { area, positions };
}, word.firsts);
await host.close();
await browser.close();
console.log(`text area ${rows.area.toFixed(0)} px; Word page -> reader height of its content (px), over = beyond one text area`);
const pos = rows.positions;
for (let i = 0; i < pos.length; i++) {
  const a = pos[i], b = pos[i + 1];
  if (!a || !b) { console.log(`W${i + 1}: ${a ? `starts R${a.page + 1}` : "not found"}`); continue; }
  const height = (b.page - a.page) * rows.area + (b.y - a.y);
  const over = height - rows.area;
  console.log(`W${String(i + 1).padStart(2)}: R${a.page + 1}@${a.y.toFixed(0)} -> R${b.page + 1}@${b.y.toFixed(0)}  height ${height.toFixed(0)}  over ${over > 0 ? "+" : ""}${over.toFixed(0)}  ${word.firsts[i].slice(0, 40)}`);
}
