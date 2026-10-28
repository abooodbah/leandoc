// Width of the same sample text in Chromium, 12 pt (16 px), in pt.
import { launchBrowser } from "../fake-host.mjs";
const fonts = (process.argv[2] || "Calibri,Arial,Segoe UI,Verdana,Tahoma,Carlito,Liberation Sans").split(",");
const text = "The quick brown fox jumps over the lazy dog, then reads 1234567890 pages.";
const browser = await launchBrowser();
const page = await browser.newPage();
console.log((await page.evaluate(({ fonts, text }) => fonts.map((f) => {
  const c = document.createElement("canvas").getContext("2d"); c.font = `16px "${f}"`;
  return `${f}\t${(c.measureText(text).width * 0.75).toFixed(2)} pt`;
}), { fonts, text })).join("\n"));
await browser.close();
