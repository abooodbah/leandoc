// Like shrink.mjs, but measures each Word line inside the reader's own
// rendering of the document, so bold, italic, superscripts and run fonts
// count. Each paragraph is laid out unwrapped and left-aligned; the width of
// the characters on each of Word's lines is then the natural width.
//   node shrink-dom.mjs file.docx lines.json
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, linesFile] = process.argv.slice(2);
const rows = [].concat(JSON.parse(readFileSync(linesFile, "utf8").replace(/^﻿/, "")));
const inspect = process.env.LEANDOC_INSPECT;
const out = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(out[out.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const assets = process.env.LEANDOC_ASSETS || stageAssets();
const browser = await launchBrowser();
const host = await FakeHost.open(browser, assets, { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
const results = await host.page.evaluate((paragraphs) => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
  const norm = (s) => s.replace(/[\s ]+/g, " ");
  const all = Array.from(document.querySelectorAll("#docBody section.docx article p")).filter((p) => !p.closest("td"));
  const used = new Set();
  const results = [];
  for (const wp of paragraphs) {
    const lines = [].concat(wp.lines).map((l) => l.replace(/[\r\u0007\u000b\u000c]/g, ""));
    const head = norm(lines.join("")).slice(0, 40).trim();
    const p = all.find((el) => !used.has(el) && norm(el.textContent).trim().startsWith(head.slice(0, 30)));
    if (!p) { results.push({ i: wp.i, missing: head }); continue; }
    used.add(p);
    const style = getComputedStyle(p);
    const avail = p.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const saved = [p.style.whiteSpace, p.style.textAlign, p.style.wordSpacing];
    p.style.whiteSpace = "pre"; p.style.textAlign = "left";
    // Text nodes with their offsets in the paragraph text.
    const nodes = [];
    let text = "";
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, at: text.length }); text += n.data; }
    const locate = (offset) => {
      for (let k = nodes.length - 1; k >= 0; k--) if (offset >= nodes[k].at) return [nodes[k].n, Math.min(offset - nodes[k].at, nodes[k].n.length)];
      return [nodes[0].n, 0];
    };
    const width = (a, b) => {
      const r = document.createRange();
      const [sn, so] = locate(a); const [en, eo] = locate(b);
      r.setStart(sn, so); r.setEnd(en, eo);
      const rects = Array.from(r.getClientRects());
      if (!rects.length) return 0;
      return Math.max(...rects.map((x) => x.right)) - Math.min(...rects.map((x) => x.left));
    };
    const spaceWidth = (() => { const s = text.indexOf(" "); return s >= 0 ? width(s, s + 1) : 4; })();
    const firstIndent = parseFloat(style.textIndent) || 0;
    let offset = 0;
    const flat = norm(text);
    // Walk Word's lines through the paragraph text (Word's text lacks list
    // labels the reader may add, so search forward for each line).
    for (let li = 0; li < lines.length; li++) {
      const wordLine = norm(lines[li]);
      const trimmed = wordLine.replace(/\s+$/, "");
      const at = text.replace(/[\s ]/g, " ").indexOf(trimmed.slice(0, 12), offset);
      if (at < 0) { results.push({ i: wp.i, line: li + 1, lost: trimmed.slice(0, 20) }); break; }
      const end = at + trimmed.length;
      if (li < lines.length - 1) {
        const nextLine = norm(lines[li + 1]);
        const nextWord = (nextLine.match(/^\S+/) || [""])[0];
        const spaces = (trimmed.match(/ /g) || []).length;
        const room = avail - (li === 0 ? firstIndent : 0);
        const w = width(at, end);
        const nextAt = text.replace(/[\s ]/g, " ").indexOf(nextWord, end);
        const w2 = nextAt >= 0 ? width(at, nextAt + nextWord.length) : null;
        results.push({
          i: wp.i, line: li + 1, align: wp.align, spaces, spaceWidth, w, w2, room, nextWord, nextAt, end,
          need: spaces ? (w - room) / (spaces * spaceWidth) : null,
          next: w2 === null ? null : (w2 - room) / ((spaces + 1) * spaceWidth),
          hyphen: /-$/.test(trimmed) || /-/.test(nextWord),
          text: trimmed.slice(-28)
        });
      }
      offset = end;
    }
    [p.style.whiteSpace, p.style.textAlign, p.style.wordSpacing] = saved;
  }
  return results;
}, rows);
await host.close();
await browser.close();

const lost = results.filter((r) => r.missing || r.lost);
if (lost.length) console.log(`unmatched: ${lost.length}`, lost.slice(0, 3));
if (process.env.DEBUG_P) console.log(results.filter((r) => r.i === Number(process.env.DEBUG_P)).slice(0, 4));
const fmt = (x) => (x === null || x === undefined ? "  -  " : x.toFixed(3));
for (const align of [0, 3]) {
  const set = results.filter((r) => r.align === align && r.spaces > 3 && !r.hyphen);
  if (!set.length) continue;
  const needs = set.map((r) => r.need);
  const nexts = set.map((r) => r.next).filter((x) => x !== null);
  console.log(`\nalign ${align === 3 ? "justify" : "left"}: ${set.length} lines (no hyphen breaks)`);
  console.log(`  largest shrink Word used:     ${fmt(Math.max(...needs))}`);
  console.log(`  smallest shrink Word refused: ${fmt(Math.min(...nexts))}`);
  [...set].sort((a, b) => b.need - a.need).slice(0, 5).forEach((r) => console.log(`   used ${fmt(r.need)} (next ${fmt(r.next)}) p${r.i} l${r.line} ...${r.text}`));
  [...set].filter((r) => r.next !== null).sort((a, b) => a.next - b.next).slice(0, 5).forEach((r) => console.log(`   refused ${fmt(r.next)} (used ${fmt(r.need)}) p${r.i} l${r.line} ...${r.text}`));
}
