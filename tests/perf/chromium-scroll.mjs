// P-10 in Chromium: the 300-page report (the core's sanitized package and
// report, from leandoc-inspect) in the real reader with the fake host,
// scrolled from top to bottom one step per animation frame. Records every
// frame interval; the gate is 95 percent of frames under 33 ms.
//   node tests/perf/chromium-scroll.mjs --inspect build/t/tools/inspect/leandoc-inspect \
//     --document artifacts/perf/documents/report-300.docx [--out DIR]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, networkAttempts, repositoryRoot, stageAssets } from "../reader/fake-host.mjs";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const inspect = path.resolve(argument("--inspect", path.join(repositoryRoot, "build", "t", "tools", "inspect", "leandoc-inspect")));
const document = path.resolve(argument("--document", path.join(repositoryRoot, "artifacts", "perf", "documents", "report-300.docx")));
const out = path.resolve(argument("--out", path.join(repositoryRoot, "artifacts", "perf")));
const steps = [Number(argument("--step", "400"))];
mkdirSync(out, { recursive: true });

const lines = execFileSync(inspect, [document], { encoding: "utf8" }).trim().split("\n");
const report = JSON.parse(lines[lines.length - 1]);
const sanitized = path.join(os.tmpdir(), `leandoc-scroll-${process.pid}.docx`);
execFileSync(inspect, ["--write-sanitized", sanitized, document], { stdio: "pipe" });
const bytes = readFileSync(sanitized);

const assets = stageAssets();
const browser = await launchBrowser();
const runs = [];
for (let run = 0; run < 3; run += 1) {
  const host = await FakeHost.open(browser, assets, { viewport: { width: 1280, height: 860 } });
  const rendered = await host.openDocument({ bytes, report, fileName: path.basename(document) });
  await host.page.waitForTimeout(500);
  const result = await host.page.evaluate(async (step) => {
    const scroller = document.getElementById("docScroller");
    const frames = [];
    let last = performance.now();
    await new Promise((resolve) => {
      function tick(now) {
        frames.push(now - last);
        last = now;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
          resolve();
          return;
        }
        scroller.scrollTop += step;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    frames.shift();
    const sorted = frames.slice().sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { frames: frames.length, p50: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1],
      under33: frames.filter((f) => f < 33).length / frames.length, distance: scroller.scrollHeight };
  }, steps[0]);
  runs.push({ pages: rendered.pages, readerMs: rendered.ms, ...result });
  await host.close();
}
await browser.close();
const p95 = runs.map((r) => r.p95).sort((a, b) => a - b)[1];
const share = runs.map((r) => r.under33).sort((a, b) => a - b)[1];
const summary = { measure: "P-10", browser: "Chromium headless shell", step: steps[0], document: path.basename(document),
  medianP95Ms: Math.round(p95 * 10) / 10, medianShareUnder33: Math.round(share * 1000) / 1000,
  pass: share >= 0.95 && networkAttempts.length === 0, runs };
writeFileSync(path.join(out, "perf-chromium-scroll.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, runs: undefined }));
process.exit(summary.pass ? 0 : 1);
