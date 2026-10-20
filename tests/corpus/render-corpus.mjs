// S-05: every fetched corpus file through the real reader in headless
// Chromium (the fake host serves the core's sanitized package and report).
//   node tests/corpus/render-corpus.mjs --inspect build/t/tools/inspect/leandoc-inspect [--out DIR]
// Pass rule (TEST_PLAN S-05): no crash, no render over 10 s, no uncaught
// script error, no CSP violation, no network attempt; renderFailed cases are
// listed. Files the core rejects or LeanDoc does not render (legacy .doc and
// the like) are checked for their fallback page instead. Writes
// corpus-render.json and corpus-render.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, networkAttempts, repositoryRoot, stageAssets } from "../reader/fake-host.mjs";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const inspect = path.resolve(argument("--inspect", path.join(repositoryRoot, "build", "t", "tools", "inspect", "leandoc-inspect")));
const out = path.resolve(argument("--out", path.join(repositoryRoot, "artifacts", "corpus")));
const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "tests", "corpus", "manifest.json"), "utf8"));
const cache = path.join(repositoryRoot, "tests", "corpus", "cache");
const RENDERABLE = new Set(["docx", "docm", "dotx", "dotm"]);
mkdirSync(out, { recursive: true });

const assets = stageAssets();
const browser = await launchBrowser();
const rows = [];
let generation = 1;
for (const entry of manifest.files) {
  const file = path.join(cache, entry.name);
  const row = { name: entry.name, status: "pass", notes: [] };
  try {
    const lines = execFileSync(inspect, ["--time", file], { encoding: "utf8" }).trim().split("\n");
    const report = JSON.parse(lines[lines.length - 1]);
    row.kind = report.kind;
    row.errorCode = report.errorCode;
    const host = await FakeHost.open(browser, assets, {});
    try {
      if (report.ok && RENDERABLE.has(report.kind)) {
        const packagePath = path.join(os.tmpdir(), `leandoc-corpus-${process.pid}.docx`);
        execFileSync(inspect, ["--write-sanitized", packagePath, file], { stdio: "pipe" });
        const bytes = readFileSync(packagePath);
        const started = Date.now();
        const result = await host.openDocument({ bytes, report, fileName: path.basename(file), generation, wait: false })
          .then(() => host.waitFor((message) => (message.type === "rendered" || message.type === "renderFailed") &&
            message.generation === generation, 10000));
        row.ms = Date.now() - started;
        if (result.type === "renderFailed") {
          row.status = "renderFailed";
          row.notes.push(result.message);
        } else {
          row.pages = result.pages;
          row.readerMs = result.ms;
        }
      } else {
        await host.send({ type: "fallback", tab: 1, generation, fileName: path.basename(file),
          displayPath: file, report });
        const state = await host.page.evaluate(() => ({ state: document.documentElement.dataset.renderState,
          code: document.getElementById("statePane").dataset.code || "" }));
        row.fallback = state.code;
        if (state.state !== "fallback") {
          row.status = "fail";
          row.notes.push(`expected a fallback page, got ${state.state}`);
        }
      }
      generation += 1;
      const csp = await host.cspViolations();
      if (host.consoleErrors.length) {
        row.status = "fail";
        row.notes.push(`script errors: ${host.consoleErrors.slice(0, 3).join(" | ")}`);
      }
      if (csp.length || host.offOrigin.length || networkAttempts.length) {
        row.status = "fail";
        row.notes.push(`CSP ${csp.length}, off-origin ${host.offOrigin.length}, network ${networkAttempts.length}`);
      }
    } finally {
      await host.close();
    }
  } catch (error) {
    row.status = /Timed out/.test(String(error)) ? "hang" : "fail";
    row.notes.push(String(error.message || error).slice(0, 300));
  }
  rows.push(row);
  console.log(`${row.status.padEnd(12)} ${entry.name} ${row.pages ?? row.fallback ?? ""} ${row.ms ?? ""}ms ${row.notes.join("; ")}`);
}
await browser.close();

const failed = rows.filter((row) => row.status === "fail" || row.status === "hang");
const renderFailed = rows.filter((row) => row.status === "renderFailed");
writeFileSync(path.join(out, "corpus-render.json"), JSON.stringify({ browser: "Chromium headless shell", rows }, null, 2));
const table = ["| File | Kind | Result | Pages or fallback | ms | Notes |", "| --- | --- | --- | ---: | ---: | --- |",
  ...rows.map((row) => `| ${row.name} | ${row.kind ?? ""} | ${row.status} | ${row.pages ?? row.fallback ?? ""} | ${row.ms ?? ""} | ${row.notes.join("; ").replace(/\|/g, "/")} |`)];
writeFileSync(path.join(out, "corpus-render.md"), table.join("\n") + "\n");
console.log(`${rows.length} files: ${rows.length - failed.length - renderFailed.length} rendered or fell back cleanly, ` +
  `${renderFailed.length} renderFailed, ${failed.length} failed or hung.`);
process.exit(failed.length ? 1 : 0);
