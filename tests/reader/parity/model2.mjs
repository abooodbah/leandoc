// Compares two models of Word's justified line breaking against Word's own
// breaks, using Chromium's glyph advances (regular weight, no kerning):
//  fixed:   a line takes the next word when its spaces need to shrink by at
//           most `max` of a space;
//  balance: a line takes the next word when the shrink that needs is at most
//           `max` and smaller than `ratio` times the stretch the line would
//           need without it.
//   node model2.mjs lines.json [lines2.json ...]
import { readFileSync } from "node:fs";
import { launchBrowser } from "../fake-host.mjs";

const rows = process.argv.slice(2).flatMap((f) => [].concat(JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, ""))));
const browser = await launchBrowser();
const page = await browser.newPage();
const out = await page.evaluate((rows) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const cache = new Map();
  const adv = (font, size, ch) => {
    const k = `${font}|${ch}`;
    if (!cache.has(k)) { ctx.font = `1000px "${font}"`; cache.set(k, ctx.measureText(ch).width / 1000); }
    return cache.get(k) * size;
  };
  // Every justified line that is not its paragraph's last: Word's line, the
  // line without its last word, and the line with the next word.
  const cases = [];
  for (const p of rows) {
    if (p.align !== 3) continue;
    const lines = [].concat(p.lines).map((l) => l.replace(/[\r\u0007\u000b\u000c]/g, ""));
    const space = adv(p.font, p.size, " ");
    const width = (s) => { let w = 0; for (const ch of s) w += adv(p.font, p.size, ch); return w; };
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].replace(/\s+$/, "");
      const next = (lines[i + 1].match(/^\S+/) || [""])[0];
      if (/-$/.test(line) || /-/.test(next)) continue;
      const words = line.split(" ");
      if (words.length < 5) continue;
      const room = p.width - (i === 0 ? p.firstIndent : 0);
      const shorter = words.slice(0, -1).join(" ");
      cases.push({
        // per-space adjustments, as fractions of a space; + stretch, - shrink
        a: (room - width(line)) / ((words.length - 1) * space),
        b: (room - width(line + " " + next)) / (words.length * space),
        s: (room - width(shorter)) / ((words.length - 2) * space)
      });
    }
  }
  const results = [];
  const evaluate = (name, takes) => {
    let ok = 0;
    for (const c of cases) {
      // Word took the line (over the shorter one) and refused the next word.
      const tookLine = c.a >= 0 ? true : takes(-c.a, c.s);
      const refusedNext = !takes(-c.b, c.a);
      if (tookLine && refusedNext) ok++;
    }
    results.push([name, ok, cases.length]);
  };
  for (const max of [0.2, 0.22, 0.24, 0.25, 0.26, 0.28, 0.3]) {
    evaluate(`fixed max ${max}`, (shrink) => shrink <= max);
    for (const ratio of [1.5, 2, 2.5, 3, 4, 6, 10]) {
      evaluate(`balance max ${max} ratio ${ratio}`, (shrink, stretch) => shrink <= max && shrink * ratio < stretch);
    }
  }
  return results;
}, rows);
await browser.close();
out.sort((x, y) => y[1] - x[1]).slice(0, 15).forEach(([name, ok, n]) => console.log(`${String(ok).padStart(4)}/${n}  ${name}`));
