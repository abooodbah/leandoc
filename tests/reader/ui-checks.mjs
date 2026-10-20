// UI-03 and UI-07 for the reader in Chromium with the fake host.
//
// Every chrome state (empty with recent files, a document with the fidelity
// bar, outline and tabs, find, reading view, a fallback page, a render
// failure, a status message, light and dark) is checked twice:
//   - axe-core (pinned dev dependency, MPL-2.0, test tool only) finds no
//     serious or critical issue in the chrome. The document's own content is
//     excluded: it is the author's, not LeanDoc's; its findings are printed.
//   - a pixel baseline: under 0.5 percent of pixels may change (a channel
//     difference over 24 counts as changed, which absorbs anti-aliasing). The
//     document area is masked, because documents use system fonts.
// Baselines live in tests/visual/baselines/chromium-<major>/, one set per
// Chromium build, because text rasterization differs between builds. With no
// set for the running build the candidates go to artifacts/ui-baselines/ and
// the comparison is reported as skipped. UPDATE_BASELINES=1 writes the set.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { FakeHost, launchBrowser, loadCases, networkAttempts, prepareFixture, repositoryRoot, stageAssets } from "./fake-host.mjs";
import { changedShare, decodePng } from "../visual/png.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
let browser;
let assets;
let fixtures;
let baselineDirectory;
let candidateDirectory;
const summary = [];

before(async () => {
  assets = stageAssets();
  browser = await launchBrowser();
  fixtures = loadCases();
  const major = browser.version().split(".")[0];
  baselineDirectory = path.join(repositoryRoot, "tests", "visual", "baselines", `chromium-${major}`);
  candidateDirectory = path.join(repositoryRoot, "artifacts", "ui-baselines", `chromium-${major}`);
  mkdirSync(candidateDirectory, { recursive: true });
});

after(async () => {
  const version = browser?.version?.() ?? "";
  await browser?.close();
  if (summary.length) {
    console.log(`# UI states (Chromium ${version}):\n# ` + summary.join("\n# "));
    // CI reports this file as a notice (the job log is not readable there).
    writeFileSync(path.join(repositoryRoot, "artifacts", "ui-baselines", "summary.txt"),
      `Chromium ${version}\n${summary.join("\n")}\n`);
  }
});

const BOTH = [
  { code: "text-box", count: 2, notDisplayed: true, singular: "text box", plural: "text boxes" },
  { code: "equation", count: 1, notDisplayed: true, singular: "equation", plural: "equations" },
  { code: "tracked-changes", count: 3, notDisplayed: false, singular: "tracked change", plural: "tracked changes" },
  { code: "macros", count: 1, notDisplayed: false, singular: "macro project", plural: "macro projects" }
];

const STATES = [
  {
    name: "empty", setup: async (host) => {
      await host.send({ type: "empty", recent: [
        { path: "/home/reader/Quarterly report.docx", name: "Quarterly report.docx" },
        { path: "/home/reader/تقرير.docx", name: "تقرير.docx" },
        { path: "/home/reader/Notes.docx", name: "Notes.docx" }] });
    }
  },
  {
    name: "document", document: true, setup: async (host) => {
      await host.send({ type: "tabs", tabs: [
        { id: 1, name: "headings.docx", path: "/docs/headings.docx" },
        { id: 2, name: "tables.docx", path: "/docs/tables.docx" }], active: 1 });
      const { bytes, report } = prepareFixture(fixtures, "headings.docx", { features: BOTH });
      await host.openDocument({ tab: 1, bytes, report, fileName: "headings.docx" });
    }
  },
  {
    name: "find", document: true, setup: async (host) => {
      const { bytes, report } = prepareFixture(fixtures, "headings.docx");
      await host.openDocument({ bytes, report, fileName: "headings.docx" });
      await host.page.fill("#findInput", "kingfisher");
      await host.page.keyboard.press("Enter");
    }
  },
  {
    name: "details", document: true, setup: async (host) => {
      const { bytes, report } = prepareFixture(fixtures, "headings.docx", { features: BOTH });
      await host.openDocument({ bytes, report, fileName: "headings.docx" });
      await host.page.click("#fidelityDetails");
    }
  },
  {
    name: "reading", document: true, options: { view: "reading" }, setup: async (host) => {
      const { bytes, report } = prepareFixture(fixtures, "headings.docx");
      await host.openDocument({ bytes, report, fileName: "headings.docx" });
    }
  },
  {
    name: "fallback", setup: async (host) => {
      await host.send({ type: "fallback", tab: 3, fileName: "minutes.doc", displayPath: "/home/reader/minutes.doc",
        report: { ok: true, errorCode: "", errorMessage: "", kind: "legacy-doc", sourceBytes: 12000, features: [], outline: [] } });
    }
  },
  {
    name: "error", setup: async (host) => {
      await host.send({ type: "fallback", tab: 3, fileName: "broken.docx", displayPath: "/home/reader/broken.docx",
        report: { ok: false, errorCode: "xml-doctype", errorMessage: "", kind: "docx", sourceBytes: 4000, features: [], outline: [] } });
    }
  },
  {
    name: "status", setup: async (host) => {
      await host.send({ type: "empty", recent: [] });
      await host.send({ type: "status", message: "LeanDoc opens .docx, .dotx, .docm, .dotm, .doc, .rtf, and .odt files.", tone: "warning" });
    }
  }
];

async function capture(host, state) {
  await host.page.evaluate(() => document.fonts.ready);
  await host.page.mouse.move(0, 799);
  const mask = state.document ? [host.page.locator("#docScroller")] : [];
  return host.page.screenshot({ mask, maskColor: "#808080", animations: "disabled", caret: "hide" });
}

function compare(name, image) {
  writeFileSync(path.join(candidateDirectory, `${name}.png`), image);
  const baseline = path.join(baselineDirectory, `${name}.png`);
  if (process.env.UPDATE_BASELINES === "1") {
    mkdirSync(baselineDirectory, { recursive: true });
    writeFileSync(baseline, image);
    return "written";
  }
  if (!existsSync(baseline)) {
    return "no baseline for this Chromium build";
  }
  const share = changedShare(decodePng(readFileSync(baseline)), decodePng(image));
  assert.ok(share < 0.005, `${name}: ${(share * 100).toFixed(2)}% of pixels changed (candidate in ${candidateDirectory})`);
  return `${(share * 100).toFixed(3)}% changed`;
}

async function axe(host) {
  await host.page.evaluate(axeSource);
  return host.page.evaluate(async () => {
    const run = async (context) => {
      const result = await window.axe.run(context, { resultTypes: ["violations"] });
      return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help,
        targets: v.nodes.slice(0, 4).map((node) => node.target.join(" ")) }));
    };
    return {
      chrome: await run({ exclude: [["#docBody"]] }),
      content: document.querySelector("#docBody section") ? await run({ include: [["#docBody"]] }) : []
    };
  });
}

describe("chrome states: accessibility and pixel baselines (UI-03, UI-07)", () => {
  for (const theme of ["light", "dark"]) {
    for (const state of STATES) {
      test(`${state.name}, ${theme}`, async () => {
        const host = await FakeHost.open(browser, assets, {
          theme, colorScheme: theme, viewport: { width: 1280, height: 800 }, ...(state.options || {})
        });
        try {
          await state.setup(host);
          await host.page.waitForTimeout(150);
          const image = await capture(host, state);
          assert.deepEqual(await host.cspViolations(), [], "no CSP violation");
          assert.deepEqual(host.offOrigin, [], "no off-origin request");
          assert.deepEqual(networkAttempts, [], "no network attempt");
          const baseline = compare(`${state.name}-${theme}`, image);
          const findings = await axe(host);
          const serious = findings.chrome.filter((v) => v.impact === "serious" || v.impact === "critical");
          const minor = findings.chrome.filter((v) => !serious.includes(v));
          summary.push(`${state.name}-${theme}: baseline ${baseline}; axe chrome ${serious.length} serious or critical, ` +
            `${minor.length} minor${minor.length ? " (" + minor.map((v) => v.id).join(", ") + ")" : ""}; document content ` +
            `${findings.content.length ? findings.content.map((v) => `${v.id}:${v.impact}`).join(", ") : "clean"}`);
          assert.deepEqual(serious, [], `${state.name}-${theme}: serious or critical axe findings`);
        } finally {
          await host.close();
        }
      });
    }
  }
});
