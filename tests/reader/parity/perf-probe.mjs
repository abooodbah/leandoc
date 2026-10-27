// Times the reader on .docx files and records the page count, DOM size and
// JS heap after the render, to find what makes large documents slow.
//
//   node tests/reader/parity/perf-probe.mjs file1.docx [file2.docx ...]
//
// LEANDOC_INSPECT must name leandoc-inspect; LEANDOC_ASSETS may name an
// already staged asset folder (for comparing two builds).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeHost, launchBrowser, stageAssets } from "../fake-host.mjs";

const files = process.argv.slice(2);
const inspect = process.env.LEANDOC_INSPECT;

function sanitize(file) {
  const lines = execFileSync(inspect, [file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
  const report = JSON.parse(lines[lines.length - 1]);
  const output = path.join(mkdtempSync(path.join(os.tmpdir(), "leandoc-perf-")), "document.docx");
  execFileSync(inspect, ["--write-sanitized", output, file], { stdio: "pipe" });
  return { bytes: readFileSync(output), report };
}

const assets = process.env.LEANDOC_ASSETS || stageAssets();
const browser = await launchBrowser();
try {
  for (const file of files) {
    const { bytes, report } = sanitize(file);
    const host = await FakeHost.open(browser, assets, { viewport: { width: 1600, height: 1000 } });
    let cdp = null;
    if (process.env.LEANDOC_PROFILE) {
      cdp = await host.page.context().newCDPSession(host.page);
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
    }
    const started = Date.now();
    const rendered = await host.openDocument({ bytes, report, fileName: path.basename(file) });
    const ms = Date.now() - started;
    if (cdp) {
      // Inclusive time per function: a sample counts for every function on
      // its stack once.
      const { profile } = await cdp.send("Profiler.stop");
      const byId = new Map(profile.nodes.map((node) => [node.id, node]));
      const parent = new Map();
      profile.nodes.forEach((node) => (node.children || []).forEach((child) => parent.set(child, node.id)));
      const self = new Map();
      const total = new Map();
      const deltas = profile.timeDeltas;
      profile.samples.forEach((id, index) => {
        const dt = (deltas[index + 1] || 0) / 1000;
        const top = byId.get(id).callFrame;
        const own = `${top.functionName || "(anon)"}:${top.lineNumber + 1}`;
        self.set(own, (self.get(own) || 0) + dt);
        const seen = new Set();
        for (let at = id; at !== undefined; at = parent.get(at)) {
          const frame = byId.get(at).callFrame;
          const key = `${frame.functionName || "(anon)"}:${frame.lineNumber + 1} ${path.basename(frame.url || "")}`;
          if (!seen.has(key)) {
            seen.add(key);
            total.set(key, (total.get(key) || 0) + dt);
          }
        }
      });
      const top = (map) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([key, value]) => `  ${Math.round(value)} ms\t${key}`).join("\n");
      console.log("inclusive:\n" + top(total) + "\nself:\n" + top(self));
    }
    const stats = await host.page.evaluate(() => {
      const heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : NaN;
      const body = document.querySelector("#docBody");
      return {
        nodes: document.getElementsByTagName("*").length,
        styled: body ? body.querySelectorAll("[style]").length : 0,
        styleChars: body ? Array.from(body.querySelectorAll("[style]")).reduce((n, e) => n + e.getAttribute("style").length, 0) : 0,
        heap: Math.round(heap * 10) / 10,
        props: (() => {
          const counts = {};
          (body ? Array.from(body.querySelectorAll("[style]")) : []).forEach((e) => {
            for (let i = 0; i < e.style.length; i += 1) {
              const key = e.tagName.toLowerCase() + " " + e.style[i];
              counts[key] = (counts[key] || 0) + 1;
            }
          });
          return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
        })()
      };
    });
    if (process.env.LEANDOC_MEM && process.platform === "win32") {
      // Private bytes of every browser process, after the page settles: the
      // measure the perf budget (M-03, M-04) takes of the app's tree.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const bytesUsed = execFileSync("powershell", ["-NoProfile", "-Command",
        "(Get-Process chrome-headless-shell | Measure-Object PrivateMemorySize64 -Sum).Sum"], { encoding: "utf8" });
      stats.privateMiB = Math.round(Number(bytesUsed.trim()) / 1048576);
    }
    console.log(`${path.basename(file)}\tprivate ${stats.privateMiB ?? "-"} MiB\tpages ${rendered.pages}\t${ms} ms\tnodes ${stats.nodes}\tstyled ${stats.styled}\tstyleChars ${stats.styleChars}\theap ${stats.heap} MiB`);
    if (process.env.LEANDOC_PROPS) {
      console.log(stats.props.map(([key, count]) => `  ${count}\t${key}`).join("\n"));
    }
    await host.close();
  }
} finally {
  await browser.close();
}
