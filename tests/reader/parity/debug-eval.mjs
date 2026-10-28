// Evaluates a JavaScript expression in the reader after a document opens.
//   node debug-eval.mjs file.docx "expression"
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";
const [file, expression] = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;
const o = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const report = JSON.parse(o[o.length - 1]);
const pkg = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-parity-")), "document.docx");
execFileSync(inspect, ["--write-sanitized", pkg, file], { stdio: "pipe" });
const browser = await launchBrowser();
const host = await FakeHost.open(browser, process.env.LEANDOC_ASSETS || stageAssets(), { viewport: { width: 1600, height: 1000 } });
await host.openDocument({ bytes: readFileSync(pkg), report, fileName: path.basename(file) });
console.log(JSON.stringify(await host.page.evaluate(expression), null, 1));
await host.close(); await browser.close();
