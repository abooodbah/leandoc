// Checks that a long document's far pages get their lines matched when
// scrolled near (matchWhenNear in reader.js).
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
import { makeBigDocx } from "../make-big-docx.mjs";

const browser = await launchBrowser();
const host = await FakeHost.open(browser, stageAssets(), {});
const { bytes, report } = await makeBigDocx(300);
await host.openDocument({ bytes, report, fileName: "big.docx" });
const state = () => host.page.evaluate(() => {
  const scroller = document.getElementById("docScroller");
  const pages = document.querySelectorAll("#docBody .docx-wrapper > section.docx");
  const last = pages[pages.length - 1];
  const rect = last.getBoundingClientRect();
  return {
    pages: pages.length,
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    lastTop: Math.round(rect.top),
    classes: Array.from(last.querySelectorAll("p")).slice(0, 2).map((p) => p.className)
  };
});
console.log(JSON.stringify(await state()));
await host.page.evaluate(() => {
  const pages = document.querySelectorAll("#docBody .docx-wrapper > section.docx");
  pages[pages.length - 1].scrollIntoView();
});
await new Promise((resolve) => setTimeout(resolve, 1500));
console.log(JSON.stringify(await state()));
await host.close();
await browser.close();
