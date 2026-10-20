// Usage: node spike.mjs <dir with node_modules> <docx-preview|mammoth> <file.docx> [runs]
import { createRequire } from "node:module";
const { chromium } = createRequire(process.argv[2] + "/")("playwright-core");
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
const S = process.argv[2], engine = process.argv[3], doc = process.argv[4], runs = +(process.argv[5]||5);
const nm = S + "/node_modules/";
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'";
const files = {
  "/index.html": `<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="${csp}"><body><div id=c></div><script src="/jszip.js"></script><script src="/docx-preview.js"></script><script src="/mammoth.js"></script></body>`,
  "/jszip.js": readFileSync(nm + "jszip/dist/jszip.min.js"),
  "/docx-preview.js": readFileSync(nm + "docx-preview/dist/docx-preview.min.js"),
  "/mammoth.js": readFileSync(nm + "mammoth/mammoth.browser.min.js"),
};
function treeKiB(rootPid) {
  // sum Pss of browser process tree
  const all = execSync("ps -e -o pid=,ppid=").toString().trim().split("\n").map(l => l.trim().split(/\s+/).map(Number));
  const kids = new Set([rootPid]); let grew = true;
  while (grew) { grew = false; for (const [p, pp] of all) if (kids.has(pp) && !kids.has(p)) { kids.add(p); grew = true; } }
  let pss = 0, priv = 0;
  for (const p of kids) { try { const r = readFileSync(`/proc/${p}/smaps_rollup`, "utf8");
    pss += +r.match(/^Pss:\s+(\d+)/m)[1]; priv += +r.match(/^Private_Clean:\s+(\d+)/m)[1] + +r.match(/^Private_Dirty:\s+(\d+)/m)[1]; } catch {} }
  return { pss, priv, procs: kids.size };
}
const bytes = readFileSync(doc).toString("base64");
const results = [];
for (let i = 0; i < runs; i++) {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-software-rasterizer"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const blocked = [];
  await page.route("**/*", (route) => { const u = new URL(route.request().url());
    if (u.hostname === "app.leandoc.invalid" && files[u.pathname]) return route.fulfill({ body: files[u.pathname], contentType: u.pathname.endsWith(".html") ? "text/html" : "text/javascript" });
    blocked.push(u.href); return route.abort(); });
  await page.goto("https://app.leandoc.invalid/index.html");
  const r = await page.evaluate(async ({ b64, engine }) => {
    const v = []; document.addEventListener("securitypolicyviolation", e => v.push(e.violatedDirective + " " + e.blockedURI));
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
    const t0 = performance.now(); const c = document.getElementById("c");
    if (engine === "docx-preview") await docx.renderAsync(buf, c, null, { ignoreLastRenderedPageBreak: false, renderChanges: false, experimental: true });
    else { const res = await mammoth.convertToHtml({ arrayBuffer: buf }); c.innerHTML = res.value; }
    const t1 = performance.now();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t2 = performance.now();
    return { renderMs: t1 - t0, paintMs: t2 - t0, nodes: document.getElementsByTagName("*").length, heapMiB: performance.memory.usedJSHeapSize / 1048576, pages: c.querySelectorAll("section.docx").length, violations: v };
  }, { b64: bytes, engine });
  await page.waitForTimeout(1500);
  const pid = browser.process?.()?.pid ?? +execSync("pgrep -f chrome-linux/chrome | head -1").toString();
  Object.assign(r, treeKiB(pid), { blocked });
  results.push(r); await browser.close();
}
const med = k => { const a = results.map(r => r[k]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
console.log(JSON.stringify({ engine, doc: doc.split("/").pop(), runs, renderMs: med("renderMs").toFixed(1), firstPaintMs: med("paintMs").toFixed(1), domNodes: med("nodes"), jsHeapMiB: med("heapMiB").toFixed(1), treePssMiB: (med("pss") / 1024).toFixed(1), treePrivateMiB: (med("priv") / 1024).toFixed(1), procs: med("procs"), sections: results[0].pages, cspViolations: results[0].violations.slice(0, 3), blocked: results[0].blocked.slice(0, 3) }));
