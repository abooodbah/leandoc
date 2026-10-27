// Tries word-spacing values on justified paragraphs in the reader's real
// layout and counts how many of Word's line breaks (word-lines-json.ps1)
// each value reproduces. A line matches when the reader's line ends where
// Word's does.
//   node sweep.mjs file.docx lines.json [em values...]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, linesFile, ...valueArgs] = process.argv.slice(2);
const values = valueArgs.length ? valueArgs.map(Number) : [0, -0.02, -0.04, -0.05, -0.06, -0.07, -0.08, -0.1, -0.12];
const rows = [].concat(JSON.parse(readFileSync(linesFile, "utf8").replace(/^﻿/, "")));
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });

if (process.env.LEFT) {
  await host.page.evaluate(() => {
    for (const p of document.querySelectorAll("#docBody section.docx article p")) {
      if (getComputedStyle(p).textAlign === "justify") { p.style.textAlign = "left"; p.dataset.wasJustify = "1"; }
    }
  });
}
for (const value of values) {
  if (process.env.DETAIL) await host.page.evaluate(() => { window.__detailOn = true; });
  const score = await host.page.evaluate(({ paragraphs, value }) => {
    document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
    const norm = (s) => s.replace(/[\s ]+/g, " ");
    const key = (s) => norm(s).replace(/[^\p{L}\p{N}]/gu, "");
    const all = Array.from(document.querySelectorAll("#docBody section.docx article p")).filter((p) => !p.closest("td"));
    for (const p of all) {
      if (getComputedStyle(p).textAlign === "justify" || p.dataset.wasJustify) p.style.wordSpacing = value ? `${value}em` : "";
    }
    const linesOf = (p) => {
      const out = [];
      let current = "";
      let lastTop = null;
      let lastLeft = 0;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (let i = 0; i < n.length; i++) {
          r.setStart(n, i); r.setEnd(n, i + 1);
          const rect = Array.from(r.getClientRects()).find((x) => x.width > 0);
          if (rect) {
            // A new line goes down and back to the left; a superscript only
            // goes up or down a little and keeps moving right.
            if (lastTop !== null && rect.top > lastTop + 3 && rect.left < lastLeft - 20) { out.push(current); current = ""; }
            lastTop = rect.top;
            lastLeft = rect.left;
          }
          current += n.data[i];
        }
      }
      out.push(current);
      return out;
    };
    window.__detail = window.__detailOn ? [] : null;
    const used = new Set();
    let lines = 0, matched = 0, paras = 0, parasMatched = 0, justifyLines = 0, justifyMatched = 0;
    const diffs = [];
    for (const wp of paragraphs) {
      const wl = [].concat(wp.lines).map((l) => l.replace(/[\r\u0007\u000b\u000c]/g, ""));
      const head = key(wl.join("")).slice(0, 25);
      const p = all.find((el) => !used.has(el) && key(el.textContent).startsWith(head));
      if (!p) continue;
      used.add(p);
      const rl = linesOf(p);
      // Compare line ends by the cumulative letter count at each break.
      const ends = (ls) => { let c = 0; return ls.map((l) => (c += key(l).length)); };
      const we = ends(wl), re = new Set(ends(rl));
      paras++;
      let all_ok = wl.length === rl.length;
      const reArr = ends(rl);
      we.forEach((e, idx) => {
        lines++;
        const ok = re.has(e);
        if (!ok && window.__detail && window.__detail.length < 40) {
          const near = reArr.reduce((a, b) => (Math.abs(b - e) < Math.abs(a - e) ? b : a), 0);
          window.__detail.push(`p${wp.i} l${idx + 1} align${wp.align}: reader ends ${near - e > 0 ? "+" : ""}${near - e} letters vs Word | ${wl[idx].slice(-25)}`);
        }
        if (ok) matched++; else all_ok = false;
        if (wp.align === 3) { justifyLines++; if (ok) justifyMatched++; }
      });
      if (all_ok) parasMatched++;
      else if (diffs.length < 4) diffs.push(`p${wp.i} word ${wl.length} lines, reader ${rl.length}`);
    }
    return { detail: window.__detail, lines, matched, paras, parasMatched, justifyLines, justifyMatched, diffs };
  }, { paragraphs: rows, value });
  if (score.detail) console.log(score.detail.join(String.fromCharCode(10)));
  console.log(`word-spacing ${String(value).padStart(6)}em: line ends ${score.matched}/${score.lines} (justified ${score.justifyMatched}/${score.justifyLines}), paragraphs identical ${score.parasMatched}/${score.paras}  ${score.diffs.join("; ")}`);
}
await host.close();
await browser.close();
