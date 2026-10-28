// Tests models of Word's line breaking against Word's own breaks.
// A model = how one character's advance is measured (raw, or rounded to twips
// in some direction) + how far spaces may shrink in justified lines. A line
// is predicted right when Word's line fits and Word's line plus the next
// word does not. Uses regular-weight glyph advances without kerning.
//   node model.mjs lines-left.json lines-justified.json
import { readFileSync } from "node:fs";
import { launchBrowser } from "../fake-host.mjs";

const load = (f) => [].concat(JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")));
const [leftFile, justFile] = process.argv.slice(2);
const sets = { left: load(leftFile), justified: load(justFile) };
const browser = await launchBrowser();
const page = await browser.newPage();
const out = await page.evaluate((sets) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const cache = new Map();
  // Advance of one character in pt at the given size, unrounded.
  const adv = (font, size, ch) => {
    const k = `${font}|${ch}`;
    if (!cache.has(k)) { ctx.font = `1000px "${font}"`; cache.set(k, ctx.measureText(ch).width / 1000); }
    return cache.get(k) * size;
  };
  const rounders = {
    raw: (x) => x,
  };
  const unused = {
    twipCeil: (x) => Math.ceil(x * 20 - 1e-9) / 20,
    twipRound: (x) => Math.round(x * 20) / 20,
    px96Round: (x) => Math.round(x / 0.75) * 0.75,
    halfPt: (x) => Math.round(x * 2) / 2,
    // DirectWrite-style widths at 96 dpi rounded to 1/16 px
    sub16: (x) => Math.round(x / 0.75 * 16) / 16 * 0.75
  };
  const results = {};
  for (const [rname, rnd] of Object.entries(rounders)) {
    const models = [];
    for (const v of [0.18, 0.2, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28]) models.push(["space", v]);
    for (const v of [1, 2, 2.5, 3, 3.5, 4, 5]) models.push(["pt", v]);
    for (const v of [0.004, 0.006, 0.008, 0.01, 0.012]) models.push(["frac", v]);
    for (const [kind, shrink] of models) {
      let total = 0, ok = 0, okLeft = 0, totLeft = 0, okJ = 0, totJ = 0;
      for (const [setName, rows] of Object.entries(sets)) {
        for (const p of rows) {
          const lines = [].concat(p.lines).map((l) => l.replace(/[\r\u0007\u000b\u000c]/g, ""));
          const justify = p.align === 3;
          if (setName === "left" && justify) continue;
          if (setName === "justified" && !justify) continue;
          const font = p.font, size = p.size;
          const space = rnd(adv(font, size, " "));
          const width = (s) => { let w = 0; for (const ch of s) w += rnd(adv(font, size, ch)); return w; };
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].replace(/\s+$/, "");
            const next = (lines[i + 1].match(/^\S+/) || [""])[0];
            if (/-$/.test(line) || /-/.test(next)) continue;
            const spaces = (line.match(/ /g) || []).length;
            if (spaces < 4) continue;
            const room = p.width - (i === 0 ? p.firstIndent : 0);
            const s = justify ? shrink : 0;
            const allow = (n) => !justify ? 0 : kind === "space" ? shrink * n * space : kind === "pt" ? shrink : shrink * room;
            const fits = width(line) - allow(spaces) <= room + 1e-6;
            const nextFits = width(line + " " + next) - allow(spaces + 1) <= room + 1e-6;
            const good = fits && !nextFits;
            total++; if (good) ok++;
            if (justify) { totJ++; if (good) okJ++; } else { totLeft++; if (good) okLeft++; }
          }
        }
      }
      results[`${kind} ${shrink}`] = `${ok}/${total} (left ${okLeft}/${totLeft}, justified ${okJ}/${totJ})`;
    }
  }
  return results;
}, sets);
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(22)} ${v}`);
await browser.close();
