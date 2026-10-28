// Page-by-page contents of the synthetic columns document (run-reader-tests).
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
import { makeColumnsDocx } from "../make-columns-docx.mjs";
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
const { bytes, report } = await makeColumnsDocx();
await host.openDocument({ bytes, report, fileName: "columns.docx" });
console.log(JSON.stringify(await host.page.evaluate(() => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((p) => p.classList.remove("ld-lazy"));
  return [...document.querySelectorAll("#docBody .docx-wrapper > section.docx")].map((pg, i) => {
    const top = pg.getBoundingClientRect().top;
    return `P${i + 1}: ` + [...pg.querySelectorAll("article")].map((a) => `[${getComputedStyle(a).columnCount}] ` + [...a.children].map((c) => {
      const b = c.getBoundingClientRect();
      return `${c.nodeName}${c.hasAttribute("data-ld-continued") ? "+" : ""}@${Math.round(b.left)},${Math.round(b.top - top)} ${c.textContent.slice(0, 12)}`;
    }).join(" | ")).join(" ## ");
  });
}), null, 1));
await host.close(); await browser.close();
