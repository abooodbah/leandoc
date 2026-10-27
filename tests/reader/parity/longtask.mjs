// Longest main-thread task while opening the 1,500-row table, for the
// assets in LEANDOC_ASSETS (or the repo's).
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
import { makeTablesDocx } from "../make-columns-docx.mjs";

const browser = await launchBrowser();
for (let run = 0; run < 3; run += 1) {
  const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), {});
  await host.page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => list.getEntries().forEach((entry) =>
      window.__longTasks.push(Math.round(entry.duration)))).observe({ type: "longtask" });
  });
  const { bytes, report } = await makeTablesDocx({ longRows: 1500 });
  const rendered = await host.openDocument({ bytes, report, fileName: "t.docx" });
  const longest = await host.page.evaluate(() => Math.max(0, ...window.__longTasks));
  console.log(`pages ${rendered.pages} longest ${longest} ms`);
  await host.close();
}
await browser.close();
