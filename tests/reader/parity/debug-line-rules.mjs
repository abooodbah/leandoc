// Lists the shared line rules (#ldLineRules) each test document uses and how
// many elements carry each one.
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
import { makeBigDocx } from "../make-big-docx.mjs";
import * as columns from "../make-columns-docx.mjs";

const browser = await launchBrowser();
const assets = stageAssets();
const makers = Object.entries(columns).filter(([name]) => /^make.*Docx$/.test(name));
makers.push(["makeBigDocx", () => makeBigDocx(3)]);
for (const [name, make] of makers) {
  const host = await FakeHost.open(browser, assets, {});
  try {
    const { bytes, report } = await make();
    await host.openDocument({ bytes, report, fileName: `${name}.docx` });
    const rules = await host.page.evaluate(() => {
      const sheet = document.getElementById("ldLineRules");
      return sheet ? Array.from(sheet.sheet.cssRules).map((rule) => {
        const cls = rule.selectorText.split(".")[1];
        return `${document.querySelectorAll("." + cls).length}x ${rule.cssText}`;
      }) : [];
    });
    console.log(name, JSON.stringify(rules));
  } catch (error) {
    console.log(name, "ERR", String(error).slice(0, 100));
  }
  await host.close();
}
await browser.close();
