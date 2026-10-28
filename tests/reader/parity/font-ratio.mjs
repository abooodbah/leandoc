// Chromium's normal line height for fonts, measured at 1000 px so rounding
// to whole pixels does not matter, as a multiple of the font size.
import { launchBrowser } from "../fake-host.mjs";

const fonts = (process.argv[2] || "Aptos,Aptos Display,Calibri,Calibri Light,Cambria,Times New Roman,Arial,Georgia,Segoe UI,Verdana,Garamond,Book Antiqua,Courier New,Consolas,Tahoma").split(",");
const browser = await launchBrowser();
const page = await browser.newPage();
const out = await page.evaluate((fonts) => fonts.map((font) => {
  const span = document.createElement("div");
  span.style.cssText = `font-family:"${font}";font-size:1000px;line-height:normal;position:absolute;white-space:nowrap`;
  span.textContent = "Hxg";
  document.body.appendChild(span);
  const ratio = span.getBoundingClientRect().height / 1000;
  span.remove();
  return `${font}\t${ratio.toFixed(4)}`;
}), fonts);
console.log(out.join("\n"));
await browser.close();
