// For each justified line Word laid out, finds which word-spacing values
// (em) make the reader end that line exactly where Word did, given that the
// paragraph's earlier lines also matched. Prints, per line, the interval of
// good values, the line's space count, its natural width and the room.
//   node intervals.mjs file.docx lines.json > out.tsv
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, linesFile] = process.argv.slice(2);
const rows = [].concat(JSON.parse(readFileSync(linesFile, "utf8").replace(/^﻿/, "")));
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const values = [];
for (let v = 0; v >= -0.2001; v -= 0.005) values.push(Math.round(v * 1000) / 1000);

const result = await host.page.evaluate(({ paragraphs, values }) => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  const norm = (s) => s.replace(/[\s ]+/g, " ");
  const key = (s) => norm(s).replace(/[^\p{L}\p{N}]/gu, "");
  const all = Array.from(document.querySelectorAll("#docBody section.docx article p")).filter((p) => !p.closest("td"));
  const linesOf = (p) => {
    const out = [];
    let current = "", lastTop = null, lastLeft = 0;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.length; i++) {
        r.setStart(n, i); r.setEnd(n, i + 1);
        const rect = Array.from(r.getClientRects()).find((x) => x.width > 0);
        if (rect) {
          if (lastTop !== null && rect.top > lastTop + 3 && rect.left < lastLeft - 20) { out.push(current); current = ""; }
          lastTop = rect.top; lastLeft = rect.left;
        }
        current += n.data[i];
      }
    }
    out.push(current);
    return out;
  };
  const ends = (ls) => { let c = 0; return ls.map((l) => (c += key(l).length)); };
  const used = new Set();
  const rowsOut = [];
  for (const wp of paragraphs) {
    if (wp.align !== 3) continue;
    const wl = [].concat(wp.lines).map((l) => l.replace(/[\r\u0007\u000b\u000c]/g, ""));
    const head = key(wl.join("")).slice(0, 25);
    const p = all.find((el) => !used.has(el) && key(el.textContent).startsWith(head));
    if (!p) continue;
    used.add(p);
    const we = ends(wl);
    const good = wl.map(() => []);
    for (const v of values) {
      p.style.wordSpacing = v ? `${v}em` : "";
      const re = ends(linesOf(p));
      for (let li = 0; li < wl.length - 1; li++) {
        if (re[li] !== we[li]) break;
        if (li === 0 || re[li - 1] === we[li - 1]) good[li].push(v);
      }
    }
    p.style.wordSpacing = "";
    for (let li = 0; li < wl.length - 1; li++) {
      const g = good[li];
      rowsOut.push({ p: wp.i, line: li + 1, spaces: (wl[li].trim().match(/ /g) || []).length, chars: wl[li].length,
        lo: g.length ? Math.min(...g) : null, hi: g.length ? Math.max(...g) : null, n: g.length, tail: wl[li].trim().slice(-20) });
    }
  }
  return rowsOut;
}, { paragraphs: rows, values });
await host.close();
await browser.close();
console.log("p\tline\tspaces\tchars\tlo\thi\tn\ttail");
for (const r of result) console.log([r.p, r.line, r.spaces, r.chars, r.lo, r.hi, r.n, r.tail].join("\t"));
