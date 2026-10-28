// Where the page-flow test document's markers land in the reader.
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
import { makePageFlowDocx } from "../make-columns-docx.mjs";
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
const { bytes, report } = await makePageFlowDocx();
const rendered = await host.openDocument({ bytes, report, fileName: "page-flow.docx" });
console.log("pages", rendered.pages);
console.log(JSON.stringify(await host.page.evaluate(() => {
  document.querySelectorAll("section.docx.ld-lazy").forEach((p) => p.classList.remove("ld-lazy"));
  const pages = [...document.querySelectorAll("#docBody .docx-wrapper > section.docx")];
  const out = {};
  for (const marker of ["Plain para 1", "Raised para", "Header marker owl", "Short row", "Tall row start", "Tall row end", "Whole row start", "Whole row end", "Numbered start", "Numbered end", "Closing para"]) {
    out[marker] = pages.map((p, i) => [...p.querySelectorAll("article")].some((a) => a.textContent.includes(marker)) ? i + 1 : 0).filter(Boolean).join(",");
  }
  out.repeated = pages.map((p) => p.querySelectorAll("tr[data-ld-repeated]").length).join(",");
  out.footers = pages.map((p) => { const f = p.querySelector("footer"); return f ? f.children.length + ":" + f.textContent.trim() : "-"; }).join(" | ");
  out.numberMarkers = pages.map((p) => [...p.querySelectorAll("p")].filter((q) => q.textContent.includes("Numbered") || q.hasAttribute("data-ld-continued") && /docx-num-/.test(q.className)).map((q) => getComputedStyle(q, "::before").content).join("/")).join(" | ");
  const line = (text) => { const p = [...document.querySelectorAll("p")].find((q) => q.textContent.startsWith(text)); return p.getBoundingClientRect().height; };
  out.raisedHeight = line("Raised para"); out.plainHeight = line("Plain para 2");
  return out;
}), null, 1));
await host.close(); await browser.close();
