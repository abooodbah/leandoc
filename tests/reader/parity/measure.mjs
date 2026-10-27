// Measures strings in Chromium the ways the reader can lay them out.
import { launchBrowser } from "../fake-host.mjs";

const text = process.argv[2] || "overview of these techniques. The paper explains the considerations that drive the choice of how";
const browser = await launchBrowser();
const page = await browser.newPage();
await page.setContent(`<div id="a" style="font:16px 'Times New Roman';white-space:pre;display:inline-block"></div>
<div id="b" style="font:16px 'Times New Roman';white-space:pre;display:inline-block;text-rendering:geometricPrecision"></div>
<div id="c" style="font:160px 'Times New Roman';white-space:pre;display:inline-block"></div>`);
const result = await page.evaluate((t) => {
  for (const id of ["a", "b", "c"]) document.getElementById(id).textContent = t;
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = "16px 'Times New Roman'";
  const w = (id) => document.getElementById(id).getBoundingClientRect().width;
  return { span: w("a"), geometric: w("b"), big: w("c") / 10, canvas: ctx.measureText(t).width };
}, text);
console.log(JSON.stringify({ chars: text.length, ...result, wordLimitPx: 457.2 / 0.75 }, null, 1));
await browser.close();
