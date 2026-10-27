// From Word's line breaks (word-lines-json.ps1), estimates how far Word lets
// the spaces of a justified line shrink. For each line that is not the last
// of its paragraph:
//   need = how much each space had to shrink for Word's line to fit,
//   next = how much it would have had to shrink to also take the next word
//          (Word refused, so its limit is below that).
// Widths come from Chromium with the paragraph's font at its size.
//   node shrink.mjs lines.json
import { readFileSync } from "node:fs";
import { launchBrowser } from "../fake-host.mjs";

const rows = [].concat(JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^﻿/, "")));
const browser = await launchBrowser();
const page = await browser.newPage();
const out = await page.evaluate((paragraphs) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const results = [];
  for (const p of paragraphs) {
    const lines = [].concat(p.lines).map((l) => l.replace(/[\r\u0007\u000b]/g, ""));
    const px = p.size * 4 / 3;
    ctx.font = `${px}px "${p.font}"`;
    const space = ctx.measureText(" ").width;
    const avail = p.width * 4 / 3;
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].replace(/\s+$/, "");
      const nextWord = (lines[i + 1].match(/^\S+/) || [""])[0];
      const spaces = (line.match(/ /g) || []).length;
      const first = i === 0 ? p.firstIndent * 4 / 3 : 0;
      const room = avail - first;
      const w = ctx.measureText(line).width;
      const w2 = ctx.measureText(line + " " + nextWord).width;
      results.push({
        i: p.i, line: i + 1, align: p.align, size: p.size, spaces,
        over: w - room,
        need: spaces ? (w - room) / (spaces * space) : null,
        next: (w2 - room) / ((spaces + 1) * space),
        text: line.slice(-30)
      });
    }
  }
  return results;
}, rows);
await browser.close();

const fmt = (x) => (x === null ? "  -  " : x.toFixed(3));
for (const align of [0, 3]) {
  const set = out.filter((r) => r.align === align && r.spaces > 3);
  if (!set.length) continue;
  const needs = set.map((r) => r.need).filter((x) => x !== null);
  const nexts = set.map((r) => r.next);
  console.log(`align ${align === 3 ? "justify" : "left"}: ${set.length} lines`);
  console.log(`  largest shrink Word used:      ${fmt(Math.max(...needs))}`);
  console.log(`  smallest shrink Word refused:  ${fmt(Math.min(...nexts))}`);
  const sorted = [...set].sort((a, b) => b.need - a.need).slice(0, 6);
  sorted.forEach((r) => console.log(`   need ${fmt(r.need)} next ${fmt(r.next)} p${r.i} l${r.line} ...${r.text}`));
  const refused = [...set].sort((a, b) => a.next - b.next).slice(0, 4);
  refused.forEach((r) => console.log(`   refused at ${fmt(r.next)} (need ${fmt(r.need)}) p${r.i} l${r.line}`));
}
