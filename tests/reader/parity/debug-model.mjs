// Dumps docx-preview's parsed model for the paragraphs around a needle: each
// element's type, cssStyle and children, to see how drawings are parsed.
//   node debug-model.mjs file.docx "needle text" [paragraphs-before]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const [file, needle, beforeArg] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
const bytes = readFileSync(pkg).toString("base64");
const out = await host.page.evaluate(async ({ bytes, needle, before }) => {
  const buffer = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)).buffer;
  const doc = await window.docx.parseAsync(buffer, { keepOrigin: true, experimental: true, ignoreLastRenderedPageBreak: false });
  const blocks = doc.documentPart.body.children;
  const text = (e) => (e.text || "") + (e.children || []).map(text).join("");
  const at = blocks.findIndex((b) => text(b).includes(needle));
  const show = (e, depth) => {
    const style = e.cssStyle ? JSON.stringify(e.cssStyle).slice(0, 160) : "";
    const own = e.type === "text" ? ` "${(e.text || "").slice(0, 30)}"` : "";
    const lines = [`${"  ".repeat(depth)}${e.type}${own} ${style}`];
    if (depth < 6) for (const c of e.children || []) lines.push(...show(c, depth + 1));
    return lines;
  };
  return blocks.slice(Math.max(0, at - before), at + 1).flatMap((b) => show(b, 0)).slice(0, 80).join("\n");
}, { bytes, needle, before: Number(beforeArg || 1) });
console.log(out);
await host.close();
await browser.close();
