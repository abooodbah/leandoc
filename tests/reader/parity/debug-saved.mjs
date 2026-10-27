// Pages of the saved-start test document in the reader.
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
import { makeSavedStartAfterBreakDocx } from "../make-columns-docx.mjs";
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
const { bytes, report } = await makeSavedStartAfterBreakDocx();
const rendered = await host.openDocument({ bytes, report, fileName: "saved-start.docx" });
console.log("pages", rendered.pages);
console.log(JSON.stringify(await host.page.evaluate(() => [...document.querySelectorAll("#docBody .docx-wrapper > section.docx")].map((pg, i) => {
  const top = pg.getBoundingClientRect().top;
  return `P${i + 1}: ` + [...pg.querySelectorAll("article")].map((a) => `[${getComputedStyle(a).columnCount}] n=${a.children.length} last=` + (a.lastElementChild ? `${a.lastElementChild.outerHTML.slice(0, 120)} @${Math.round(a.lastElementChild.getBoundingClientRect().top - top)}` : "")).join(" ## ");
})), null, 1));
await host.close(); await browser.close();
