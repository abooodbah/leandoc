// Compares Word's pagination (word-pages.ps1) with the reader's (probe.mjs).
//
//   node compare.mjs word.json reader.json [--detail]
//
// For each document: page counts, and how many of Word's page starts begin a
// reader page (matched on the first 30 letters and digits, ignoring spacing
// and punctuation). With --detail, lists every Word page start and the
// reader page where that text begins.
import { readFileSync } from "node:fs";
import path from "node:path";

const [wordFile, readerFile, flag] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
const word = [].concat(read(wordFile));
const reader = new Map([].concat(read(readerFile)).map((entry) => [path.resolve(entry.file).toLowerCase(), entry]));
const key = (text) => (text || "").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase().slice(0, 30);

let exact = 0;
let total = 0;
for (const doc of word) {
  const mine = reader.get(path.resolve(doc.file).toLowerCase());
  const name = path.basename(doc.file);
  total += 1;
  if (doc.error || !mine || mine.error) {
    console.log(`?? ${name}: ${doc.error || mine?.error || "no reader result"}`);
    continue;
  }
  const wordKeys = (doc.firsts || []).map(key);
  const readerKeys = (mine.firsts || []).map(key);
  let matched = 0;
  const detail = [];
  wordKeys.forEach((k, index) => {
    const at = k ? readerKeys.indexOf(k) : -1;
    if (at >= 0) {
      matched += 1;
    }
    let inside = "";
    if (at < 0 && mine.texts) {
      const pageKeys = mine.texts.map((text) => (text || "").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase());
      const found = pageKeys.findIndex((text) => k && text.includes(k));
      if (found >= 0) {
        const offset = pageKeys[found].indexOf(k);
        inside = ` (inside R${found + 1} at ${Math.round(100 * offset / Math.max(1, pageKeys[found].length))}%)`;
      }
    }
    detail.push(`  W${index + 1} -> ${at >= 0 ? `R${at + 1}` : "--"}${inside}  ${doc.firsts[index].slice(0, 50)}`);
  });
  const same = doc.pages === mine.pages;
  if (same) {
    exact += 1;
  }
  console.log(`${same ? "OK" : "XX"} Word ${doc.pages} / LeanDoc ${mine.pages} (${mine.pages - doc.pages >= 0 ? "+" : ""}${mine.pages - doc.pages}), starts ${matched}/${wordKeys.length}  ${name}`);
  if (flag === "--detail") {
    console.log(detail.join("\n"));
  }
}
console.log(`\n${exact}/${total} documents with the same page count`);
