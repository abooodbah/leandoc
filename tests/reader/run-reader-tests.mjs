// Reader tests: the staged reader in Chromium with a fake host.
// Run: npm run test:reader (or node --test tests/reader/run-reader-tests.mjs)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  FakeHost,
  READER_URL,
  launchBrowser,
  loadCases,
  networkAttempts,
  prepareFixture,
  repositoryRoot,
  stageAssets
} from "./fake-host.mjs";
import { makeBigDocx } from "./make-big-docx.mjs";
import { makeFloatsDocx } from "./make-floats-docx.mjs";
import { BODY_TEXT, HEADER_TEXT, makeAlternatePictureDocx } from "./make-alternate-picture-docx.mjs";
import {
  makeBreakLinesDocx, makeCancelledNumberingDocx, makeEmptyMarkNoteDocx, makeEquationDocx, makeNumberedDocx, makeSmallCapsDocx,
  makeSoftHyphenDocx, makeTightHyphenDocx, makeWideLinesDocx
} from "./make-numbered-docx.mjs";
import { makeColumnsDocx, makeDefaultLineDocx, makePageFlowDocx, makeSavedStartAfterBreakDocx, makeSpacedDocx, makeTablesDocx } from "./make-columns-docx.mjs";
import { makeKeptParagraphDocx } from "./make-columns-docx.mjs";
import {
  AT_LEAST_LINES, CONTENTS_ENTRY, lineText, makeAtLeastDocx, makeContentsDocx, makeSavedPagesDocx, makeSavedRowsDocx,
  makeWordMetricsDocx, rowText
} from "./make-saved-pages-docx.mjs";
import { makeColumnStartsDocx, makeKeepRulesDocx, makePageBreakBeforeDocx, makeSectionPagesDocx, makeStyleChainDocx } from "./make-page-rules-docx.mjs";
import { makeTableEdgeDocx } from "./make-table-edge-docx.mjs";
import { DROPPED_WORD, PICTURE_ANCHOR, WIDE_CAPTION, makeFigureSectionDocx, makeMarginSectionsDocx } from "./make-section-flow-docx.mjs";
import { ARABIC_TEXT, LATIN_TEXT, MONO_TEXT, makeFontsBoxesDocx } from "./make-fonts-boxes-docx.mjs";
import { makeEmptyTableDocx, makeExactRowDocx, makePaddedRowDocx, makeTallRowDocx } from "./make-table-geometry-docx.mjs";

const screenshotDirectory = path.join(repositoryRoot, "artifacts", "reader-screenshots");
let browser;
let assets;
let fixtures;

before(async () => {
  assets = stageAssets();
  browser = await launchBrowser();
  fixtures = loadCases();
  mkdirSync(screenshotDirectory, { recursive: true });
});

after(async () => {
  await browser?.close();
  if (assets) {
    rmSync(assets, { recursive: true, force: true });
  }
});

async function assertClean(host) {
  assert.deepEqual(await host.cspViolations(), [], "no Content Security Policy violations");
  assert.deepEqual(host.offOrigin, [], "no request leaves the app origin");
  assert.deepEqual(host.notFound, [], "no request for a missing file");
  assert.deepEqual(host.consoleErrors, [], "no console errors");
  assert.deepEqual(networkAttempts, [], "the browser made no network attempt of its own");
}

async function withHost(options, body) {
  const host = await FakeHost.open(browser, assets, options);
  try {
    await body(host);
    await assertClean(host);
  } finally {
    await host.close();
  }
}

async function screenshot(host, name) {
  await host.page.evaluate(() => document.fonts.ready);
  await host.page.screenshot({ path: path.join(screenshotDirectory, `${name}.png`) });
}

function fixture(file, overrides) {
  return prepareFixture(fixtures, file, overrides);
}

async function openFixture(host, file, options = {}) {
  const { bytes, report } = fixture(file, options.report);
  const rendered = await host.openDocument({ bytes, report, fileName: file, ...options, report: { ...report } });
  return { rendered, report };
}

test("A kept paragraph taller than a page continues onto fresh pages", async () => {
  await withHost({}, async (host) => {
    const fixture = await makeKeptParagraphDocx();
    const rendered = await host.openDocument({ ...fixture, fileName: "kept-lines.docx" });
    assert.equal(rendered.pages, 3);
    const text = await host.page.locator("#docBody article").allTextContents();
    assert.deepEqual(text.join("").match(/Kept line \d+\./g),
      Array.from({ length: 40 }, (_, i) => `Kept line ${i + 1}.`));
  });
});

function nextRendered(host) {
  const seen = host.ofType("rendered").length;
  return host.waitFor(() => host.ofType("rendered").length > seen, 30000);
}

async function switchView(host, view) {
  const rendered = nextRendered(host);
  await host.page.click(view === "reading" ? "#viewReading" : "#viewPage");
  await rendered;
}

// Enter searches at once, so the count is current however long the reader
// waits for a pause in typing.
async function findCount(host, query) {
  await host.page.fill("#findInput", query);
  await host.page.locator("#findInput").press("Enter");
  return host.page.$eval("#findCount", (node) => node.textContent);
}

// The reader lays a zoom out in the next frame; this waits for it.
async function zoomSettled(host) {
  await host.page.waitForFunction(() => !document.documentElement.hasAttribute("data-zoom-pending"));
}

function countFrom(text) {
  if (text === "0") {
    return 0;
  }
  const match = /^\d+\/(\d+)$/.exec(text);
  return match ? Number(match[1]) : NaN;
}

// Evaluated in the page: everything the per-case expectations need.
async function inspect(host, expect) {
  return host.page.evaluate((expectation) => {
    const body = document.getElementById("docBody");
    const paragraphs = Array.from(body.querySelectorAll("p"));
    const paragraphWith = (text) => paragraphs.find((p) => p.textContent.includes(text)) || null;
    const result = { text: body.textContent, counts: {}, bullets: [], directions: [], numbered: [] };
    for (const selector of Object.keys(expectation.count || {})) {
      result.counts[selector] = body.querySelectorAll(selector).length;
    }
    for (const bullet of expectation.bullets || []) {
      const p = paragraphWith(bullet.text);
      result.bullets.push(p ? getComputedStyle(p, "::before").content : null);
    }
    for (const entry of expectation.direction || []) {
      const p = paragraphWith(entry.text);
      result.directions.push(p ? getComputedStyle(p).direction : null);
    }
    for (const text of expectation.numbered || []) {
      const p = paragraphWith(text);
      const section = p && p.closest("section.docx");
      result.numbered.push(!!p && /docx-num-/.test(p.className) &&
        !section.classList.contains("ld-lazy") && getComputedStyle(p, "::before").content !== "none");
    }
    const aligned = (text, side) => {
      const p = paragraphWith(text);
      if (!p) {
        return null;
      }
      const range = document.createRange();
      range.selectNodeContents(p);
      const textBox = range.getBoundingClientRect();
      const box = p.getBoundingClientRect();
      return side === "right"
        ? Math.abs(textBox.right - box.right) < 3 && textBox.left - box.left > 20
        : Math.abs(textBox.left - box.left) < 3 && box.right - textBox.right > 20;
    };
    result.rightAligned = (expectation.rightAligned || []).map((text) => aligned(text, "right"));
    result.leftAligned = (expectation.leftAligned || []).map((text) => aligned(text, "left"));
    result.header = Array.from(body.querySelectorAll("section.docx > header")).map((n) => n.textContent).join("\n");
    result.footer = Array.from(body.querySelectorAll("section.docx > footer")).map((n) => n.textContent).join("\n");
    result.bidiVisual = Array.from(body.querySelectorAll("table.ld-bidi-visual"))
      .filter((table) => getComputedStyle(table).direction === "rtl").length;
    if (expectation.tableOrder) {
      const cells = Array.from(body.querySelectorAll("td"));
      const cell = (text) => cells.find((td) => td.textContent.includes(text));
      result.tableOrder = cell(expectation.tableOrder.right).getBoundingClientRect().left >
        cell(expectation.tableOrder.left).getBoundingClientRect().left;
    }
    result.images = Array.from(body.querySelectorAll("img")).filter((image) =>
      image.complete && image.naturalWidth > 0 && image.src.startsWith("blob:")).length;
    result.linkHrefs = (expectation.links || []).map((link) => {
      const anchor = Array.from(body.querySelectorAll("a")).find((a) => a.textContent.includes(link.text));
      return anchor ? anchor.getAttribute("href") : null;
    });
    result.blocked = (expectation.blockedLinks || []).map((text) => {
      // The core unwraps unsafe hyperlinks to plain runs; the static dev reports
      // keep them as links the reader must neutralise. Either way the text must
      // not be a working link. Its presence is checked by expect.text.
      const anchor = Array.from(body.querySelectorAll("a")).find((a) => a.textContent.includes(text));
      return anchor ? anchor.hasAttribute("href") : false;
    });
    return result;
  }, expect);
}

async function clickText(host, text) {
  await host.page.locator("#docBody a", { hasText: text }).first().click();
}

describe("rendering cases (RENDER-01, SEC-01 reader half)", () => {
  test("every case renders with its expected text and structure", async () => {
    for (const entry of fixtures.config.cases) {
      await withHost({}, async (host) => {
        const { rendered, report } = await openFixture(host, entry.file);
        const expect = entry.expect;
        const result = await inspect(host, expect);
        for (const text of expect.text || []) {
          assert.ok(result.text.includes(text), `${entry.id}: text "${text}"`);
        }
        for (const text of expect.absentText || []) {
          assert.ok(!result.text.includes(text), `${entry.id}: absent "${text}"`);
        }
        for (const [selector, count] of Object.entries(expect.count || {})) {
          assert.equal(result.counts[selector], count, `${entry.id}: count of ${selector}`);
        }
        (expect.bullets || []).forEach((bullet, index) => {
          assert.ok(result.bullets[index] && result.bullets[index].includes(bullet.marker),
            `${entry.id}: bullet for "${bullet.text}" is ${result.bullets[index]}`);
          assert.ok(!/[\uf000-\uf0ff]/.test(result.bullets[index]), `${entry.id}: no private-use bullet`);
        });
        (expect.direction || []).forEach((direction, index) => {
          assert.equal(result.directions[index], direction.dir, `${entry.id}: direction of "${direction.text}"`);
        });
        result.numbered.forEach((ok, index) => assert.ok(ok, `${entry.id}: numbered "${expect.numbered[index]}"`));
        result.rightAligned.forEach((ok, index) => assert.ok(ok, `${entry.id}: right aligned "${expect.rightAligned[index]}"`));
        result.leftAligned.forEach((ok, index) => assert.ok(ok, `${entry.id}: left aligned "${expect.leftAligned[index]}"`));
        if (expect.header) {
          assert.ok(result.header.includes(expect.header), `${entry.id}: header`);
        }
        if (expect.footer) {
          assert.ok(result.footer.includes(expect.footer), `${entry.id}: footer`);
        }
        if (expect.bidiVisualTables !== undefined) {
          assert.equal(result.bidiVisual, expect.bidiVisualTables, `${entry.id}: bidiVisual tables`);
        }
        if (expect.tableOrder) {
          assert.ok(result.tableOrder, `${entry.id}: bidiVisual columns run right to left`);
        }
        if (expect.imagesLoaded !== undefined) {
          assert.equal(result.images, expect.imagesLoaded, `${entry.id}: images loaded from blob URLs`);
        }
        if (expect.pagesAtLeast) {
          assert.ok(rendered.pages >= expect.pagesAtLeast, `${entry.id}: ${rendered.pages} pages`);
        }
        (expect.links || []).forEach((link, index) => {
          assert.equal(result.linkHrefs[index], link.href, `${entry.id}: link "${link.text}"`);
        });
        result.blocked.forEach((hasHref, index) => {
          assert.equal(hasHref, false, `${entry.id}: "${expect.blockedLinks[index]}" is not a link`);
        });
        if (expect.outline) {
          const outline = await host.page.$$eval("#outlineList a", (links) => links.map((link) => link.textContent));
          assert.deepEqual(outline, report.outline.map((item) => item.text), `${entry.id}: outline`);
          const targets = await host.page.$$eval("#docBody [data-ld-target]", (nodes) =>
            nodes.map((node) => [Number(node.dataset.ldTarget), node.textContent.trim()]));
          assert.equal(targets.length, report.outline.length, `${entry.id}: every outline entry has a target`);
          for (const [index, text] of targets) {
            assert.equal(text, report.outline[index].text, `${entry.id}: outline target ${index}`);
          }
        }
        if (expect.findCounts) {
          for (const [query, count] of Object.entries(expect.findCounts)) {
            assert.equal(countFrom(await findCount(host, query)), count, `${entry.id}: page view finds "${query}"`);
          }
          await switchView(host, "reading");
          for (const [query, count] of Object.entries(expect.findCounts)) {
            assert.equal(countFrom(await findCount(host, query)), count, `${entry.id}: reading view finds "${query}"`);
          }
        }
        assert.equal(host.ofType("renderFailed").length, 0);
      });
    }
  });

  test("screenshots of each case in light and dark", async () => {
    for (const entry of fixtures.config.cases) {
      for (const theme of ["light", "dark"]) {
        await withHost({ theme, colorScheme: theme }, async (host) => {
          await openFixture(host, entry.file);
          await screenshot(host, `case-${entry.id}-${theme}`);
        });
      }
    }
    await withHost({ theme: "light", view: "reading" }, async (host) => {
      await openFixture(host, "arabic.docx");
      await screenshot(host, "case-arabic-reading");
    });
  });
});

// A picture whose fill sits in an mc:AlternateContent inside pic:pic, as
// some older Mac Word files save it, goes through the core as the hosts send
// it. The core resolves the block to its Fallback, so docx-preview finds the
// picture's blipFill and the document renders with both pictures.
describe("a picture fill inside AlternateContent (RENDER-01)", { skip: !process.env.LEANDOC_INSPECT && "LEANDOC_INSPECT is not set" }, () => {
  test("renders, with the header and body pictures shown", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "leandoc-alternate-picture-"));
    const source = path.join(directory, "alternate-picture.docx");
    writeFileSync(source, await makeAlternatePictureDocx());
    const inspect = process.env.LEANDOC_INSPECT;
    const lines = execFileSync(inspect, [source], { encoding: "utf8" }).trim().split("\n");
    const report = JSON.parse(lines[lines.length - 1]);
    const sanitized = path.join(directory, "sanitized.docx");
    execFileSync(inspect, ["--write-sanitized", sanitized, source], { stdio: "pipe" });
    await withHost({}, async (host) => {
      const rendered = await host.openDocument({ bytes: readFileSync(sanitized), report, fileName: "alternate-picture.docx" });
      assert.equal(rendered.type, "rendered", `the document renders: ${JSON.stringify(rendered)}`);
      const state = await host.page.evaluate(() => {
        const body = document.querySelector("#docBody");
        const pictures = Array.from(body.querySelectorAll("img")).map((image) => ({
          inHeader: !!image.closest("header"),
          src: image.getAttribute("src") || ""
        }));
        return { text: body.textContent, pictures };
      });
      assert.ok(state.text.includes(BODY_TEXT), "the body text is shown");
      assert.ok(state.text.includes(HEADER_TEXT), "the header text is shown");
      assert.ok(state.pictures.some((picture) => picture.inHeader && picture.src),
        `the header picture has its image: ${JSON.stringify(state.pictures)}`);
      assert.ok(state.pictures.some((picture) => !picture.inHeader && picture.src),
        `the body picture has its image: ${JSON.stringify(state.pictures)}`);
    });
  });
});

// The committed core fixtures, rendered from the core's own sanitized
// package and report (leandoc-inspect). Without LEANDOC_INSPECT the block is
// skipped; CI's reader job builds leandoc-inspect and sets it.
describe("core fixtures through leandoc-inspect (RENDER-01, FIDELITY-01)", { skip: !process.env.LEANDOC_INSPECT && "LEANDOC_INSPECT is not set" }, () => {
  // Whitespace is ignored: a paragraph split by a page break spans two pages.
  const normalize = (text) => String(text).replace(/\s+/g, "");

  test("every feature fixture renders its text, outline, direction, and fidelity bar", async () => {
    const config = fixtures.config;
    const directory = path.resolve(repositoryRoot, config.coreFixtureDir);
    const expected = JSON.parse(readFileSync(path.resolve(repositoryRoot, config.coreExpectedFile), "utf8"));
    const extras = new Map(config.coreCases.map((entry) => [entry.file, entry.expect]));
    const files = readdirSync(directory).filter((name) => name.endsWith(".docx")).sort();
    assert.ok(files.length >= 20, "the feature fixtures are present");
    for (const file of files) {
      const core = expected[`features/${file}`];
      const extra = extras.get(file) || {};
      await withHost({}, async (host) => {
        const { rendered, report } = await openFixture(host, path.join(directory, file));
        assert.equal(report.ok, true, `${file}: the core accepts it`);
        const result = await inspect(host, extra);
        const text = normalize(result.text);
        // The core's text omits equation runs (m:t), which the reader draws,
        // so a fixture with drawn equations lists its own text instead.
        const coreText = extra.coreText === false ? [] : core.text || [];
        for (const line of [...coreText, ...(extra.text || [])]) {
          assert.ok(text.includes(normalize(line)), `${file}: text "${line}"`);
        }
        const outline = await host.page.$$eval("#outlineList a", (links) => links.map((link) => link.textContent));
        assert.deepEqual(outline, (core.outline || []).map((entry) => entry[1]), `${file}: outline`);
        if (core.rightToLeft) {
          const first = (core.text || [])[0];
          const direction = await host.page.evaluate((needle) => {
            const p = Array.from(document.querySelectorAll("#docBody p")).find((node) => node.textContent.includes(needle));
            return p ? getComputedStyle(p).direction : null;
          }, first);
          assert.equal(direction, "rtl", `${file}: the first paragraph runs right to left`);
        }
        const bar = await host.page.evaluate(() => ({
          hidden: document.getElementById("fidelityBar").hidden,
          text: document.getElementById("fidelityText").textContent
        }));
        assert.equal(bar.hidden, Object.keys(core.features || {}).length === 0, `${file}: fidelity bar shown only with features`);
        if (extra.fidelity) {
          assert.ok(bar.text.includes(extra.fidelity), `${file}: fidelity wording "${bar.text}"`);
        }
        if (extra.pagesAtLeast) {
          assert.ok(rendered.pages >= extra.pagesAtLeast, `${file}: ${rendered.pages} pages`);
        }
        if (extra.imagesLoaded !== undefined) {
          assert.equal(result.images, extra.imagesLoaded, `${file}: images loaded from blob URLs`);
        }
        for (const [selector, count] of Object.entries(extra.count || {})) {
          assert.equal(result.counts[selector], count, `${file}: count of ${selector}`);
        }
        (extra.links || []).forEach((link, index) => {
          assert.equal(result.linkHrefs[index], link.href, `${file}: link "${link.text}"`);
        });
        if (extra.headers || extra.footers) {
          const parts = await host.page.evaluate(() => ({
            headers: Array.from(document.querySelectorAll("#docBody section.docx > header")).map((node) => node.textContent.trim()),
            footers: Array.from(document.querySelectorAll("#docBody section.docx > footer")).map((node) => node.textContent.trim())
          }));
          if (extra.headers) {
            assert.deepEqual(parts.headers, extra.headers, `${file}: headers per page`);
          }
          if (extra.footers) {
            assert.deepEqual(parts.footers, extra.footers, `${file}: footers with each page's number`);
          }
        }
                if (extra.superscripts || extra.noteItems) {
          const notes = await host.page.evaluate(() => ({
            sups: Array.from(document.querySelectorAll("#docBody article sup")).map((node) => node.textContent),
            items: Array.from(document.querySelectorAll("#docBody section.docx > ol > li")).map((node) => node.textContent.trim())
          }));
          if (extra.superscripts) {
            assert.deepEqual(notes.sups, extra.superscripts, `${file}: note references are numbered once, in order`);
          }
          if (extra.noteItems) {
            assert.deepEqual(notes.items, extra.noteItems, `${file}: each note is listed once`);
          }
        }
        assert.equal(host.ofType("renderFailed").length, 0, `${file}: no renderFailed`);
      });
    }
  });
});

describe("fidelity bar (FIDELITY-01)", () => {
  test("wording, details, collapse, and one announcement per document", async () => {
    for (const entry of fixtures.config.fidelity) {
      await withHost({}, async (host) => {
        await openFixture(host, "headings.docx", { report: { features: entry.features }, tab: 1 });
        const hidden = await host.page.$eval("#fidelityBar", (node) => node.hidden);
        if (entry.text === null) {
          assert.equal(hidden, true, `${entry.id}: no bar without features`);
          return;
        }
        assert.equal(hidden, false, `${entry.id}: bar shown`);
        assert.equal(await host.page.textContent("#fidelityText"), entry.text, `${entry.id}: wording`);
        assert.equal(await host.page.textContent("#fidelityEditor"), "Open in Word");
        await host.page.waitForFunction((text) =>
          document.getElementById("liveStatus").textContent === text, entry.text);

        await host.page.click("#fidelityDetails");
        const rows = await host.page.$$eval("#fidelityList li", (items) =>
          items.map((item) => [item.dataset.code, item.querySelector(".feature-count").textContent]));
        assert.deepEqual(rows, entry.features.map((feature) => [feature.code, String(feature.count)]));
        if (entry.id === "both") {
          await screenshot(host, "fidelity-bar-details");
        }

        await host.page.click("#fidelityCollapse");
        assert.equal(await host.page.$eval("#fidelityBar", (node) => node.hasAttribute("data-collapsed")), true);
        assert.equal(await host.page.$eval("#fidelityList", (node) => node.hidden), true);
        // The collapse is kept for the tab across a view switch, and the bar
        // is not announced again.
        await host.page.evaluate(() => { document.getElementById("liveStatus").textContent = ""; });
        await switchView(host, "reading");
        assert.equal(await host.page.$eval("#fidelityBar", (node) => node.hasAttribute("data-collapsed")), true);
        await host.page.waitForTimeout(80);
        assert.equal(await host.page.textContent("#liveStatus"), "");
        await host.page.click("#fidelityCollapse");
        assert.equal(await host.page.textContent("#fidelityText"), entry.text);

        const editor = host.waitFor((message) => message.type === "openInEditor");
        await host.page.click("#fidelityEditor");
        assert.deepEqual(await editor, { type: "openInEditor", tab: 1 });
      });
    }
  });

  test("screenshot of the fidelity bar in both themes", async () => {
    const both = fixtures.config.fidelity.find((entry) => entry.id === "both");
    for (const theme of ["light", "dark"]) {
      await withHost({ theme }, async (host) => {
        await openFixture(host, "headings.docx", { report: { features: both.features } });
        await screenshot(host, `fidelity-bar-${theme}`);
      });
    }
  });
});

describe("fallback pages and empty state (VIEW-01)", () => {
  test("each kind has its sentence and the editor action", async () => {
    for (const entry of fixtures.config.fallbacks) {
      await withHost({}, async (host) => {
        await host.send({
          type: "fallback",
          tab: 4,
          fileName: entry.fileName,
          displayPath: `/home/reader/${entry.fileName}`,
          report: {
            ok: entry.ok !== false,
            errorCode: entry.errorCode || "",
            errorMessage: entry.errorMessage || "",
            kind: entry.kind,
            sourceBytes: 1200,
            features: [],
            outline: [],
            properties: { title: "", creator: "", rightToLeft: false }
          }
        });
        assert.equal(await host.page.textContent("#stateMessage"), entry.text, entry.kind);
        assert.equal(await host.page.textContent("#stateTitle"), entry.fileName);
        assert.equal(await host.page.isVisible("#stateEditorButton"), true);
        assert.equal(await host.page.isVisible("#readerPane"), false);
        assert.equal(await host.page.getAttribute("html", "data-render-state"), "fallback");
        const editor = host.waitFor((message) => message.type === "openInEditor");
        await host.page.click("#stateEditorButton");
        assert.deepEqual(await editor, { type: "openInEditor", tab: 4 });
        if (entry.kind === "legacy-doc") {
          await screenshot(host, "fallback-legacy-doc");
        }
        if (entry.errorCode === "xml-doctype") {
          await screenshot(host, "fallback-error");
        }
      });
    }
  });

  test("a document whose report is not ok shows the fallback page", async () => {
    await withHost({}, async (host) => {
      await host.send({
        type: "document", tab: 2, generation: 1, fileName: "x.docx", displayPath: "/x.docx",
        packageUrl: "https://app.leandoc.invalid/pkg/2/1/document.docx",
        report: { ok: false, errorCode: "xml-too-deep", errorMessage: "", kind: "docx", features: [], outline: [] }
      });
      assert.equal(await host.page.textContent("#stateMessage"), "This document is nested more deeply than LeanDoc reads.");
      assert.equal(host.requests.filter((url) => url.includes("/pkg/")).length, 0);
    });
  });

  test("a package that cannot be fetched posts renderFailed", async () => {
    await withHost({}, async (host) => {
      const failed = host.waitFor((message) => message.type === "renderFailed");
      await host.send({
        type: "document", tab: 3, generation: 7, fileName: "gone.docx", displayPath: "/gone.docx",
        packageUrl: "https://app.leandoc.invalid/pkg/3/7/document.docx",
        report: { ok: true, kind: "docx", features: [], outline: [] }
      });
      const message = await failed;
      assert.equal(message.tab, 3);
      assert.equal(message.generation, 7);
      assert.equal(await host.page.isVisible("#stateEditorButton"), true);
      assert.equal(await host.page.getAttribute("html", "data-render-state"), "failed");
      host.consoleErrors = host.consoleErrors.filter((text) => !text.includes("404"));
      host.notFound = [];
    });
  });

  test("a package docx-preview cannot read posts renderFailed", async () => {
    await withHost({}, async (host) => {
      const failed = host.waitFor((message) => message.type === "renderFailed");
      await host.openDocument({
        tab: 1, generation: 3, bytes: Buffer.from("PK\u0003\u0004 this is not a zip file"),
        report: { ok: true, kind: "docx", features: [], outline: [] }, fileName: "broken.docx", wait: false
      });
      const message = await failed;
      assert.equal(message.generation, 3);
      assert.ok(message.message.length > 0);
      assert.equal(await host.page.textContent("#stateTitle"), "broken.docx");
      assert.equal(host.ofType("rendered").length, 0);
    });
  });

  test("a package URL on another origin is refused without a request", async () => {
    await withHost({}, async (host) => {
      const failed = host.waitFor((message) => message.type === "renderFailed");
      await host.send({
        type: "document", tab: 1, generation: 1, fileName: "a.docx", displayPath: "/a.docx",
        packageUrl: "https://example.invalid/pkg/1/1/document.docx",
        report: { ok: true, kind: "docx", features: [], outline: [] }
      });
      await failed;
      assert.deepEqual(host.offOrigin, []);
    });
  });

  test("empty state lists recent files and clears them", async () => {
    await withHost({}, async (host) => {
      await host.send({
        type: "empty",
        recent: [
          { path: "C:\\Users\\reader\\Documents\\Quarterly report.docx", name: "Quarterly report.docx" },
          { path: "/home/reader/\u062a\u0642\u0631\u064a\u0631.docx", name: "\u062a\u0642\u0631\u064a\u0631.docx" },
          { path: "/Users/reader/Minutes.docx", name: "Minutes.docx" }
        ]
      });
      assert.equal(await host.page.textContent("#stateTitle"), "Read Word documents without opening an office suite.");
      assert.equal(await host.page.locator(".recent-item").count(), 3);
      // An Arabic file name keeps its extension on the right, as in Explorer.
      const arabicName = host.page.locator(".recent-name").nth(1);
      assert.equal(await arabicName.evaluate((node) => getComputedStyle(node).direction), "ltr");
      const parts = await arabicName.evaluate((node) => {
        const range = document.createRange();
        const text = node.firstChild;
        const extensionStart = text.textContent.indexOf(".docx");
        range.setStart(text, 0);
        range.setEnd(text, extensionStart);
        const stem = range.getBoundingClientRect();
        range.setStart(text, extensionStart);
        range.setEnd(text, text.textContent.length);
        return { stemLeft: stem.left, extensionLeft: range.getBoundingClientRect().left };
      });
      assert.ok(parts.extensionLeft > parts.stemLeft, "extension is drawn to the right of the Arabic name");
      await screenshot(host, "empty-state-light");
      const recent = host.waitFor((message) => message.type === "openRecent");
      await host.page.locator(".recent-item").nth(1).click();
      assert.deepEqual(await recent, { type: "openRecent", path: "/home/reader/\u062a\u0642\u0631\u064a\u0631.docx" });
      const open = host.waitFor((message) => message.type === "open");
      await host.page.click("#stateOpenButton");
      await open;
      const cleared = host.waitFor((message) => message.type === "clearRecent");
      await host.page.click("#clearRecent");
      await cleared;
      assert.equal(await host.page.isVisible("#recentSection"), false);
    });
    await withHost({ theme: "dark", colorScheme: "dark" }, async (host) => {
      await host.send({ type: "empty", recent: [{ path: "/home/reader/Notes.docx", name: "Notes.docx" }] });
      // A host that names entries by opaque id (Linux) gets the id back.
      await host.send({ type: "empty", recent: [{ id: "4", path: "/home/reader/Caf\ufffd.docx", name: "Caf\ufffd.docx" }] });
      const byId = host.waitFor((message) => message.type === "openRecent");
      await host.page.locator(".recent-item").first().click();
      assert.deepEqual(await byId, { type: "openRecent", path: "/home/reader/Caf\ufffd.docx", id: "4" });
      await host.send({ type: "empty", recent: [{ path: "/home/reader/Notes.docx", name: "Notes.docx" }] });
      await screenshot(host, "empty-state-dark");
    });
  });
});

describe("keyboard reading and the outline (U-02, U-06)", () => {
  test("a rendered document takes the focus, so Page Down scrolls at once", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(20);
      await host.openDocument({ bytes, report, fileName: "twenty.docx" });
      assert.equal(await host.page.evaluate(() => document.activeElement.id), "docScroller");
      for (const key of ["PageDown", "Space", "ArrowDown"]) {
        const before = await host.page.$eval("#docScroller", (node) => node.scrollTop);
        await host.page.keyboard.press(key);
        await host.page.waitForFunction((top) => document.getElementById("docScroller").scrollTop > top, before,
          { timeout: 5000 }).catch(() => assert.fail(`${key} did not scroll`));
      }
      await host.page.keyboard.press("End");
      await host.page.waitForFunction(() => {
        const node = document.getElementById("docScroller");
        return node.scrollTop >= node.scrollHeight - node.clientHeight - 2;
      }, null, { timeout: 5000 }).catch(async () => assert.fail(`End did not reach the end: ${
        JSON.stringify(await host.page.$eval("#docScroller", (n) => [n.scrollTop, n.scrollHeight, n.clientHeight]))}`));
      // Chromium drops a key that lands on the last frame of its own scroll
      // animation, so the test pauses as a reader would.
      await host.page.waitForTimeout(300);
      await host.page.keyboard.press("Home");
      await host.page.waitForFunction(() => document.getElementById("docScroller").scrollTop === 0, null,
        { timeout: 5000 }).catch(async () => assert.fail(`Home did not return to the top: ${
          await host.page.$eval("#docScroller", (n) => [n.scrollTop, document.activeElement.id, document.activeElement.tagName])}`));
      // A control the reader is using keeps the focus when a document arrives.
      await host.page.focus("#findInput");
      await host.openDocument({ generation: 2, bytes, report, fileName: "twenty.docx" });
      assert.equal(await host.page.evaluate(() => document.activeElement.id), "findInput");
    });
  });

  test("a freshly opened document has the focus without a focus ring; Tab back shows it", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(3);
      await host.openDocument({ bytes, report, fileName: "three.docx" });
      const ring = () => host.page.evaluate(() => {
        const node = document.activeElement;
        return { id: node.id, outline: getComputedStyle(node).outlineStyle };
      });
      assert.deepEqual(await ring(), { id: "docScroller", outline: "none" });
      await host.page.focus("#findInput");
      await host.page.keyboard.press("Shift+Tab");
      assert.deepEqual(await ring(), { id: "docScroller", outline: "solid" }, "keyboard focus shows the ring");
    });
  });

  test("Tab wraps around inside the page instead of leaving it (UI-06)", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(3);
      await host.openDocument({ bytes, report, fileName: "three.docx" });
      const order = [];
      for (let step = 0; step < 30; step += 1) {
        await host.page.keyboard.press("Tab");
        order.push(await host.page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
      }
      assert.ok(!order.includes("BODY"), `focus never leaves the controls: ${order.join(" ")}`);
      const first = order.indexOf("findInput");
      assert.ok(first >= 0 && order.indexOf("findInput", first + 1) > first, `Tab comes round again: ${order.join(" ")}`);
      for (const id of ["viewPage", "viewReading", "zoomOut", "zoomValue", "zoomIn", "themeButton", "editorButton", "openButton", "docScroller"]) {
        assert.ok(order.includes(id), `Tab reaches ${id}`);
      }
      await host.page.focus("#findInput");
      await host.page.keyboard.press("Shift+Tab");
      assert.notEqual(await host.page.evaluate(() => document.activeElement.tagName), "BODY", "Shift+Tab wraps too");
    });
  });

  test("a clicked outline entry stays current although the next heading is close", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(30, { sectionHeadings: true });
      await host.openDocument({ bytes, report, fileName: "chapters.docx" });
      for (const text of ["Chapter 2", "Chapter 3", "Overview 2"]) {
        await host.page.locator("#outlineList a", { hasText: text }).click();
        await host.page.waitForTimeout(150);
        assert.equal(await host.page.$eval("#outlineList [aria-current]", (node) => node.textContent), text);
      }
      // Scrolling away hands the highlight back to the scroll position.
      await host.page.mouse.move(700, 500);
      await host.page.mouse.wheel(0, 200000);
      await host.page.waitForFunction(() =>
        document.querySelector("#outlineList [aria-current]").textContent === "Overview 3");
    });
  });
});

describe("page colour", () => {
  const COLOR_FIXTURES = ["headings.docx", "tables.docx", "hyperlinks.docx", "bullets.docx"]
    .concat(["styles.docx", "theme.docx", "tables.docx", "numbering.docx", "headers-footers.docx",
      "notes.docx", "arabic-table.docx", "tracked-changes.docx"]
      .map((name) => path.join(repositoryRoot, "tests", "fixtures", "features", name)));

  // Every colour LeanDoc draws inside the document, element by element.
  function drawnColors(host) {
    return host.page.evaluate(() => {
      const rows = [];
      document.querySelectorAll("#docBody *").forEach((node) => {
        const style = getComputedStyle(node);
        rows.push([node.tagName, style.color, style.backgroundColor, style.borderTopColor, style.borderRightColor,
          style.borderBottomColor, style.borderLeftColor, style.textDecorationColor].join("|"));
      });
      return rows;
    });
  }

  // A paper page draws every colour the document names, as 0.1.4 did: each
  // colour goes through var(--ldc-N, colour), and with no variable set that
  // must compute to the colour itself. The check renders each fixture, then
  // writes every routed colour back as the plain colour (in the elements'
  // styles and the document's style sheets) and compares every element's
  // computed colours, in the same browser.
  test("paper pages draw every colour exactly as the document names it", async () => {
    await withHost({ theme: "dusk", colorScheme: "dark" }, async (host) => {
      let generation = 1;
      let routed = 0;
      for (const file of COLOR_FIXTURES) {
        const { bytes, report } = fixture(file);
        await host.openDocument({ bytes, report, generation, fileName: path.basename(file) });
        generation += 1;
        const before = await drawnColors(host);
        routed += await host.page.evaluate(() => {
          const pattern = /var\(--ldc-\d+, ([^)]+)\)/g;
          let count = 0;
          const plain = (text) => text.replace(pattern, (_all, color) => { count += 1; return color; });
          document.querySelectorAll("#docBody [style]").forEach((node) => {
            node.setAttribute("style", plain(node.getAttribute("style")));
          });
          document.querySelectorAll("#docStyles style").forEach((node) => {
            node.textContent = plain(node.textContent);
          });
          return count;
        });
        assert.deepEqual(await drawnColors(host), before, path.basename(file));
      }
      assert.ok(routed > 50, `the fixtures route colours (${routed})`);
    });
  });

  function contrast(a, b) {
    const luminance = (rgb) => {
      const [r, g, b2] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  test("the page follows the theme when asked, and the choice reaches the host", async () => {
    await withHost({ theme: "dusk", colorScheme: "dark" }, async (host) => {
      await openFixture(host, path.join(repositoryRoot, "tests", "fixtures", "features", "theme.docx"));
      const page = () => host.page.$eval("#docBody section.docx", (node) =>
        [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]);
      assert.deepEqual(await page(), ["rgb(255, 255, 255)", "rgb(0, 0, 0)"], "paper by default");
      await host.page.click("#settingsButton");
      assert.equal(await host.page.isChecked('input[name="settings-page"][value="paper"]'), true);
      const labels = await host.page.$$eval('input[name="settings-page"]', (inputs) =>
        inputs.map((input) => [input.value, input.closest("label").textContent.trim()]));
      assert.deepEqual(labels, [["paper", "White, like paper"], ["theme", "The theme's colours"]]);
      const posted = host.waitFor((message) => message.type === "setPageColor");
      await host.page.check('input[name="settings-page"][value="theme"]');
      assert.deepEqual(await posted, { type: "setPageColor", pageColor: "theme" });
      assert.equal(await host.page.getAttribute("html", "data-page-color"), "theme");
      assert.deepEqual(await page(), ["rgb(34, 30, 25)", "rgb(212, 200, 180)"], "Dusk's canvas and text");
      // Every text the document draws stays readable on the page.
      const texts = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody section.docx *"))
        .filter((node) => Array.from(node.childNodes).some((child) => child.nodeType === 3 && child.nodeValue.trim()))
        .filter((node) => getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)")
        .map((node) => [node.textContent.trim().slice(0, 30), getComputedStyle(node).color]));
      assert.ok(texts.length > 5);
      for (const [text, color] of texts) {
        assert.ok(contrast(color, "rgb(34, 30, 25)") >= 4.5, `"${text}" in ${color} is readable on Dusk`);
      }
      for (const [theme, canvas, ink] of [["dark", "rgb(14, 13, 11)", "rgb(250, 249, 247)"],
        ["dim", "rgb(30, 32, 35)", "rgb(200, 204, 210)"], ["light", "rgb(250, 249, 247)", "rgb(26, 25, 23)"]]) {
        await host.send({ type: "theme", theme, view: "page", pageColor: "theme" });
        assert.deepEqual(await page(), [canvas, ink], `${theme}: the theme's canvas and text`);
      }
      // A coloured run keeps its own colour on a light page.
      const accent = await host.page.evaluate(() => {
        const span = Array.from(document.querySelectorAll("#docBody span")).find((node) => node.textContent.includes("Accent 2."));
        return getComputedStyle(span).color;
      });
      assert.equal(accent, "rgb(192, 80, 77)");
      await host.send({ type: "theme", theme: "dark", view: "page", pageColor: "paper" });
      assert.deepEqual(await page(), ["rgb(255, 255, 255)", "rgb(0, 0, 0)"], "the host's choice of paper");
      assert.equal(await host.page.isChecked('input[name="settings-page"][value="paper"]'), true);
      await host.send({ type: "theme", theme: "dark", view: "page", pageColor: "sepia" });
      assert.equal(await host.page.getAttribute("html", "data-page-color"), null, "an unknown choice reads as paper");
    });
  });
});

describe("toolbar and tabs (LeanMark's layout)", () => {
  // LeanMark 0.6.0's toolbar and tab strip (assets/reader.css in the
  // leanmark repository): 56 px bar with 20 px sides, 40 px controls with
  // 16 px sides, the find box without an icon, icons drawn at 1.6 px.
  test("the toolbar and tabs use LeanMark's sizes, spacing, and icons", async () => {
    await withHost({ viewport: { width: 1400, height: 900 } }, async (host) => {
      await host.send({ type: "tabs", tabs: [
        { id: 1, name: "headings.docx", path: "/docs/headings.docx" },
        { id: 2, name: "tables.docx", path: "/docs/tables.docx" }], active: 1 });
      await openFixture(host, "headings.docx", { tab: 1 });
      const measured = await host.page.evaluate(() => {
        const style = (selector) => getComputedStyle(document.querySelector(selector));
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const pick = (selector, names) => {
          const computed = style(selector);
          return Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(name)]));
        };
        const visible = Array.from(document.querySelectorAll(".toolbar button, .toolbar input"))
          .filter((node) => node.getClientRects().length > 0).map((node) => node.id);
        return {
          topbar: pick(".topbar", ["min-height", "padding-left", "padding-right", "column-gap"]),
          toolbarGap: style(".toolbar").columnGap,
          wordmark: pick(".wordmark", ["width", "height", "border-radius", "font-size", "font-weight", "letter-spacing"]),
          fileMeta: pick("#fileMeta", ["font-size", "margin-top"]),
          search: { ...pick(".search-field", ["height", "min-width", "border-top-left-radius"]),
            icons: document.querySelectorAll(".search-field svg").length },
          searchInput: pick("#findInput", ["padding-left", "font-size"]),
          findCount: pick("#findCount", ["min-width", "text-align", "font-size"]),
          buttons: ["#themeButton", "#editorButton", "#openButton"].map((id) =>
            pick(id, ["height", "border-top-left-radius", "padding-left", "padding-right", "font-size", "font-weight"])),
          ghostColor: style("#themeButton").color,
          settings: [box("#settingsButton").width, box("#settingsButton").height],
          groups: [box(".segmented").height, box(".zoom").height],
          strokes: Array.from(document.querySelectorAll(".toolbar svg, .tab-strip svg"))
            .map((svg) => getComputedStyle(svg).strokeWidth),
          order: visible,
          strip: pick(".tab-strip", ["height", "padding-left"]),
          tab: pick(".tab", ["font-size", "padding-left", "min-width", "max-width"]),
          selected: style('.tab[aria-selected="true"]').boxShadow
        };
      });
      assert.deepEqual(measured.topbar, { "min-height": "56px", "padding-left": "20px", "padding-right": "20px", "column-gap": "16px" });
      assert.equal(measured.toolbarGap, "8px");
      assert.deepEqual(measured.wordmark, { width: "32px", height: "32px", "border-radius": "6px", "font-size": "12px",
        "font-weight": "600", "letter-spacing": "0.36px" });
      assert.deepEqual(measured.fileMeta, { "font-size": "12px", "margin-top": "3px" });
      assert.deepEqual(measured.search, { height: "40px", "min-width": "220px", "border-top-left-radius": "4px", icons: 0 });
      assert.deepEqual(measured.searchInput, { "padding-left": "12px", "font-size": "14px" });
      assert.deepEqual(measured.findCount, { "min-width": "52px", "text-align": "right", "font-size": "12px" });
      for (const button of measured.buttons) {
        assert.deepEqual(button, { height: "40px", "border-top-left-radius": "6px", "padding-left": "16px",
          "padding-right": "16px", "font-size": "14px", "font-weight": "500" });
      }
      assert.equal(measured.ghostColor, "rgb(26, 25, 23)", "ghost buttons use the text colour");
      assert.deepEqual(measured.settings, [40, 40]);
      assert.deepEqual(measured.groups, [40, 40]);
      assert.ok(measured.strokes.length > 0 && measured.strokes.every((width) => width === "1.6px"),
        `icons at 1.6 px: ${measured.strokes.join(" ")}`);
      assert.deepEqual(measured.order, ["findInput", "viewPage", "viewReading", "zoomOut", "zoomValue", "zoomIn",
        "themeButton", "settingsButton", "editorButton", "openButton"]);
      assert.deepEqual(measured.strip, { height: "36px", "padding-left": "12px" });
      assert.deepEqual(measured.tab, { "font-size": "13px", "padding-left": "12px", "min-width": "96px", "max-width": "240px" });
      assert.equal(measured.selected, "rgb(29, 78, 216) 0px -2px 0px 0px inset");
      await host.page.hover('.tab[aria-selected="false"]');
      assert.equal(await host.page.$eval('.tab[aria-selected="false"]', (node) => getComputedStyle(node).backgroundColor),
        "rgb(244, 242, 238)", "a hovered tab takes the muted surface");
      await host.send({ type: "theme", theme: "dark", view: "page" });
      assert.equal(await host.page.$eval('.tab[aria-selected="false"]', (node) => getComputedStyle(node).backgroundColor),
        "rgb(43, 41, 36)", "in Dark too");
    });
  });

  test("a narrow window hides the wordmark, the file details, and the theme button, as LeanMark does", async () => {
    await withHost({ viewport: { width: 700, height: 800 } }, async (host) => {
      await openFixture(host, "headings.docx");
      const shown = await host.page.evaluate(() => Object.fromEntries(
        [".wordmark", "#fileMeta", "#themeButton", "#settingsButton", "#openButton", "#findInput"]
          .map((selector) => [selector, document.querySelector(selector).getClientRects().length > 0])));
      assert.deepEqual(shown, { ".wordmark": false, "#fileMeta": false, "#themeButton": false,
        "#settingsButton": true, "#openButton": true, "#findInput": true });
    });
  });
});

describe("settings panel and shortcuts", () => {
  test("the settings button opens the panel; Ctrl+/ and F1 open it; Escape closes it", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "headings.docx");
      const button = "#settingsButton";
      assert.equal(await host.page.getAttribute(button, "aria-haspopup"), "dialog");
      assert.equal(await host.page.getAttribute(button, "aria-controls"), "settingsPanel");
      assert.equal(await host.page.getAttribute(button, "aria-expanded"), "false");
      assert.equal(await host.page.getAttribute(button, "title"), "Settings and shortcuts (Ctrl+/)");
      assert.equal(await host.page.getAttribute(button, "aria-label"), "Settings and keyboard shortcuts");
      assert.equal(await host.page.isVisible("#settingsPanel"), false);

      await host.page.click(button);
      assert.equal(await host.page.isVisible("#settingsPanel"), true);
      assert.equal(await host.page.getAttribute(button, "aria-expanded"), "true");
      assert.equal(await host.page.getAttribute("#settingsPanel", "role"), "dialog");
      assert.deepEqual(await host.page.evaluate(() =>
        [document.activeElement.name, document.activeElement.value, document.activeElement.checked]),
      ["settings-theme", "light", true], "the checked theme has the focus");
      // The panel sits beside the document, below the toolbar; nothing overlaps.
      const boxes = await host.page.evaluate(() => {
        const box = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
        return { panel: box("settingsPanel"), doc: box("docScroller"), chrome: box("chrome") };
      });
      assert.ok(boxes.doc.right <= boxes.panel.left + 1, `the document moves over: ${JSON.stringify(boxes)}`);
      assert.ok(Math.abs(boxes.panel.top - boxes.chrome.bottom) <= 1, "the panel starts below the toolbar");
      await host.page.keyboard.press("Escape");
      assert.equal(await host.page.isVisible("#settingsPanel"), false);
      assert.equal(await host.page.evaluate(() => document.activeElement.id), "settingsButton");
      assert.equal(await host.page.getAttribute(button, "aria-expanded"), "false");

      await host.page.locator("#docScroller").focus();
      await host.page.keyboard.press("Control+/");
      assert.equal(await host.page.isVisible("#settingsPanel"), true, "Ctrl+/ opens the panel");
      await host.page.keyboard.press("Escape");
      assert.equal(await host.page.evaluate(() => document.activeElement.id), "docScroller",
        "Escape returns the focus to where it was");
      await host.page.keyboard.press("F1");
      assert.equal(await host.page.isVisible("#settingsPanel"), true, "F1 opens the panel");
      await host.page.click("#settingsClose");
      assert.equal(await host.page.isVisible("#settingsPanel"), false);
      // Escape in the find box clears the search and leaves the panel open.
      await host.page.click(button);
      await host.page.fill("#findInput", "Kingfisher");
      await host.page.locator("#findInput").press("Escape");
      assert.equal(await host.page.isVisible("#settingsPanel"), true);
      await host.page.click(button);
      assert.equal(await host.page.isVisible("#settingsPanel"), false, "the button closes it again");
    });
    await withHost({ platform: "macos", tabs: false }, async (host) => {
      assert.equal(await host.page.getAttribute("#settingsButton", "title"), "Settings and shortcuts (Cmd+/)");
      await host.page.keyboard.press("Meta+/");
      assert.equal(await host.page.isVisible("#settingsPanel"), true, "Cmd+/ opens the panel on macOS");
    });
  });

  test("the panel changes the theme, the view, and the zoom", async () => {
    await withHost({ viewport: { width: 1700, height: 900 } }, async (host) => {
      await host.send({ type: "empty", recent: [] });
      await host.page.click("#settingsButton");
      assert.equal(await host.page.isDisabled('input[name="settings-view"][value="reading"]'), true,
        "no view without a document");
      assert.equal(await host.page.isDisabled("#settingsZoomIn"), true, "no zoom without a document");
      await host.page.click("#settingsClose");
      await openFixture(host, "headings.docx");
      await host.page.click("#settingsButton");
      const themes = await host.page.$$eval('#settingsPanel input[name="settings-theme"]', (inputs) =>
        inputs.map((input) => [input.value, input.closest("label").textContent.trim(),
          input.closest("label").querySelector(".theme-swatch").dataset.swatch]));
      assert.deepEqual(themes, [["system", "System", "system"], ["light", "Light", "light"],
        ["dark", "Dark", "dark"], ["dim", "Dim", "dim"], ["dusk", "Dusk", "dusk"]]);
      const posted = host.waitFor((message) => message.type === "setTheme");
      await host.page.check('input[name="settings-theme"][value="dusk"]');
      assert.equal((await posted).theme, "dusk");
      assert.equal(await host.page.getAttribute("html", "data-theme"), "dusk");
      assert.equal(await host.page.textContent("#themeLabel"), "Dusk");
      await host.page.keyboard.press("Control+Shift+T");
      assert.equal(await host.page.isChecked('input[name="settings-theme"][value="system"]'), true,
        "the panel follows the theme key");

      assert.equal(await host.page.isChecked('input[name="settings-view"][value="page"]'), true);
      const view = host.waitFor((message) => message.type === "setView");
      const rendered = nextRendered(host);
      await host.page.check('input[name="settings-view"][value="reading"]');
      assert.equal((await view).view, "reading");
      await rendered;
      assert.equal(await host.page.getAttribute("html", "data-view"), "reading");
      const back = nextRendered(host);
      await host.page.locator("#docScroller").focus();
      await host.page.keyboard.press("Control+Shift+V");
      await back;
      assert.equal(await host.page.isChecked('input[name="settings-view"][value="page"]'), true,
        "the panel follows the view key");

      const zoom = () => host.page.textContent("#settingsZoomValue");
      assert.equal(await zoom(), "100%");
      await host.page.click("#settingsZoomIn");
      assert.equal(await zoom(), "110%");
      assert.equal(await host.page.textContent("#zoomValue"), "110%");
      await host.page.click("#settingsZoomOut");
      await host.page.click("#settingsZoomOut");
      assert.equal(await zoom(), "90%");
      await host.page.click("#settingsZoomFit");
      assert.equal(await host.page.getAttribute("html", "data-zoom-mode"), "fit");
      await host.page.click("#settingsZoomReset");
      assert.equal(await host.page.getAttribute("html", "data-zoom-mode"), "auto");
      assert.equal(await zoom(), "100%");
    });
  });

  const WINDOWS_SHORTCUTS = [
    ["Reader", "Ctrl+O", "Open a document"],
    ["Reader", "Ctrl+F", "Find in the document"],
    ["Reader", "F3", "Next match"],
    ["Reader", "Shift+F3", "Previous match"],
    ["Reader", "F5", "Reload from disk"],
    ["Reader", "Ctrl+R", "Reload from disk"],
    ["Reader", "Ctrl+Shift+V", "Switch page and reading view"],
    ["Reader", "Ctrl+Shift+T", "Change the theme"],
    ["Reader", "Ctrl+Shift+E", "Open in the editor"],
    ["Reader", "Ctrl+Shift+C", "Copy all text"],
    ["Reader", "Ctrl++", "Zoom in"],
    ["Reader", "Ctrl+-", "Zoom out"],
    ["Reader", "Ctrl+0", "Reset the zoom"],
    ["Reader", "Ctrl+/", "Settings and shortcuts"],
    ["Reader", "F1", "Settings and shortcuts"],
    ["Settings panel", "Esc", "Close the settings panel"],
    ["Tabs", "Ctrl+Tab", "Next tab"],
    ["Tabs", "Ctrl+Shift+Tab", "Previous tab"],
    ["Tabs", "Ctrl+Page Down", "Next tab"],
    ["Tabs", "Ctrl+Page Up", "Previous tab"],
    ["Tabs", "Ctrl+W", "Close the tab"],
    ["Tabs", "Ctrl+1 to Ctrl+8", "Go to a tab by position"],
    ["Tabs", "Ctrl+9", "Go to the last tab"],
    ["Find box", "Enter", "Next match"],
    ["Find box", "Shift+Enter", "Previous match"],
    ["Find box", "Esc", "Clear the search"],
    ["Tab strip", "Right arrow", "Next tab"],
    ["Tab strip", "Left arrow", "Previous tab"],
    ["Tab strip", "Home", "First tab"],
    ["Tab strip", "End", "Last tab"],
    ["Tab strip", "Delete", "Close the tab"]
  ];

  async function listedShortcuts(host) {
    await host.page.click("#settingsButton");
    return host.page.evaluate(() => {
      const rows = [];
      let group = "";
      for (const node of document.getElementById("shortcutList").children) {
        if (node.tagName === "H4") {
          group = node.textContent;
        } else {
          node.querySelectorAll(".shortcut-row").forEach((row) => {
            rows.push([group, row.querySelector("kbd").textContent, row.querySelector("dd").textContent]);
          });
        }
      }
      return rows;
    });
  }

  test("the panel lists every keyboard shortcut, with Cmd on macOS", async () => {
    await withHost({}, async (host) => {
      assert.deepEqual(await listedShortcuts(host), WINDOWS_SHORTCUTS);
    });
    await withHost({ platform: "macos", tabs: false }, async (host) => {
      const expected = WINDOWS_SHORTCUTS
        .filter(([group]) => group !== "Tabs" && group !== "Tab strip")
        .map(([group, keys, label]) => [group, keys.replace(/Ctrl\+/g, "Cmd+"), label])
        .concat([["Menu", "Cmd+W", "Close the window"], ["Menu", "Cmd+M", "Minimize the window"],
          ["Menu", "Cmd+H", "Hide LeanDoc"], ["Menu", "Cmd+Q", "Quit LeanDoc"]]);
      assert.deepEqual(await listedShortcuts(host), expected);
    });
  });

  // The list is built from the tables the key handlers use, so a listed key
  // does what the list says.
  test("listed reader shortcuts act as listed", async () => {
    await withHost({}, async (host) => {
      await host.send({ type: "tabs", tabs: [
        { id: 1, name: "headings.docx", path: "/docs/headings.docx" },
        { id: 2, name: "tables.docx", path: "/docs/tables.docx" }], active: 1 });
      await openFixture(host, "headings.docx", { tab: 1 });
      await host.page.locator("#docScroller").focus();
      const posted = async (keys, type) => {
        const message = host.waitFor((m) => m.type === type, 3000);
        await host.page.keyboard.press(keys);
        return message;
      };
      assert.equal((await posted("Control+o", "open")).type, "open");
      assert.equal((await posted("F5", "reload")).type, "reload");
      assert.equal((await posted("Control+r", "reload")).type, "reload");
      assert.equal((await posted("Control+Shift+E", "openInEditor")).type, "openInEditor");
      assert.equal((await posted("Control+Shift+T", "setTheme")).theme, "dark");
      assert.equal((await posted("Control+Tab", "selectTab")).id, 2);
      assert.equal((await posted("Control+PageDown", "selectTab")).id, 2);
      assert.equal((await posted("Control+2", "selectTab")).id, 2);
      assert.equal((await posted("Control+9", "selectTab")).id, 2);
      assert.equal((await posted("Control+w", "closeTab")).id, 1);
      await host.page.keyboard.press("Control+=");
      assert.equal(await host.page.textContent("#zoomValue"), "110%");
      await host.page.keyboard.press("Control+-");
      assert.equal(await host.page.textContent("#zoomValue"), "100%");
      await host.page.keyboard.press("Control+f");
      assert.equal(await host.page.evaluate(() => document.activeElement.id), "findInput");
    });
  });
});

describe("chrome interactions (VIEW-01)", () => {
  test("tabs: strip, switching, closing, keyboard", async () => {
    await withHost({}, async (host) => {
      await host.send({ type: "tabs", tabs: [{ id: 1, name: "headings.docx", path: "/docs/headings.docx" }], active: 1 });
      await openFixture(host, "headings.docx", { tab: 1 });
      assert.equal(await host.page.isVisible("#tabStrip"), false, "one tab: no strip");

      await host.send({
        type: "tabs",
        tabs: [
          { id: 1, name: "headings.docx", path: "/docs/headings.docx" },
          { id: 2, name: "tables.docx", path: "/docs/tables.docx" }
        ],
        active: 2
      });
      await openFixture(host, "tables.docx", { tab: 2 });
      assert.equal(await host.page.isVisible("#tabStrip"), true);
      assert.equal(await host.page.locator('[role="tab"]').count(), 2);
      assert.equal(await host.page.getAttribute('[role="tab"][aria-selected="true"]', "data-tab-key"), "2");
      assert.ok((await host.page.textContent("#docBody")).includes("Merged across two columns"));
      await screenshot(host, "tabs-light");

      const select = host.waitFor((message) => message.type === "selectTab");
      await host.page.locator('[role="tab"]').first().click();
      assert.deepEqual(await select, { type: "selectTab", id: 1 });

      const close = host.waitFor((message) => message.type === "closeTab");
      await host.page.locator('[role="tab"]').nth(1).locator(".tab-close").click();
      assert.deepEqual(await close, { type: "closeTab", id: 2 });

      await host.page.locator("#docScroller").focus();
      const cycled = host.waitFor((message) => message.type === "selectTab");
      await host.page.keyboard.press("Control+Tab");
      assert.deepEqual(await cycled, { type: "selectTab", id: 1 });
      const closeKey = host.waitFor((message) => message.type === "closeTab");
      await host.page.keyboard.press("Control+w");
      assert.deepEqual(await closeKey, { type: "closeTab", id: 2 });
      const numbered = host.waitFor((message) => message.type === "selectTab");
      await host.page.keyboard.press("Control+1");
      assert.deepEqual(await numbered, { type: "selectTab", id: 1 });

      // The host answers selectTab with tabs and the document.
      await host.send({
        type: "tabs",
        tabs: [{ id: 1, name: "headings.docx", path: "/docs/headings.docx" }, { id: 2, name: "tables.docx", path: "/docs/tables.docx" }],
        active: 1
      });
      await openFixture(host, "headings.docx", { tab: 1, generation: 2 });
      assert.ok((await host.page.textContent("#docBody")).includes("Quarterly field report"));
      assert.ok(!(await host.page.textContent("#docBody")).includes("Merged across two columns"));
    });
  });

  test("theme cycles System, Light, Dark, Dim, Dusk and posts setTheme; pages stay white", async () => {
    await withHost({ theme: "system", colorScheme: "dark" }, async (host) => {
      await openFixture(host, "headings.docx");
      assert.equal(await host.page.textContent("#themeButton"), "System");
      const seen = [];
      for (const expected of ["light", "dark", "dim", "dusk", "system"]) {
        const posted = host.waitFor((message) => message.type === "setTheme");
        await host.page.click("#themeButton");
        seen.push((await posted).theme);
        const attribute = await host.page.getAttribute("html", "data-theme");
        assert.equal(attribute, expected === "system" ? null : expected);
        const colors = await host.page.evaluate(() => {
          const section = document.querySelector("#docBody section.docx");
          const text = Array.from(document.querySelectorAll("#docBody section.docx article p span"))
            .find((span) => span.textContent.includes("This report collects"));
          return [getComputedStyle(section).backgroundColor, getComputedStyle(text).color,
            getComputedStyle(document.getElementById("docScroller")).backgroundColor];
        });
        assert.equal(colors[0], "rgb(255, 255, 255)", "page stays white");
        assert.equal(colors[1], "rgb(0, 0, 0)", "body text stays ink");
        if (expected === "dark" || expected === "dim" || expected === "dusk") {
          assert.notEqual(colors[2], "rgb(244, 242, 238)", `${expected}: canvas darkens`);
        }
      }
      assert.deepEqual(seen, ["light", "dark", "dim", "dusk", "system"]);
      const keyed = host.waitFor((message) => message.type === "setTheme");
      await host.page.keyboard.press("Control+Shift+T");
      assert.equal((await keyed).theme, "light");
      await host.send({ type: "theme", theme: "dark", view: "page" });
      assert.equal(await host.page.textContent("#themeButton"), "Dark");
      await host.send({ type: "theme", theme: "dusk", view: "page" });
      assert.equal(await host.page.textContent("#themeButton"), "Dusk");
      assert.equal(await host.page.getAttribute("html", "data-theme"), "dusk");
      await host.send({ type: "theme", theme: "sepia", view: "page" });
      assert.equal(await host.page.getAttribute("html", "data-theme"), null, "an unknown theme reads as System");
    });
  });

  // As in LeanMark 0.6.0: one fixed dot colour per theme with the same grey
  // ring, so the five dots look different on any toolbar; System is half white,
  // half black. The name never depends on colour alone.
  test("the theme button shows a dot for the theme and a tooltip that names it", async () => {
    for (const [platform, colorScheme] of [["windows", "dark"], ["macos", "light"]]) {
      await withHost({ theme: "system", colorScheme, platform }, async (host) => {
        await openFixture(host, "headings.docx");
        const state = () => host.page.evaluate(() => {
          const button = document.getElementById("themeButton");
          const dot = button.querySelector(".theme-swatch");
          const style = dot ? getComputedStyle(dot) : null;
          return {
            label: button.textContent.trim(),
            title: button.title,
            name: button.getAttribute("aria-label"),
            swatch: dot ? dot.dataset.swatch : null,
            hidden: dot ? dot.getAttribute("aria-hidden") : null,
            color: style ? style.backgroundColor : null,
            image: style ? style.backgroundImage : null,
            size: style ? [style.width, style.height, style.borderTopWidth, style.borderTopColor, style.borderRadius] : null
          };
        });
        const shown = colorScheme === "dark" ? "Dark" : "Light";
        const keys = platform === "macos" ? "Cmd+Shift+T" : "Ctrl+Shift+T";
        let current = await state();
        assert.equal(current.label, "System");
        assert.equal(current.swatch, "system");
        assert.equal(current.hidden, "true", "the dot is decoration only");
        assert.match(current.image, /linear-gradient\(90deg, rgb\(255, 255, 255\) 50%, rgb\(0, 0, 0\) 50%\)/);
        assert.deepEqual(current.size, ["10px", "10px", "1px", "rgb(140, 140, 140)", "50%"]);
        assert.equal(current.title, `Theme: System (${shown}) (${keys})`);
        assert.equal(current.name, `Theme: System (${shown}). Activate to change theme.`);
        const dots = { light: "rgb(255, 255, 255)", dark: "rgb(0, 0, 0)", dim: "rgb(127, 138, 153)", dusk: "rgb(201, 143, 79)" };
        for (const [theme, color] of Object.entries(dots)) {
          await host.page.click("#themeButton");
          current = await state();
          const label = theme.charAt(0).toUpperCase() + theme.slice(1);
          assert.equal(current.swatch, theme);
          assert.equal(current.color, color, `${theme}: dot colour`);
          assert.equal(current.label, label);
          assert.equal(current.title, `Theme: ${label} (${keys})`);
          assert.equal(current.name, `Theme: ${label}. Activate to change theme.`);
        }
        // Back to System; the name follows the platform when it switches.
        await host.page.click("#themeButton");
        const other = colorScheme === "dark" ? "light" : "dark";
        await host.page.emulateMedia({ colorScheme: other });
        await host.page.waitForTimeout(50);
        current = await state();
        const switched = other === "dark" ? "Dark" : "Light";
        assert.equal(current.title, `Theme: System (${switched}) (${keys})`);
      });
    }
  });

  // LeanMark 0.6.0's theme tokens (assets/reader.css in the leanmark
  // repository), which every Lean app uses.
  const LEANMARK_TOKENS = {
    light: { "--canvas": "#faf9f7", "--surface": "#ffffff", "--surface-muted": "#f4f2ee", "--border": "#e8e4dc",
      "--text-primary": "#1a1917", "--text-secondary": "#5a554c", "--text-disabled": "#a7a195",
      "--ring": "#3b82f6", "--link": "#1d4ed8", "--link-hover": "#1e40af", "--selection": "#cbdcff" },
    dark: { "--canvas": "#0e0d0b", "--surface": "#1a1917", "--surface-muted": "#2b2924", "--border": "#2b2924",
      "--text-primary": "#faf9f7", "--text-secondary": "#d5cfc3", "--text-disabled": "#716b5f",
      "--ring": "#3b82f6", "--link": "#60a5fa", "--link-hover": "#93c5fd", "--selection": "#23468c" },
    dim: { "--canvas": "#1e2023", "--surface": "#25282c", "--surface-muted": "#2d3035", "--border": "#393d43",
      "--text-primary": "#c8ccd2", "--text-secondary": "#9ea4ac", "--text-disabled": "#6c727a",
      "--ring": "#6c9be0", "--link": "#86aee6", "--link-hover": "#a6c4ee", "--selection": "#34486a" },
    dusk: { "--canvas": "#221e19", "--surface": "#29241e", "--surface-muted": "#322c25", "--border": "#3f3830",
      "--text-primary": "#d4c8b4", "--text-secondary": "#a99c87", "--text-disabled": "#776c5c",
      "--ring": "#c99a62", "--link": "#e0a86e", "--link-hover": "#ebc08f", "--selection": "#4d3f2c" }
  };

  test("the five themes use LeanMark's colours, and System follows the platform", async () => {
    for (const colorScheme of ["light", "dark"]) {
      await withHost({ theme: "system", colorScheme }, async (host) => {
        await openFixture(host, "headings.docx");
        const resolve = (names) => host.page.evaluate((list) => {
          const probe = document.createElement("span");
          document.body.appendChild(probe);
          const values = {};
          for (const name of list) {
            probe.style.color = `var(${name})`;
            const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g).map(Number);
            values[name] = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
          }
          probe.remove();
          return values;
        }, names);
        const names = Object.keys(LEANMARK_TOKENS.light);
        assert.deepEqual(await resolve(names), LEANMARK_TOKENS[colorScheme], `System on a ${colorScheme} platform`);
        for (const theme of ["light", "dark", "dim", "dusk"]) {
          await host.send({ type: "theme", theme, view: "page" });
          assert.deepEqual(await resolve(names), LEANMARK_TOKENS[theme], `${theme} on a ${colorScheme} platform`);
          const paper = await host.page.$eval("#docBody section.docx", (node) => getComputedStyle(node).backgroundColor);
          assert.equal(paper, "rgb(255, 255, 255)", `${theme}: the page stays paper`);
        }
      });
    }
  });

  // LeanMark 0.6.0's current-section look in "On this page" (its reader.css,
  // .outline a[aria-current="location"]): the muted surface, a 2 px bar in
  // the link colour, the text colour, and no change of weight, so marking an
  // entry repaints it without laying the outline out again.
  test("the current outline entry looks like LeanMark's in every theme", async () => {
    for (const colorScheme of ["light", "dark"]) {
      await withHost({ theme: "system", colorScheme, viewport: { width: 1280, height: 700 } }, async (host) => {
        await openFixture(host, "headings.docx");
        // A second-level entry, whose weight is the plain one.
        await host.page.locator("#outlineList a", { hasText: "Sampling" }).click();
        const look = () => host.page.evaluate(() => {
          const current = document.querySelector('#outlineList a[aria-current="location"]');
          const level = current.dataset.level;
          const other = Array.from(document.querySelectorAll(`#outlineList a[data-level="${level}"]`))
            .find((node) => node !== current);
          const style = getComputedStyle(current);
          const nested = document.querySelector('#outlineList a[data-level="2"]');
          const label = document.getElementById("outlineLabel").getBoundingClientRect().left;
          const text = (node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getClientRects()[0].left;
          };
          return {
            background: style.backgroundColor,
            bar: style.boxShadow,
            color: style.color,
            weightSame: !other || getComputedStyle(other).fontWeight === style.fontWeight,
            padding: [style.paddingTop, style.paddingRight, style.paddingBottom],
            radius: style.borderTopLeftRadius,
            nested: nested ? getComputedStyle(nested).paddingLeft : null,
            first: getComputedStyle(document.querySelector('#outlineList a[data-level="1"]')).paddingLeft,
            current: current.textContent,
            labelAligned: Math.abs(label - text(document.querySelector('#outlineList a[data-level="1"]'))) <= 1
          };
        });
        const rgb = (hex) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
        for (const theme of ["system", "light", "dark", "dim", "dusk"]) {
          await host.send({ type: "theme", theme, view: "page" });
          const tokens = LEANMARK_TOKENS[theme === "system" ? colorScheme : theme];
          const seen = await look();
          assert.deepEqual(seen, {
            background: rgb(tokens["--surface-muted"]),
            bar: `${rgb(tokens["--link"])} 2px 0px 0px 0px inset`,
            color: rgb(tokens["--text-primary"]),
            weightSame: true,
            padding: ["5px", "8px", "5px"],
            first: "12px",
            radius: "4px",
            nested: "28px",
            current: "Sampling",
            labelAligned: true
          }, `${theme} on a ${colorScheme} platform`);
        }
      });
    }
  });

  test("view switch re-renders from the cached package and posts setView", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "tables.docx");
      const requestsBefore = host.requests.filter((url) => url.includes("/pkg/")).length;
      assert.equal(await host.page.locator("#docBody section.docx > header").count() > 0, true);
      const posted = host.waitFor((message) => message.type === "setView");
      await switchView(host, "reading");
      assert.deepEqual(await posted, { type: "setView", view: "reading" });
      assert.equal(await host.page.getAttribute("html", "data-view"), "reading");
      assert.equal(await host.page.getAttribute("#viewReading", "aria-pressed"), "true");
      assert.equal(await host.page.locator("#docBody section.docx > header").count(), 0, "no headers in reading view");
      const width = await host.page.$eval("#docBody .docx-wrapper", (node) => node.getBoundingClientRect().width);
      assert.ok(width <= 700, `reading column is capped (${width}px)`);
      assert.equal(host.requests.filter((url) => url.includes("/pkg/")).length, requestsBefore, "no new fetch");
      await screenshot(host, "reading-view-light");

      const keyed = host.waitFor((message) => message.type === "setView");
      const rendered = nextRendered(host);
      await host.page.locator("#docScroller").focus();
      await host.page.keyboard.press("Control+Shift+V");
      assert.equal((await keyed).view, "page");
      await rendered;
      assert.equal(await host.page.locator("#docBody section.docx > header").count() > 0, true);

      // A theme message carrying a view switches without posting setView.
      const before = host.ofType("setView").length;
      const reRendered = nextRendered(host);
      await host.send({ type: "theme", theme: "light", view: "reading" });
      await reRendered;
      assert.equal(host.ofType("setView").length, before);
    });
  });

  // Each switch unzipped and parsed the whole package again: 186 to 383 ms of
  // a 900 to 1,150 ms switch for a 300-page report in WebKitGTK.
  test("a switch back to a view renders without parsing the package again", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "tables.docx");
      await host.page.evaluate(() => {
        window.__parses = 0;
        const parse = window.docx.parseAsync;
        window.docx.parseAsync = function () {
          window.__parses += 1;
          return parse.apply(this, arguments);
        };
      });
      // The first switch to each view parses; a document only opened keeps
      // nothing extra, so its memory is unchanged.
      await switchView(host, "reading");
      await switchView(host, "page");
      await switchView(host, "reading");
      await switchView(host, "page");
      await switchView(host, "reading");
      assert.equal(await host.page.evaluate(() => window.__parses), 2,
        "only the first switch to each view parses the package");
      assert.equal(await host.page.getAttribute("html", "data-view"), "reading");
    });
  });

  // The render changes the model it is given, so a view rendered again must
  // start from the model as it was before its first render.
  test("a view rendered again matches its first render", async () => {
    const files = ["headings.docx", "tables.docx", "bullets.docx", "arabic.docx", "images.docx"]
      .concat(["numbering.docx", "notes.docx", "headers-footers.docx", "styles.docx", "breaks.docx",
        "theme.docx", "arabic-table.docx", "tracked-changes.docx", "long-300-pages.docx"]
        .map((name) => path.join(repositoryRoot, "tests", "fixtures", "features", name)));
    await withHost({ viewport: { width: 1280, height: 860 } }, async (host) => {
      const snapshot = () => host.page.evaluate(() => {
        const clean = (text) => text.replace(/blob:[^"')\s]+/g, "blob:");
        return clean(document.getElementById("docStyles").innerHTML) + "\n" +
          clean(document.getElementById("docBody").innerHTML);
      });
      let generation = 1;
      for (const file of files) {
        const { bytes, report } = fixture(file);
        await host.openDocument({ bytes, report, generation, fileName: path.basename(file) });
        generation += 1;
        const page = await snapshot();
        await switchView(host, "reading");
        const reading = await snapshot();
        // Three times, so a copy reused by one render cannot pass for a fresh one.
        for (const round of [2, 3, 4]) {
          await switchView(host, "page");
          assert.ok(await snapshot() === page, `${path.basename(file)}: page view render ${round} differs`);
          await switchView(host, "reading");
          assert.ok(await snapshot() === reading, `${path.basename(file)}: reading view render ${round} differs`);
        }
        await switchView(host, "page");
      }
    });
  });

  test("reading position is kept by ratio across a view switch", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "headings.docx");
      await host.page.$eval("#docScroller", (node) => {
        node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.5;
      });
      await switchView(host, "reading");
      const ratio = await host.page.$eval("#docScroller", (node) =>
        node.scrollTop / (node.scrollHeight - node.clientHeight));
      assert.ok(Math.abs(ratio - 0.5) < 0.05, `ratio ${ratio}`);
    });
  });

  test("zoom: steps, limits, fit width, reset, and Ctrl+wheel", async () => {
    await withHost({ viewport: { width: 1400, height: 900 } }, async (host) => {
      await openFixture(host, "headings.docx");
      const pageWidth = () => host.page.$eval("#docBody section.docx", (node) => node.getBoundingClientRect().width);
      const label = () => host.page.textContent("#zoomValue");
      assert.equal(await label(), "100%");
      const base = await pageWidth();
      await host.page.click("#zoomIn");
      assert.equal(await label(), "110%");
      await zoomSettled(host);
      assert.ok(Math.abs(await pageWidth() - base * 1.1) < 2, "page grows by 10%");
      for (let index = 0; index < 20; index += 1) {
        await host.page.keyboard.press("Control+=");
      }
      assert.equal(await label(), "300%");
      assert.equal(await host.page.isDisabled("#zoomIn"), true);
      for (let index = 0; index < 20; index += 1) {
        await host.page.click("#zoomOut", { force: true }).catch(() => {});
      }
      assert.equal(await label(), "50%");
      await zoomSettled(host);
      assert.ok(Math.abs(await pageWidth() - base * 0.5) < 2, "page shrinks to half");
      await host.page.click("#zoomValue");
      assert.equal(await host.page.getAttribute("html", "data-zoom-mode"), "fit");
      await zoomSettled(host);
      const available = await host.page.$eval("#docScroller", (node) => node.clientWidth);
      const fitted = await pageWidth();
      assert.ok(Math.abs(fitted - (available - 64)) < 3, `fit width ${fitted} in ${available}`);
      await host.page.click("#zoomValue");
      assert.equal(await label(), "100%");
      await host.page.locator("#docScroller").hover();
      await host.page.keyboard.down("Control");
      await host.page.mouse.wheel(0, -120);
      await host.page.keyboard.up("Control");
      assert.equal(await label(), "110%");
      await host.page.keyboard.press("Control+0");
      assert.equal(await host.page.getAttribute("html", "data-zoom-mode"), "auto");
      assert.equal(await label(), "100%");
    });
  });

  // Each layout of the 300-page report took 182 to 210 ms in WebKitGTK, and
  // three steps in one frame (Ctrl+wheel, a held key) laid it out three times.
  test("zoom steps in one frame are laid out once and keep the position", async () => {
    await withHost({ viewport: { width: 1400, height: 600 } }, async (host) => {
      await openFixture(host, "headings.docx");
      const result = await host.page.evaluate(async () => {
        const wrapper = document.querySelector("#docBody .docx-wrapper");
        const scroller = document.getElementById("docScroller");
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.4;
        let changes = 0;
        const observer = new MutationObserver((records) => { changes += records.length; });
        observer.observe(wrapper, { attributes: true, attributeFilter: ["style"] });
        for (let step = 0; step < 3; step += 1) {
          document.getElementById("zoomIn").click();
        }
        const label = document.getElementById("zoomValue").textContent;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        observer.disconnect();
        return {
          changes,
          label,
          zoom: wrapper.style.zoom,
          ratio: scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight),
          pending: document.documentElement.hasAttribute("data-zoom-pending")
        };
      });
      assert.equal(result.label, "150%", "the label follows each step at once");
      assert.equal(result.zoom, "1.5");
      assert.equal(result.changes, 1, "three steps change the zoom once");
      assert.ok(Math.abs(result.ratio - 0.4) < 0.02, `position kept: ${result.ratio}`);
      assert.equal(result.pending, false);
    });
  });

  test("zoom falls back to a transform where CSS zoom is missing", async () => {
    const initScript = "(() => { const supports = CSS.supports.bind(CSS); CSS.supports = (property, value) => property === \"zoom\" ? false : supports(property, value); })();";
    await withHost({ initScript }, async (host) => {
      await openFixture(host, "headings.docx");
      assert.equal(await host.page.evaluate(() => CSS.supports("zoom", "2")), false);
      const measure = () => host.page.evaluate(() => {
        const scroller = document.getElementById("docScroller");
        const page = document.querySelector("#docBody section.docx").getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        return {
          width: page.width,
          left: page.left - box.left,
          right: box.right - page.right,
          scrollWidth: scroller.scrollWidth,
          scrollHeight: scroller.scrollHeight
        };
      });
      const base = await measure();
      for (let index = 0; index < 3; index += 1) {
        await host.page.click("#zoomIn");
      }
      await zoomSettled(host);
      const large = await measure();
      assert.equal(await host.page.textContent("#zoomValue"), "150%");
      assert.ok(Math.abs(large.width - base.width * 1.5) < 2, "page is scaled");
      assert.ok(large.scrollWidth >= large.width, "the scaled page can be scrolled to");
      assert.ok(large.scrollHeight > base.scrollHeight * 1.4, "scroll height follows the scale");
      for (let index = 0; index < 8; index += 1) {
        await host.page.click("#zoomOut", { force: true }).catch(() => {});
      }
      await zoomSettled(host);
      const small = await measure();
      assert.ok(Math.abs(small.width - base.width * 0.5) < 2, "page is scaled down");
      assert.ok(Math.abs(small.left - small.right) < 4, "a small page stays centred");
    });
  });

  test("outline click scrolls to the heading and marks the current section", async () => {
    await withHost({ viewport: { width: 1280, height: 700 } }, async (host) => {
      const { report } = await openFixture(host, "headings.docx");
      const last = report.outline.length - 1;
      await host.page.locator("#outlineList a").nth(last).click();
      await host.page.waitForTimeout(50);
      const position = await host.page.evaluate((index) => {
        const target = document.querySelector(`[data-ld-target="${index}"]`);
        const scroller = document.getElementById("docScroller");
        return {
          text: target.textContent.trim(),
          offset: target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        };
      }, last);
      assert.equal(position.text, report.outline[last].text);
      assert.ok(position.offset >= 0 && position.offset < 40, `heading at ${position.offset}px`);
      assert.equal(await host.page.getAttribute(`#outlineList a[data-index="${last}"]`, "aria-current"), "location");
      await host.page.$eval("#docScroller", (node) => { node.scrollTop = 0; });
      // The mark moves in the next frame; a busy runner may need more than one.
      await host.page.waitForFunction(() =>
        document.querySelector('#outlineList a[data-index="0"]').getAttribute("aria-current") === "location",
      null, { timeout: 3000 }).catch(() => {});
      assert.equal(await host.page.getAttribute('#outlineList a[data-index="0"]', "aria-current"), "location");
      await host.page.click("#outlineToggle");
      assert.equal(await host.page.isVisible("#outlineList"), false);
      await host.page.click("#outlineToggle");
      assert.equal(await host.page.isVisible("#outlineList"), true);
    });
  });

  // After a long jump, the pages that come into view are still skipped by
  // content-visibility in the first frame, so their headings report places
  // they do not have yet. The outline then marked a section several entries
  // off (Section 126 for 121 at 40 percent), and nothing scrolled again to
  // correct it.
  test("the current section is right after a long jump, once scrolling stops", async () => {
    await withHost({ viewport: { width: 1280, height: 800 } }, async (host) => {
      const expected = JSON.parse(readFileSync(path.resolve(repositoryRoot, fixtures.config.coreExpectedFile), "utf8"));
      const outline = expected["features/long-300-pages.docx"].outline
        .map(([level, text, paragraph]) => ({ level, text, paragraph }));
      const file = path.join(repositoryRoot, "tests", "fixtures", "features", "long-300-pages.docx");
      const { bytes, report } = fixture(file, { outline });
      await host.openDocument({ bytes, report, fileName: "long-300-pages.docx" });
      // The reader settles the position it opened at in the frame after it
      // reports the render; a jump before that frame would be undone.
      await host.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      for (const share of [0.4, 0.75, 0.2]) {
        await host.page.evaluate((value) => {
          const scroller = document.getElementById("docScroller");
          scroller.scrollTop = scroller.scrollHeight * value;
        }, share);
        // Nothing scrolls after the jump. A slow runner may need longer than
        // a fast one to lay out the pages it lands on, so the check waits up
        // to 3 s for the mark to settle on the right section.
        const settled = Date.now() + 3000;
        let state;
        do {
          await host.page.waitForTimeout(150);
          state = await host.page.evaluate(() => {
          const scroller = document.getElementById("docScroller");
          const top = scroller.getBoundingClientRect().top;
          const threshold = Math.max(48, scroller.clientHeight * 0.25);
          let wanted = 0;
          document.querySelectorAll("#docBody [data-ld-target]").forEach((node) => {
            if (node.getBoundingClientRect().top - top <= threshold) {
              wanted = Math.max(wanted, Number(node.getAttribute("data-ld-target")));
            }
          });
          const marks = document.querySelectorAll("#outlineList [aria-current]");
          const marked = marks[0];
          return {
            wanted,
            wantedText: document.querySelector(`#outlineList a[data-index="${wanted}"]`).textContent,
            marked: marked ? Number(marked.dataset.index) : -1,
            markedText: marked ? marked.textContent : "",
            marks: marks.length,
            scrollTop: document.getElementById("docScroller").scrollTop
          };
        });
        } while (state.marked !== state.wanted && Date.now() < settled);
        assert.equal(state.marks, 1, "one entry is marked");
        assert.equal(state.marked, state.wanted,
          `at ${share * 100}%: marked ${state.markedText}, the section on screen is ${state.wantedText} ` +
          `(scrollTop ${state.scrollTop})`);
      }
    });
  });

  test("outline entries whose index misses fall back to the heading text", async () => {
    await withHost({}, async (host) => {
      const { report } = fixture("headings.docx");
      const shifted = report.outline.map((entry) => ({ ...entry, paragraph: entry.paragraph + 1 }));
      shifted.push({ level: 1, text: "A heading that is not in the document", paragraph: 9999 });
      await openFixture(host, "headings.docx", { report: { outline: shifted } });
      const targets = await host.page.$$eval("#docBody [data-ld-target]", (nodes) =>
        nodes.map((node) => [Number(node.dataset.ldTarget), node.textContent.trim()]));
      assert.deepEqual(targets, report.outline.map((entry, index) => [index, entry.text]));
      assert.equal(await host.page.locator("#outlineList a").count(), shifted.length);
      await host.page.locator("#outlineList a").last().click();
    });
  });

  test("links post link and never navigate; others are plain text", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "hyperlinks.docx");
      const url = host.page.url();
      const web = host.waitFor((message) => message.type === "link");
      await clickText(host, "Example site");
      assert.deepEqual(await web, { type: "link", href: "https://example.com/leandoc" });
      const mail = host.waitFor((message) => message.type === "link");
      await clickText(host, "Write to the reader");
      assert.deepEqual(await mail, { type: "link", href: "mailto:reader@example.com" });
      const before = host.ofType("link").length;
      await host.page.getByText("Script text").click();
      await host.page.getByText("Local file text").click();
      await host.page.waitForTimeout(100);
      assert.equal(host.ofType("link").length, before, "no link message for javascript: or file:");
      assert.equal(await host.page.locator('#docBody a[href^="javascript"], #docBody a[href^="file"]').count(), 0);
      await clickText(host, "Jump to the target");
      await host.page.waitForTimeout(50);
      const offset = await host.page.evaluate(() => {
        const target = Array.from(document.querySelectorAll("#docBody p"))
          .find((p) => p.textContent.includes("Bookmark target paragraph."));
        return target.getBoundingClientRect().top - document.getElementById("docScroller").getBoundingClientRect().top;
      });
      assert.ok(offset >= -2 && offset < 60, `internal link scrolled to the bookmark (${offset}px)`);
      assert.equal(host.page.url(), url, "the reader never navigates");
      assert.equal(host.ofType("link").length, before);
      assert.equal(await host.page.locator("#docBody [id]").count(), 0, "document ids are moved off id");
    });
  });

  test("find: count, Enter, Shift+Enter, F3, Escape", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "headings.docx");
      await host.page.keyboard.press("Control+f");
      assert.equal(await host.page.evaluate(() => document.activeElement.id), "findInput");
      await host.page.keyboard.type("Kingfisher");
      await host.page.waitForFunction(() => document.getElementById("findCount").textContent === "1/10");
      await host.page.keyboard.press("Enter");
      assert.equal(await host.page.textContent("#findCount"), "2/10");
      await host.page.keyboard.press("Shift+Enter");
      await host.page.keyboard.press("Shift+Enter");
      assert.equal(await host.page.textContent("#findCount"), "10/10");
      await host.page.keyboard.press("F3");
      assert.equal(await host.page.textContent("#findCount"), "1/10");
      await host.page.keyboard.press("Shift+F3");
      assert.equal(await host.page.textContent("#findCount"), "10/10");
      await screenshot(host, "find-light");
      await host.page.keyboard.press("Escape");
      assert.equal(await host.page.inputValue("#findInput"), "");
      assert.equal(await host.page.textContent("#findCount"), "");
      assert.equal(await findCount(host, "no such words"), "0");
    });
  });

  // Each search walks the whole document and repaints every match. Typing a
  // word in a 300-page report searched once per key and held the page for up
  // to 0.8 s after a key in WebKitGTK.
  test("find searches after a pause in typing, and at once on Enter, F3, or Escape", async () => {
    const initScript = "(() => { window.__searches = 0; const set = CSS.highlights.set.bind(CSS.highlights); " +
      "CSS.highlights.set = (name, value) => { if (name === 'leandoc-find') { window.__searches += 1; } return set(name, value); }; })();";
    await withHost({ initScript }, async (host) => {
      await openFixture(host, "headings.docx");
      await host.page.focus("#findInput");
      await host.page.keyboard.type("Kingfisher", { delay: 15 });
      await host.page.waitForFunction(() => document.getElementById("findCount").textContent === "1/10");
      await host.page.waitForTimeout(300);
      const searches = await host.page.evaluate(() => window.__searches);
      assert.ok(searches >= 1 && searches <= 3, `typing 10 letters searched ${searches} times`);

      // An emptied box clears the matches at once; there is nothing to wait for.
      await host.page.fill("#findInput", "");
      assert.equal(await host.page.textContent("#findCount"), "");
      assert.equal(await host.page.evaluate(() => CSS.highlights.has("leandoc-find")), false);

      // Enter right after typing runs the waiting search and selects its first match.
      await host.page.fill("#findInput", "Kingfisher");
      await host.page.locator("#findInput").press("Enter");
      assert.equal(await host.page.textContent("#findCount"), "1/10");

      // Shift+F3 right after typing runs it too and goes to the last match.
      await host.page.fill("#findInput", "checklist");
      await host.page.keyboard.press("Shift+F3");
      assert.equal(await host.page.textContent("#findCount"), "1/1");
      await host.page.fill("#findInput", "Kingfisher");
      await host.page.keyboard.press("Shift+F3");
      assert.equal(await host.page.textContent("#findCount"), "10/10");

      // Escape before the pause ends cancels the waiting search.
      await host.page.fill("#findInput", "");
      await host.page.fill("#findInput", "Kingfisher");
      await host.page.locator("#findInput").press("Escape");
      await host.page.waitForTimeout(300);
      assert.equal(await host.page.textContent("#findCount"), "");
      assert.equal(await host.page.evaluate(() => CSS.highlights.has("leandoc-find")), false);
    });
  });

  test("find falls back to marks without the Highlight API and counts the same", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "headings.docx");
      const withHighlights = countFrom(await findCount(host, "the"));
      await host.page.fill("#findInput", "");
      await host.page.evaluate(() => { window.Highlight = undefined; });
      const withMarks = countFrom(await findCount(host, "the"));
      assert.equal(withMarks, withHighlights);
      assert.equal(await host.page.locator("#docBody mark.ld-find").count() >= withMarks, true);
      const text = await host.page.textContent("#docBody");
      await host.page.keyboard.press("Escape");
      await host.page.locator("#findInput").press("Escape");
      assert.equal(await host.page.locator("#docBody mark.ld-find").count(), 0);
      assert.equal(await host.page.textContent("#docBody"), text);
    });
  });

  test("Ctrl+Shift+C copies the document text without headers and footers", async () => {
    await withHost({}, async (host) => {
      await host.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: READER_URL });
      await openFixture(host, "tables.docx");
      await host.page.locator("#docScroller").click({ position: { x: 5, y: 5 } });
      await host.page.keyboard.press("Control+Shift+C");
      await host.page.waitForFunction(() => document.getElementById("liveStatus").textContent === "Document copied as text.");
      const text = await host.page.evaluate(() => navigator.clipboard.readText());
      assert.ok(text.includes("Merged across two columns"));
      assert.ok(text.includes("Second page body text."));
      assert.ok(!text.includes("LeanDoc header text"));
      assert.ok(!text.includes("LeanDoc footer text"));
    });
  });

  test("keyboard shortcuts post open, reload, and openInEditor", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "headings.docx", { tab: 5 });
      await host.page.locator("#docScroller").focus();
      const open = host.waitFor((message) => message.type === "open");
      await host.page.keyboard.press("Control+o");
      await open;
      const reload = host.waitFor((message) => message.type === "reload");
      await host.page.keyboard.press("F5");
      await reload;
      const editor = host.waitFor((message) => message.type === "openInEditor");
      await host.page.keyboard.press("Control+Shift+E");
      assert.deepEqual(await editor, { type: "openInEditor", tab: 5 });
      const button = host.waitFor((message) => message.type === "openInEditor");
      await host.page.click("#editorButton");
      await button;
      const openButton = host.waitFor((message) => message.type === "open");
      await host.page.click("#openButton");
      await openButton;
    });
  });

  test("macOS uses Command for shortcuts", async () => {
    await withHost({ platform: "macos", editor: { kind: "pages", label: "Pages" }, tabs: false }, async (host) => {
      await openFixture(host, "headings.docx");
      assert.equal(await host.page.textContent("#editorButton"), "Open in Pages");
      await host.page.locator("#docScroller").focus();
      const open = host.waitFor((message) => message.type === "open");
      await host.page.keyboard.press("Meta+o");
      await open;
      const before = host.ofType("open").length;
      await host.page.keyboard.press("Control+o");
      await host.page.waitForTimeout(50);
      assert.equal(host.ofType("open").length, before, "Ctrl+O is not the macOS shortcut");
      await host.page.keyboard.press("Meta+=");
      assert.equal(await host.page.textContent("#zoomValue"), "110%");
      assert.match(await host.page.getAttribute("#openButton", "title"), /Cmd\+O/);
    });
  });

  test("the editor button stays hidden until the host names an editor", async () => {
    await withHost({ handshake: false }, async (host) => {
      await openFixture(host, "headings.docx");
      assert.equal(await host.page.isVisible("#editorButton"), false);
      assert.equal(await host.page.isVisible("#fidelityEditor"), false);
      await host.send({ type: "host", platform: "linux", version: "0.1.0", editor: { kind: "libreoffice", label: "LibreOffice" }, tabs: true });
      assert.equal(await host.page.textContent("#editorButton"), "Open in LibreOffice");
      assert.equal(await host.page.isVisible("#editorButton"), true);
    });
    await withHost({}, async (host) => {
      await host.send({ type: "empty", recent: [] });
      assert.equal(await host.page.isVisible("#editorButton"), false, "no editor action without a document");
      assert.equal(await host.page.isVisible("#findInput"), false, "no document controls without a document");
      assert.equal(await host.page.isVisible("#recentSection"), false, "no recent section without recent files");
    });
  });

  test("status messages show a toast", async () => {
    await withHost({}, async (host) => {
      await host.send({ type: "status", message: "Word for the web opened. Upload the file there to edit it.", tone: "info" });
      assert.equal(await host.page.textContent("#statusToast"), "Word for the web opened. Upload the file there to edit it.");
      assert.equal(await host.page.isVisible("#statusToast"), true);
    });
  });

  test("every host delivery path reaches the reader", async () => {
    await withHost({ handshake: false }, async (host) => {
      assert.equal(host.ofType("ready").length, 1);
      await host.sendViaReceive({ type: "theme", theme: "dark", view: "page" });
      assert.equal(await host.page.getAttribute("html", "data-theme"), "dark");
      await host.sendViaReceive(JSON.stringify({ type: "theme", theme: "light", view: "page" }));
      assert.equal(await host.page.getAttribute("html", "data-theme"), "light");
      await host.sendViaWebMessage({ type: "theme", theme: "dark", view: "page" });
      assert.equal(await host.page.getAttribute("html", "data-theme"), "dark");
      await host.send({ type: "theme", theme: "light", view: "page" });
      assert.equal(await host.page.getAttribute("html", "data-theme"), "light");
      await host.send("not json");
      await host.send({ type: "unknown" });
    });
  });
});

describe("generations and scale", () => {
  test("a 1,000-page document shows its first pages at once and never blocks the page for long (P-04)", async () => {
    await withHost({}, async (host) => {
      await host.page.evaluate(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) => list.getEntries().forEach((entry) =>
          window.__longTasks.push(Math.round(entry.duration)))).observe({ type: "longtask" });
      });
      const { bytes, report } = await makeBigDocx(1000);
      await host.openDocument({ bytes, report, fileName: "thousand.docx", wait: false });
      await host.page.waitForFunction(() => !document.getElementById("readerPane").hidden &&
        document.querySelectorAll("#docBody section.docx").length > 0, null, { timeout: 30000 });
      const early = await host.page.evaluate(() => ({
        pages: document.querySelectorAll("#docBody section.docx").length,
        state: document.documentElement.dataset.renderState
      }));
      const rendered = await host.waitFor((message) => message.type === "rendered", 60000, { includePast: true });
      const longest = await host.page.evaluate(() => Math.max(0, ...window.__longTasks));
      assert.ok(early.pages < 1000 && early.state === "loading", `first pages before the rest: ${JSON.stringify(early)}`);
      assert.equal(rendered.pages, 1000);
      assert.equal(await host.page.$$eval("#docBody section.docx", (nodes) => nodes.length), 1000);
      assert.ok(longest < 800, `longest task ${longest} ms`);
      console.log(`# 1,000 pages: reader ${rendered.ms} ms, longest task ${longest} ms, ${early.pages} pages shown first`);
    });
  });

  test("a stale generation is discarded", async () => {
    await withHost({}, async (host) => {
      const first = fixture("tables.docx");
      const second = fixture("headings.docx");
      await host.openDocument({ tab: 1, generation: 1, bytes: first.bytes, report: first.report, fileName: "tables.docx", delay: 600, wait: false });
      const rendered = await host.openDocument({ tab: 1, generation: 2, bytes: second.bytes, report: second.report, fileName: "headings.docx" });
      assert.equal(rendered.generation, 2);
      await host.page.waitForTimeout(900);
      const generations = host.ofType("rendered").map((message) => message.generation);
      assert.deepEqual(generations, [2]);
      assert.equal(host.ofType("renderFailed").length, 0);
      const text = await host.page.textContent("#docBody");
      assert.ok(text.includes("Quarterly field report"));
      assert.ok(!text.includes("Merged across two columns"));
      assert.equal(await host.page.textContent("#fileName"), "headings.docx");
    });
  });

  test("blob URLs of a replaced document are revoked", async () => {
    await withHost({}, async (host) => {
      await openFixture(host, "images.docx");
      const source = await host.page.$eval("#docBody img", (image) => image.src);
      await openFixture(host, "headings.docx", { generation: 2 });
      const status = await host.page.evaluate((url) => new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve("alive");
        probe.onerror = () => resolve("revoked");
        probe.src = url;
      }), source);
      assert.equal(status, "revoked");
      host.consoleErrors = host.consoleErrors.filter((text) => !text.includes("ERR_FILE_NOT_FOUND"));
    });
  });

  test("a 300-page document renders, scrolls, and finds its last line", async () => {
    const big = await makeBigDocx(300);
    await withHost({}, async (host) => {
      const started = Date.now();
      const rendered = await host.openDocument({ bytes: big.bytes, report: big.report, fileName: "long-report.docx" });
      const elapsed = Date.now() - started;
      assert.equal(rendered.pages, 300);
      assert.ok(elapsed < 8000, `rendered in ${elapsed} ms (reader reported ${rendered.ms} ms)`);
      console.log(`# 300 pages: reader ${rendered.ms} ms, round trip ${elapsed} ms`);
      const lazy = await host.page.locator("#docBody section.docx.ld-lazy").count();
      assert.equal(lazy, 300, "pages render lazily");
      assert.equal(await host.page.locator("#outlineList a").count(), 30);
      const scrollStarted = Date.now();
      for (let step = 1; step <= 10; step += 1) {
        await host.page.$eval("#docScroller", (node, fraction) => {
          node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction;
        }, step / 10);
        await host.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      }
      const scrollElapsed = Date.now() - scrollStarted;
      assert.ok(scrollElapsed < 4000, `ten scroll steps in ${scrollElapsed} ms`);
      const visible = await host.page.evaluate(() => {
        const scroller = document.getElementById("docScroller");
        const box = scroller.getBoundingClientRect();
        return Array.from(document.querySelectorAll("#docBody section.docx")).filter((section) => {
          const rect = section.getBoundingClientRect();
          return rect.bottom > box.top && rect.top < box.bottom;
        }).map((section) => section.textContent.slice(0, 12));
      });
      assert.ok(visible.some((text) => text.startsWith("Page 300")), `bottom shows the last page: ${visible}`);
      assert.equal(await findCount(host, "otter"), "1/1");
      await host.page.locator("#outlineList a").nth(15).click();
      assert.equal(await host.page.getAttribute('#outlineList a[data-index="15"]', "aria-current"), "location");
      await screenshot(host, "long-document");
    });
  });
});

describe("page view lays out documents that carry no page breaks", () => {
  // python-docx, pandoc, and other generators write no page break and none of
  // Word's lastRenderedPageBreak markers, so docx-preview put such a document
  // on one page as tall as the whole text.
  test("a generated document with no page breaks is split into full pages", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(30, { pageBreaks: false });
      await host.openDocument({ bytes, report, fileName: "unbroken.docx" });
      const result = await host.page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
        const heights = pages.map((page) => page.offsetHeight);
        const text = document.getElementById("docBody").textContent;
        return {
          pages: pages.length,
          tallest: Math.max(...heights),
          shortest: Math.min(...heights),
          // A paragraph split at a page bottom continues in a part marked data-ld-continued.
          paragraphs: document.querySelectorAll("#docBody section.docx article > p:not([data-ld-continued])").length,
          continued: Array.from(document.querySelectorAll("#docBody section.docx article > p[data-ld-continued]"))
            .map((p) => p.textContent).filter((t) => /Page \d+, paragraph \d+\./.test(t)).length,
          finalMarkers: text.split("Final marker otter.").length - 1,
          firstParagraphs: text.split("Page 1, paragraph 1.").length - 1,
          firstPage: pages[0] ? {
            minHeight: getComputedStyle(pages[0]).minHeight,
            height: pages[0].offsetHeight,
            children: Array.from(pages[0].children).map((node) => node.nodeName + ":" + node.children.length),
            wrapperZoom: pages[0].parentNode.style.zoom || "",
            view: document.documentElement.dataset.view || ""
          } : null
        };
      });
      assert.ok(result.pages >= 20, `${result.pages} pages; first page ${JSON.stringify(result.firstPage)}`);
      // Every page is the page height: none grew to hold the rest of the text.
      assert.ok(result.tallest - result.shortest <= 1, `page heights ${result.shortest} to ${result.tallest}`);
      // 30 x 7 body paragraphs and 3 chapter headings, each shown once.
      assert.equal(result.paragraphs, 213);
      // A continued part never repeats its paragraph's opening.
      assert.equal(result.continued, 0);
      assert.equal(result.firstParagraphs, 1);
      assert.equal(result.finalMarkers, 1);
      const meta = await host.page.evaluate(() => {
        const node = document.querySelector("[data-ld-file-meta], #fileMeta, .file-meta");
        return node ? node.textContent : null;
      });
      assert.ok(meta && meta.includes(`${result.pages} pages`), `header shows the page count: ${meta}`);
    });
  });

  test("a paragraph split between pages copies as one line", async () => {
    await withHost({}, async (host) => {
      await host.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: READER_URL });
      const { bytes, report } = await makeBigDocx(30, { pageBreaks: false });
      await host.openDocument({ bytes, report, fileName: "unbroken.docx" });
      // The continued part opens the next page; its first part ends the page before.
      const split = await host.page.evaluate(() => {
        const paragraphs = Array.from(document.querySelectorAll("#docBody article > p"));
        return paragraphs.map((rest, index) => (rest.hasAttribute("data-ld-continued") && index > 0
          ? { first: paragraphs[index - 1].textContent, whole: paragraphs[index - 1].textContent + rest.textContent } : null)).filter(Boolean);
      });
      assert.ok(split.length > 0 && split.every((part) => /^Page \d+, paragraph \d+\./.test(part.first)), JSON.stringify(split.slice(0, 2)));
      await host.page.locator("#docScroller").click({ position: { x: 5, y: 5 } });
      await host.page.keyboard.press("Control+Shift+C");
      await host.page.waitForFunction(() => document.getElementById("liveStatus").textContent === "Document copied as text.");
      // The Windows clipboard ends lines with CRLF.
      const lines = (await host.page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/);
      for (const part of split) {
        assert.ok(lines.includes(part.whole), `one line: ${part.whole.slice(0, 40)}`);
      }
      for (let page = 1; page <= 30; page += 1) {
        for (let paragraph = 1; paragraph <= 7; paragraph += 1) {
          const opening = `Page ${page}, paragraph ${paragraph}.`;
          assert.equal(lines.filter((line) => line.startsWith(opening)).length, 1, opening);
        }
      }
    });
  });
});

describe("page view follows Word's column and section layout", () => {
  // Expected values come from Word itself: tests/reader/make-columns-docx.mjs exported
  // to PDF by Word 16 gives 5 pages. A two-column section that runs past a page
  // fills the left column, then the right, to the bottom margin; a section that ends
  // at a continuous break has its columns balanced; the final section is not
  // balanced; a footnote prints at the foot of the page that refers to it; headings
  // are 10 pt although their linked character style says 20 pt.
  async function layout(host) {
    return host.page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
      return pages.map((page, index) => {
        const box = page.getBoundingClientRect();
        const style = getComputedStyle(page);
        const footer = Array.from(page.children).filter((c) => c.nodeName === "FOOTER").pop();
        let limit = box.top + parseFloat(style.minHeight) - parseFloat(style.paddingBottom);
        if (footer) {
          const reach = footer.offsetHeight - (parseFloat(getComputedStyle(footer).minHeight) || 0);
          if (reach > 0) {
            limit -= reach;
          }
        }
        const notes = Array.from(page.children).filter((c) => c.nodeName === "OL");
        const noteTop = notes.length ? Math.min(...notes.map((n) => n.getBoundingClientRect().top)) : null;
        const articles = Array.from(page.children).filter((c) => c.nodeName === "ARTICLE").map((article) => {
          const a = article.getBoundingClientRect();
          const columns = parseInt(getComputedStyle(article).columnCount, 10) || 1;
          const mid = a.left + a.width / 2;
          const paras = Array.from(article.querySelectorAll(":scope > p")).map((p) => {
            const m = /^(S\d) para (\d+)\./.exec(p.textContent.trim());
            const rects = Array.from(p.getClientRects());
            return m ? {
              section: m[1], n: Number(m[2]),
              column: columns > 1 && rects[0].left >= mid ? "R" : "L",
              top: rects[0].top - box.top, bottom: Math.max(...rects.map((r) => r.bottom)) - box.top
            } : null;
          }).filter(Boolean);
          return { columns, top: a.top - box.top, bottom: a.bottom - box.top, paras };
        });
        return {
          index: index + 1, height: page.offsetHeight, limit: limit - box.top,
          noteTop: noteTop === null ? null : noteTop - box.top,
          notes: notes.map((n) => n.textContent), articles
        };
      });
    });
  }

  function sectionOn(page, section) {
    const paras = page.articles.flatMap((a) => a.paras.filter((p) => p.section === section));
    const column = (c) => paras.filter((p) => p.column === c);
    const lowest = (list) => (list.length ? Math.max(...list.map((p) => p.bottom)) : null);
    return { paras, left: column("L"), right: column("R"), leftBottom: lowest(column("L")), rightBottom: lowest(column("R")) };
  }

  test("headings take the paragraph style's size, not the linked character style's", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeColumnsDocx();
      await host.openDocument({ bytes, report, fileName: "columns.docx" });
      const sizes = await host.page.evaluate(() => {
        const find = (text) => Array.from(document.querySelectorAll("#docBody article p")).find((p) => p.textContent.trim() === text);
        const size = (p) => getComputedStyle(p.querySelector("span") || p).fontSize;
        return { heading: size(find("I. Introduction")), title: size(find("Columns Paper Title")) };
      });
      // 10 pt and 24 pt, as Word prints them; the linked styles say 20 pt and 28 pt.
      assert.equal(sizes.heading, "13.3333px");
      assert.equal(sizes.title, "32px");
    });
  });

  // docx-preview's style sheet hyphenates every document; Word hyphenates only
  // when settings.xml turns automatic hyphenation on, and this one does not.
  test("text is not hyphenated unless the document turns hyphenation on", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeColumnsDocx();
      await host.openDocument({ bytes, report, fileName: "columns.docx" });
      const hyphens = await host.page.evaluate(() => {
        const paragraph = Array.from(document.querySelectorAll("#docBody article p")).find((p) => p.textContent.startsWith("S2 para 1."));
        return [getComputedStyle(paragraph).hyphens, getComputedStyle(paragraph.querySelector("span")).hyphens];
      });
      assert.deepEqual(hyphens, ["manual", "manual"]);
    });
  });

  test("a two-column section fills left then right, balances where it ends, and keeps every paragraph", async () => {
    await withHost({}, async (host) => {
      const { bytes, report, longParagraphs } = await makeColumnsDocx();
      await host.openDocument({ bytes, report, fileName: "columns.docx" });
      const pages = await layout(host);
      const line = 16;
      const heights = pages.map((p) => p.height);
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `page heights ${heights}`);
      const seen = pages.flatMap((p) => p.articles.flatMap((a) => a.paras.map((q) => `${q.section}-${q.n}`)));
      assert.equal(seen.length, new Set(seen).size, "no paragraph is shown twice");
      assert.equal(seen.filter((k) => k.startsWith("S2-")).length, longParagraphs);
      assert.equal(seen.filter((k) => k.startsWith("S4-")).length, 6);
      assert.equal(seen.filter((k) => k.startsWith("S5-")).length, 2);
      assert.equal(pages.length, 5, `pages: ${pages.length}; Word gives 5`);

      const s2Pages = pages.filter((p) => sectionOn(p, "S2").paras.length);
      const s2Last = s2Pages[s2Pages.length - 1];
      for (const page of s2Pages.slice(0, -1)) {
        const s2 = sectionOn(page, "S2");
        const floor = (page.noteTop ?? page.limit) - 2 * line;
        assert.ok(s2.leftBottom >= floor, `page ${page.index}: left column ends at ${s2.leftBottom}; text ends at ${floor + 2 * line}`);
        assert.ok(s2.rightBottom >= floor, `page ${page.index}: right column ends at ${s2.rightBottom}; text ends at ${floor + 2 * line}`);
        assert.ok(Math.max(...s2.left.map((p) => p.n)) <= Math.min(...s2.right.map((p) => p.n)), `page ${page.index}: columns out of order`);
      }
      const end = sectionOn(s2Last, "S2");
      assert.ok(end.left.length && end.right.length, `page ${s2Last.index}: both columns used where S2 ends`);
      assert.ok(Math.abs(end.leftBottom - end.rightBottom) <= 2 * line,
        `page ${s2Last.index}: S2 columns end at ${end.leftBottom} and ${end.rightBottom}`);
      assert.ok(end.leftBottom < s2Last.limit - 4 * line, `page ${s2Last.index}: balanced columns stop above the bottom`);

      const last = pages[pages.length - 1];
      const s5 = sectionOn(last, "S5");
      assert.ok(s5.paras.length >= 1, "the final section ends on the last page");
      assert.equal(s5.right.length, 0, "the final section keeps to the left column");
    });
  });

  // Word sets both S5 paragraphs on page 5. LeanDoc lets every space of a
  // justified line shrink by a quarter (Fixups.justifiedWordSpacing); Word
  // takes the next word only when that shrink is also small beside the
  // stretch the line would need without it. Here LeanDoc's lines take a
  // word more five times over four pages, and the first S5 paragraph ends
  // page 4. A fixed quarter still matches the most of 35 real documents.
  test("the final section starts on the last page, as in Word", { todo: "Word's justified line breaking" }, async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeColumnsDocx();
      await host.openDocument({ bytes, report, fileName: "columns.docx" });
      const pages = await layout(host);
      assert.equal(sectionOn(pages[pages.length - 1], "S5").paras.length, 2);
    });
  });

  test("sections stack without the page's spare space between them", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeColumnsDocx();
      await host.openDocument({ bytes, report, fileName: "columns.docx" });
      const pages = await layout(host);
      const last = pages[pages.length - 1];
      for (let i = 1; i < last.articles.length; i += 1) {
        const gap = last.articles[i].top - last.articles[i - 1].bottom;
        assert.ok(gap <= 2, `page ${last.index}: ${gap}px between sections ${i} and ${i + 1}`);
      }
    });
  });

  test("a footnote prints at the foot of the page that refers to it", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeColumnsDocx();
      await host.openDocument({ bytes, report, fileName: "columns.docx" });
      const pages = await layout(host);
      const withNote = pages.filter((p) => p.notes.some((t) => t.includes("Footnote marker heron")));
      assert.equal(withNote.length, 1, "the footnote appears once");
      assert.equal(withNote[0].index, 1, `the footnote is on page ${withNote[0].index}; its reference is on page 1`);
      const lowestText = Math.max(...withNote[0].articles.flatMap((a) => a.paras.map((p) => p.bottom)));
      assert.ok(withNote[0].noteTop >= lowestText, "the footnote sits below the page's text");
      assert.equal(sectionOn(pages[0], "S2").paras[0].n, 1, "the reference (S2 para 1) is on page 1");
    });
  });
});

describe("page view follows Word's tables and equations", () => {
  async function openTables(host) {
    const { bytes, report, longRows } = await makeTablesDocx();
    await host.openDocument({ bytes, report, fileName: "tables-layout.docx" });
    return longRows;
  }

  function tablesWith(host, text) {
    return host.page.evaluate((text) => {
      return Array.from(document.querySelectorAll("#docBody table"))
        .filter((table) => table.textContent.includes(text))
        .map((table) => ({
          page: Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).indexOf(table.closest("section.docx")) + 1,
          rows: Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => {
            const style = getComputedStyle(cell);
            return {
              text: cell.textContent.trim(), width: cell.getBoundingClientRect().width,
              top: style.borderTopStyle, bottom: style.borderBottomStyle,
              paddingTop: style.paddingTop, paddingBottom: style.paddingBottom
            };
          }))
        }));
    }, text);
  }

  // docx-preview wrote a subscript of several runs as an <mn> holding one <ms>
  // per run, which Chrome stacks: "sess" printed one letter per line.
  test("a subscript written run by run sets on one line", async () => {
    await withHost({}, async (host) => {
      await openTables(host);
      const result = await host.page.evaluate(() => {
        const math = Array.from(document.querySelectorAll("#docBody math")).find((m) => m.textContent === "Esess");
        const script = math && math.querySelector("msub").lastElementChild;
        const size = math && parseFloat(getComputedStyle(math).fontSize);
        return math ? {
          tokensWithElements: math.querySelectorAll("mn > *, ms > *, mi > *, mo > *, mtext > *").length,
          scriptName: script.nodeName, height: script.getBoundingClientRect().height, width: script.getBoundingClientRect().width, size
        } : null;
      });
      assert.ok(result, "the equation renders");
      assert.equal(result.tokensWithElements, 0);
      assert.equal(result.scriptName, "mrow");
      assert.ok(result.height < result.size * 1.5, `the subscript is ${result.height}px tall at ${result.size}px type`);
      assert.ok(result.width > result.height, `the subscript is wider (${result.width}) than tall (${result.height})`);
    });
  });

  // Word draws w:tblBorders top above the first row and bottom below the
  // last; docx-preview drew both on every cell.
  test("a three-line table is ruled above, under its header, and below only", async () => {
    await withHost({}, async (host) => {
      await openTables(host);
      const [table] = await tablesWith(host, "Dimension");
      const [header, first, middle, last] = table.rows;
      assert.ok(header.every((cell) => cell.top === "solid" && cell.bottom === "solid"), JSON.stringify(header));
      assert.ok(first.every((cell) => cell.top === "none" && cell.bottom === "none"), JSON.stringify(first));
      assert.ok(middle.every((cell) => cell.top === "none" && cell.bottom === "none"), JSON.stringify(middle));
      assert.ok(last.every((cell) => cell.top === "none" && cell.bottom === "solid"), JSON.stringify(last));
      // Word's default top and bottom cell margins are zero; the browser's are 1px.
      assert.ok([...header, ...first].every((cell) => cell.paddingTop === "0px" && cell.paddingBottom === "0px"));
    });
  });

  // Word fits a table of automatic width to its content; docx-preview kept
  // pandoc's equal grid columns.
  test("a table of automatic width fits its columns to the content", async () => {
    await withHost({}, async (host) => {
      await openTables(host);
      const [table] = await tablesWith(host, "Dimension");
      const widths = table.rows[1].map((cell) => cell.width);
      assert.ok(widths[3] > widths[0] * 1.5, `columns ${widths.map(Math.round)}`);
    });
  });

  test("a table split across pages keeps its column widths and every row once", async () => {
    await withHost({}, async (host) => {
      const longRows = await openTables(host);
      const parts = await tablesWith(host, "A longer description of row");
      assert.ok(parts.length >= 2, `${parts.length} parts`);
      assert.deepEqual(parts.map((part) => part.page), parts.map((_, index) => parts[0].page + index), "one part per page");
      const widths = (part) => part.rows[part.rows.length - 1].map((cell) => cell.width);
      for (const part of parts.slice(1)) {
        widths(part).forEach((width, index) => {
          assert.ok(Math.abs(width - widths(parts[0])[index]) <= 0.5, `column ${index}: ${width} against ${widths(parts[0])[index]}`);
        });
      }
      const labels = parts.flatMap((part) => part.rows.map((row) => row[0].text)).filter((text) => /^Row \d+$/.test(text));
      assert.deepEqual(labels, Array.from({ length: longRows }, (_, index) => `Row ${index + 1}`));
    });
  });

  // Four display equations wider than their column. The first two are sets
  // of names separated by commas, the second in a borderless table beside
  // its number; the third is a sum and the fourth a quotient. Word breaks
  // the sets after commas into four lines each, the sum before its plus
  // signs into three, and the quotient before "=", "/" and "-" into four,
  // all inside the left column (72 to 288 pt): the first set from 75.7 to
  // 284.3 pt, the second from 72.5 to 287.6 pt with "(1)" ending at
  // 290.1 pt, the sum from 79.5 to 283.2 pt, the quotient from 98.3 to
  // 261.8 pt. What follows each starts below it, the right column's
  // text beside them is untouched, and the spaces around a break stay. Chrome's
  // MathML does not wrap: the first set ran to 409 pt, and the second widened
  // its table across the gap, both over the right column's text. A short
  // numbered equation in the right column, in a table of fixed widths that
  // reaches past the column, fits its cell and stays on one line from
  // 324.85 pt; Word prints its "(2)" past the column, to 575.4 pt.
  async function equationLayout(host, options = {}) {
    const { bytes, report } = await makeEquationDocx(options);
    await host.openDocument({ bytes, report, fileName: "equation-columns.docx" });
    return host.page.evaluate(() => {
        const page = document.querySelector("#docBody .docx-wrapper > section.docx");
        const box = page.getBoundingClientRect();
        const scale = box.width / page.offsetWidth;
        const points = (value) => value / scale * 0.75;
        const groups = new Map();
        page.querySelectorAll("math").forEach((math) => {
          const paragraph = math.closest("p");
          const tokens = Array.from(math.querySelectorAll("ms, mi, mn, mo, mtext")).filter((token) => token.textContent.trim());
          groups.set(paragraph, (groups.get(paragraph) || []).concat(tokens));
        });
        const tail = Array.from(page.querySelectorAll("p")).find((p) => p.textContent.startsWith("Left tail para"));
        const range = document.createRange();
        range.selectNodeContents(tail);
        const rightLines = Array.from(range.getClientRects()).filter((line) => points(line.left - box.left) > 300);
        const number = Array.from(page.querySelectorAll("p")).find((p) => p.textContent.trim() === "(1)");
        range.selectNodeContents(number);
        const numberRight = points(range.getBoundingClientRect().right - box.left);
        // The gap before the first glyph `after`, from the glyph printed
        // before it, or null when a break falls between them.
        const gap = (tokens, after) => {
          const glyphs = [];
          tokens.forEach((token) => {
            const text = token.firstChild;
            for (let index = 0; text && index < text.length; index += 1) {
              if (text.data.charAt(index).trim()) {
                range.setStart(text, index);
                range.setEnd(text, index + 1);
                glyphs.push({ character: text.data.charAt(index), rect: range.getBoundingClientRect() });
              }
            }
          });
          const at = glyphs.findIndex((glyph, index) => index && glyph.character === after);
          const left = glyphs[at - 1].rect;
          const right = glyphs[at].rect;
          return Math.abs(left.top - right.top) > 2 ? null : points(right.left - left.right);
        };
        return {
          rightLines: rightLines.length,
          number: numberRight,
          equations: Array.from(groups, ([paragraph, tokens]) => {
            // Across, where the text is drawn: a token longer than the line
            // was cut at the paragraph's edge, and its box ended there.
            // A line starts at its first letter, not at a space before it.
            const rects = tokens.map((token) => {
              const text = document.createRange();
              text.selectNodeContents(token);
              const drawn = text.getBoundingClientRect();
              const own = token.getBoundingClientRect();
              text.setStart(token.firstChild, token.firstChild.data.search(/[^ ]/));
              return { left: text.getBoundingClientRect().left, right: Math.max(drawn.right, own.right), top: own.top, bottom: own.bottom };
            });
            const top = Math.min(...rects.map((rect) => rect.top));
            const bottom = Math.max(...rects.map((rect) => rect.bottom));
            const block = paragraph.closest("table") || paragraph;
            // Where each line starts: a subscript sits a few points below
            // its line's top, the next line a whole line below.
            const starts = [];
            rects.slice().sort((one, other) => one.top - other.top).forEach((rect) => {
              const last = starts[starts.length - 1];
              if (last && rect.top - last.top < 8 / 0.75 * scale) {
                last.left = Math.min(last.left, rect.left);
              } else {
                starts.push({ top: rect.top, left: rect.left });
              }
            });
            return {
              maths: paragraph.querySelectorAll("math").length,
              starts: starts.map((start) => points(start.left - box.left)),
              left: points(Math.min(...rects.map((rect) => rect.left)) - box.left),
              right: points(Math.max(...rects.map((rect) => rect.right)) - box.left),
              height: points(bottom - top),
              size: parseFloat(getComputedStyle(paragraph.querySelector("math")).fontSize) * 0.75,
              // The long paragraph runs on in the right column: its first fragment.
              nextGap: points(block.nextElementSibling.getClientRects()[0].top - bottom),
              hits: rightLines.filter((line) => rects.some((rect) =>
                rect.left < line.right - 1 && rect.right > line.left + 1 && rect.top < line.bottom - 1 && rect.bottom > line.top + 1)).length,
              equalsGap: gap(tokens, "="),
              betaGap: gap(tokens, "B")
            };
          })
        };
    });
  }

  test("a display equation wider than its column wraps inside the column", async () => {
    await withHost({}, async (host) => {
      const layout = await equationLayout(host);
      assert.equal(layout.equations.length, 5, "the five equations render");
      assert.ok(layout.rightLines > 10, `the right column holds ${layout.rightLines} lines of the long paragraph`);
      const short = layout.equations.pop();
      assert.ok(short.left > 320 && short.right <= 541, `the short equation spans ${short.left} to ${short.right} pt; the right column runs from 324 to 540 pt`);
      assert.ok(short.height < short.size * 1.6, `the short equation is ${short.height} pt tall at ${short.size} pt type; Word sets it on one line`);
      assert.equal(short.maths, 1, "the short equation, which fits its cell, is left whole");
      layout.equations.forEach((equation, index) => {
        const name = `equation ${index + 1}`;
        assert.ok(equation.right <= 289, `${name} reaches ${equation.right} pt; the left column ends at 288 pt`);
        assert.equal(equation.hits, 0, `${name} is drawn over ${equation.hits} lines of the right column`);
        assert.ok(equation.height > equation.size * 2, `${name} is ${equation.height} pt tall at ${equation.size} pt type; Word sets it on three or four lines`);
        assert.ok(equation.nextGap >= -0.5, `what follows ${name} starts ${equation.nextGap} pt below it`);
        // Word prints a space before "=" and before "Beta", after a comma or
        // a plus sign.
        assert.ok(equation.equalsGap === null || equation.equalsGap > 1.5, `${name}: "=" is ${equation.equalsGap} pt from the name before it`);
        assert.ok(index === 3 || equation.betaGap === null || equation.betaGap > 1.5, `${name}: "Beta" is ${equation.betaGap} pt from the sign before it`);
      });
      // Word starts every line of a set at the same place: 75.7 pt for the
      // first, 72.5 pt for the second. (It indents the sum's later lines.)
      layout.equations.slice(0, 2).forEach((equation, index) => {
        assert.ok(Math.max(...equation.starts) - Math.min(...equation.starts) <= 1, `equation ${index + 1}'s lines start at ${equation.starts.join(", ")} pt`);
      });
      assert.ok(layout.number <= 291, `the equation number ends at ${layout.number} pt; Word's ends at 290.1 pt`);
    });
  });

  // In a document of more than 60 sections the first pages are matched while
  // the reader pane is hidden, where every box is 0 wide: each equation in a
  // column section looked wider than its column and was cut, the short one
  // that fits its cell too.
  test("an equation that fits is left whole in a document long enough to open in batches", async () => {
    await withHost({}, async (host) => {
      const layout = await equationLayout(host, { morePages: 70 });
      assert.equal(layout.equations.length, 5, "the five equations render");
      const short = layout.equations.pop();
      assert.equal(short.maths, 1, "the short equation, which fits its cell, is left whole");
      layout.equations.forEach((equation, index) => {
        assert.ok(equation.maths > 1, `equation ${index + 1} is cut into lines`);
        assert.ok(equation.right <= 289, `equation ${index + 1} reaches ${equation.right} pt; the left column ends at 288 pt`);
      });
    });
  });
});

describe("page view splits long documents without freezing the window", () => {

  // Splitting kept the whole rest of the document on the page being split, so
  // every split laid out everything after it, in one task: a 62-page
  // supplement with 52 tables froze the window for 20 seconds, and this
  // document for about 1.5 seconds. Pages now take blocks from a queue and
  // split in slices (P-04).
  test("splitting a long document into pages never blocks the page for long", async () => {
    await withHost({}, async (host) => {
      await host.page.evaluate(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) => list.getEntries().forEach((entry) =>
          window.__longTasks.push(Math.round(entry.duration)))).observe({ type: "longtask" });
      });
      const { bytes, report } = await makeBigDocx(60, { pageBreaks: false });
      const rendered = await host.openDocument({ bytes, report, fileName: "unbroken-60.docx" });
      const result = await host.page.evaluate(() => {
        const text = document.getElementById("docBody").textContent;
        return {
          longest: Math.max(0, ...window.__longTasks),
          paragraphs: document.querySelectorAll("#docBody section.docx article > p:not([data-ld-continued])").length,
          firstParagraphs: text.split("Page 1, paragraph 1.").length - 1,
          lastParagraphs: text.split("Page 60, paragraph 7.").length - 1,
          hidden: document.getElementById("docBody").style.visibility
        };
      });
      assert.ok(rendered.pages >= 40, `${rendered.pages} pages`);
      // 60 x 7 body paragraphs and 6 chapter headings, each shown once.
      assert.equal(result.paragraphs, 426);
      assert.equal(result.firstParagraphs, 1);
      assert.equal(result.lastParagraphs, 1);
      assert.equal(result.hidden, "", "the pages are shown once they are final");
      assert.ok(result.longest < 400, `longest task ${result.longest} ms`);
      // Each split lays out about one page: 210 ms here, 1,340 ms when every
      // split lays out the rest of the document.
      assert.ok(rendered.ms < 800, `reader ${rendered.ms} ms`);
      console.log(`# unbroken 60 pages: ${rendered.pages} pages, reader ${rendered.ms} ms, longest task ${result.longest} ms`);
    });
  });

  test("a document opened while another is being split into pages replaces it", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(200, { pageBreaks: false });
      const second = fixture("headings.docx");
      await host.openDocument({ tab: 1, generation: 1, bytes, report, fileName: "unbroken-200.docx", wait: false });
      // The first document is attached and being split: its pages are hidden.
      await host.page.waitForFunction(() => document.getElementById("docBody").style.visibility === "hidden" &&
        document.querySelectorAll("#docBody section.docx").length > 0, null, { timeout: 30000 });
      const rendered = await host.openDocument({ tab: 1, generation: 2, bytes: second.bytes, report: second.report, fileName: "headings.docx" });
      assert.equal(rendered.generation, 2);
      await host.page.waitForTimeout(500);
      assert.deepEqual(host.ofType("rendered").map((message) => message.generation), [2]);
      assert.equal(host.ofType("renderFailed").length, 0);
      const state = await host.page.evaluate(() => ({
        text: document.getElementById("docBody").textContent,
        bodyVisibility: document.getElementById("docBody").style.visibility,
        paneHidden: document.getElementById("readerPane").hidden,
        panePosition: document.getElementById("readerPane").style.position,
        renderState: document.documentElement.dataset.renderState
      }));
      assert.ok(state.text.includes("Quarterly field report"));
      assert.ok(!state.text.includes("Page 1, paragraph 1."), "nothing of the first document is left");
      assert.equal(state.bodyVisibility, "");
      assert.equal(state.paneHidden, false);
      assert.equal(state.panePosition, "");
      assert.equal(state.renderState, "ready");
      assert.equal(await host.page.textContent("#fileName"), "headings.docx");
    });
  });

  // A page's last block can end inside its own spacing after: the page is full
  // but no block lies past it. With blocks waiting off the page, the first
  // version of the queue stopped there and left the rest on one page.
  test("a page that ends inside a paragraph's spacing after still splits", async () => {
    await withHost({}, async (host) => {
      const { bytes, report, count } = await makeSpacedDocx({ after: 880 });
      const rendered = await host.openDocument({ bytes, report, fileName: "spaced.docx" });
      const pages = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"))
        .map((page) => ({ height: page.offsetHeight, lines: page.querySelectorAll(":scope > article > p").length })));
      // Word 16 and LeanDoc 0.1.2 before the queue: 12 lines on each of 8 pages, then 4.
      assert.equal(rendered.pages, 9);
      assert.deepEqual(pages.map((page) => page.lines), [12, 12, 12, 12, 12, 12, 12, 12, 4]);
      assert.ok(pages.every((page) => page.height === pages[0].height), `heights ${pages.map((page) => page.height)}`);
      assert.equal(pages.reduce((sum, page) => sum + page.lines, 0), count);
    });
  });

  // Every split moved all remaining rows of a long table to the next page and
  // laid them out again: 4,000 rows took 47 seconds.
  test("a table of 1,500 rows splits without freezing the window and keeps every row once", async () => {
    await withHost({}, async (host) => {
      await host.page.evaluate(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) => list.getEntries().forEach((entry) =>
          window.__longTasks.push(Math.round(entry.duration)))).observe({ type: "longtask" });
      });
      const { bytes, report } = await makeTablesDocx({ longRows: 1500 });
      const rendered = await host.openDocument({ bytes, report, fileName: "long-table.docx" });
      const result = await host.page.evaluate(() => ({
        longest: Math.max(0, ...window.__longTasks),
        labels: Array.from(document.querySelectorAll("#docBody table"))
          .filter((table) => table.textContent.includes("A longer description of row"))
          .flatMap((table) => Array.from(table.rows).map((row) => row.cells[0].textContent.trim()))
          .filter((text) => /^Row \d+$/.test(text))
      }));
      assert.deepEqual(result.labels, Array.from({ length: 1500 }, (_, index) => `Row ${index + 1}`));
      assert.ok(result.longest < 800, `longest task ${result.longest} ms`);
      // Waiting rows were once put back all at once on the page where the
      // table stopped, clipped by the page: 26 pages. Moving whole rows only
      // gave 27. Word breaks rows across pages and gives 22; LeanDoc does
      // too, and gave 23 while a one-line paragraph of runs smaller than its
      // style stayed as tall as the style's size. It now gives Word's 22.
      assert.equal(rendered.pages, 22);
      console.log(`# 1,500-row table: ${rendered.pages} pages, reader ${rendered.ms} ms, longest task ${result.longest} ms`);
    });
  });

  // An error in a later slice of splitting used to leave the open hanging,
  // with the document hidden and no renderFailed.
  test("an error while splitting pages ends the render with renderFailed", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(200, { pageBreaks: false });
      const failed = host.waitFor((message) => message.type === "renderFailed", 30000);
      await host.openDocument({ bytes, report, fileName: "unbroken-200.docx", wait: false });
      await host.page.waitForFunction(() => document.getElementById("docBody").style.visibility === "hidden" &&
        document.querySelectorAll("#docBody section.docx").length > 1, null, { timeout: 30000, polling: 5 });
      await host.page.evaluate(() => {
        const measure = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function () {
          Element.prototype.getBoundingClientRect = measure;
          throw new Error("injected measurement failure");
        };
      });
      const message = await failed;
      assert.match(message.message, /injected measurement failure/);
      assert.equal(await host.page.evaluate(() => document.documentElement.dataset.renderState), "failed");
      // The deliberate error is the only one the page logs.
      host.consoleErrors.length = 0;
    });
  });
});

describe("page view follows the page starts Word saved", () => {
  // Each page's lines, read from the rendered pages.
  function pageLines(host) {
    return host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"))
      .map((page) => page.textContent.match(/Page \d+, line \d+\./g) || []));
  }

  // A survey that Word lays out on 46 pages showed as 87 in LeanDoc 0.1.2: its
  // text set a few lines longer on each page than in Word, and docx-preview
  // starts a page at every page start Word saved, so each page's last lines
  // took a page of their own. Here 10 saved pages of 38 lines each, 2 more
  // than a page holds, showed as 20 pages, and 21 with a page break.
  test("text that runs past a saved page start continues on that page, not on a page of its own", async () => {
    await withHost({}, async (host) => {
      const { bytes, report, pages, lines } = await makeSavedPagesDocx({ pages: 10, lines: 38, split: 5, pageBreak: 8 });
      const rendered = await host.openDocument({ bytes, report, fileName: "saved-pages.docx" });
      const found = await pageLines(host);
      // Saved pages 1 to 7 hold 266 lines and end with the explicit page
      // break's own empty line: 7 full pages and 14 lines. The break starts
      // a page, and saved pages 8 to 10 hold 114 lines: 36, 36, 36, and 6.
      assert.equal(rendered.pages, 12);
      assert.deepEqual(found.map((page) => page.length), [36, 36, 36, 36, 36, 36, 36, 14, 36, 36, 36, 6]);
      assert.equal(found[8][0], lineText(8, 1));
      const expected = [];
      for (let page = 1; page <= pages; page += 1) {
        for (let line = 1; line <= lines; line += 1) {
          expected.push(lineText(page, line));
        }
      }
      assert.deepEqual(found.flat(), expected);
      // docx-preview splits the paragraph Word broke between saved pages 5
      // and 6; once the text flows on, it is one paragraph again.
      const crossing = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody article > p"))
        .filter((p) => p.textContent.includes("Page 5, line 38.") || p.textContent.includes("Page 6, line 1."))
        .map((p) => p.textContent));
      assert.deepEqual(crossing, ["Page 5, line 37.Page 5, line 38.Page 6, line 1.Page 6, line 2."]);
    });
  });

  test("a saved page start where the text fits still starts a page, and one after a page break adds none", async () => {
    await withHost({}, async (host) => {
      const { bytes, report, pages, lines } = await makeSavedPagesDocx({ pages: 6, lines: 30, pageBreak: 4 });
      const rendered = await host.openDocument({ bytes, report, fileName: "saved-pages-fit.docx" });
      const found = await pageLines(host);
      // Word saves a page start at the top of the page an explicit page break
      // starts; docx-preview broke at both, which left a page with only an
      // empty line: 7 pages.
      assert.equal(rendered.pages, pages);
      assert.deepEqual(found.map((page) => page.length), Array(pages).fill(lines));
      assert.deepEqual(found.map((page) => page[0]), Array.from({ length: pages }, (_, index) => lineText(index + 1, 1)));
    });
  });
});

describe("a table splits at the row where Word saved a page start", () => {
  function pageRows(host) {
    return host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"))
      .map((page) => (page.textContent.match(/Row \d+\./g) || []).map((text) => Number(text.slice(4, -1)))));
  }

  // A 100-row table that Word broke every 30 rows (its pages hold 36 here, as
  // a document whose rows are a little shorter than Word's). docx-preview
  // draws no page for a marker inside a table, so the table had been filled to
  // the bottom of each page: 36, 36, 28 rows, and the pages did not start
  // where Word's did.
  test("rows that would fit on the page wait for the row Word started its next page at", async () => {
    await withHost({}, async (host) => {
      const { bytes, report, rows, perPage } = await makeSavedRowsDocx({ rows: 100, perPage: 30 });
      const rendered = await host.openDocument({ bytes, report, fileName: "saved-rows.docx" });
      const found = await pageRows(host);
      assert.equal(rendered.pages, 4);
      assert.deepEqual(found.map((page) => page[0]), [1, 31, 61, 91]);
      assert.deepEqual(found.map((page) => page.length), [perPage, perPage, perPage, rows - 3 * perPage]);
      assert.equal(found.flat().length, rows);
      const text = await host.page.evaluate(() => document.querySelector("#docBody .docx-wrapper").textContent);
      assert.ok(text.includes("After the table."));
      assert.ok(text.includes(rowText(100)));
    });
  });
});

describe("page view keeps and starts pages as Word does", () => {
  // Each page's text, its sections' text joined.
  function pageTexts(host) {
    return host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"))
      .map((page) => Array.from(page.querySelectorAll(":scope > article")).map((article) => article.textContent).join("")));
  }

  // Paragraphs in a style based on another style, not on Normal, took
  // Normal's line spacing: docx-preview gives every paragraph the default
  // style's rules.
  test("a style based on no other style takes nothing from the default paragraph style", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeStyleChainDocx();
      const rendered = await host.openDocument({ bytes, report, fileName: "style-chain.docx" });
      const spacing = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody article > p"))
        .filter((p) => /^(Clause line 1|Unstyled line)\./.test(p.textContent))
        .map((p) => getComputedStyle(p).marginBottom));
      // Clause sets no space after; the unstyled paragraph is in Normal, which sets 18 pt.
      assert.deepEqual(spacing, ["0px", "24px"]);
      const texts = await pageTexts(host);
      assert.equal(rendered.pages, 2);
      assert.ok(texts[0].endsWith("Clause line 36."), texts[0].slice(-40));
      assert.equal(texts[1], "Unstyled line.");
    });
  });

  // Paragraphs in heading styles: docx-preview names each paragraph's class
  // after its style, and the page view kept every paragraph whose style name
  // holds "heading" with the next, though only w:keepNext does that in Word.
  // A page that ended in a run of such paragraphs moved them all to the next
  // page.
  test("a paragraph in a heading style that does not keep with the next stays on its page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeKeepRulesDocx();
      await host.openDocument({ bytes, report, fileName: "keep-heading.docx" });
      const texts = await pageTexts(host);
      assert.equal(texts.length, 2);
      assert.ok(texts[0].endsWith("Clause C line 10."), texts[0].slice(-40));
      assert.ok(texts[1].startsWith("Block D line 1."), texts[1].slice(0, 40));
    });
  });

  // Where nearly every paragraph keeps with the next, a page held one
  // paragraph: the page view moved the whole chain of kept
  // paragraphs before the first one past the page, back to the page's first
  // block. A chain longer than a page cannot stay together, and Word breaks
  // it where the page ends.
  test("paragraphs kept with the next fill their pages when the chain is longer than a page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeKeepRulesDocx({ chain: true });
      await host.openDocument({ bytes, report, fileName: "keep-chain.docx" });
      const texts = await pageTexts(host);
      assert.deepEqual(texts.map((text) => (text.match(/Kept line \d+\./g) || []).length), [36, 36, 8]);
    });
  });

  // Sections of one page size that are not continuous ran on from each
  // other: docx-preview starts a page at a section break
  // only where the page size changes. In Word every section but a
  // continuous one starts on a new page.
  test("a section that starts on a new page starts one on the same page size", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeSectionPagesDocx();
      const rendered = await host.openDocument({ bytes, report, fileName: "section-pages.docx" });
      const texts = await pageTexts(host);
      assert.equal(rendered.pages, 2);
      assert.ok(texts[0].endsWith("First section line 5."), texts[0].slice(-40));
      assert.ok(texts[1].startsWith("Second section line 1."), texts[1].slice(0, 40));
      // The continuous section after it stays on its page.
      assert.ok(texts[1].endsWith("Third section line 3."), texts[1].slice(-40));
    });
  });

  // A blank page showed before a heading whose style breaks the page before
  // it, after a page break or at the document's start: docx-preview starts a
  // page at a paragraph whose style breaks the page before it even where
  // the paragraph is at the top of a page already. Word starts none there.
  test("a page break before a paragraph at the top of a page adds no page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makePageBreakBeforeDocx();
      const rendered = await host.openDocument({ bytes, report, fileName: "break-before.docx" });
      const pages = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"))
        .map((page) => ({
          header: Array.from(page.querySelectorAll(":scope > header")).map((node) => node.textContent.trim()).join(""),
          text: Array.from(page.querySelectorAll(":scope > article")).map((article) => article.textContent).join("")
        })));
      assert.equal(rendered.pages, 2);
      assert.deepEqual(pages.map((page) => page.text.slice(0, 11)), ["Chapter one", "Chapter two"]);
      // The first page keeps the section's first-page header.
      assert.deepEqual(pages.map((page) => page.header), ["First page header.", "Running header."]);
    });
  });

  // Word 2007 saved a page start at the top of every column of a section
  // with columns, and docx-preview starts a page at each, so every page held
  // one column.
  test("saved page starts at the top of each column do not start pages", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeColumnStartsDocx();
      const rendered = await host.openDocument({ bytes, report, fileName: "column-starts.docx" });
      const texts = await pageTexts(host);
      assert.equal(rendered.pages, 3);
      assert.deepEqual(texts.map((text) => (text.match(/Column line \d+\./g) || []).length), [72, 72, 72]);
      assert.deepEqual(texts.map((text) => text.match(/Column line \d+\./)[0]), ["Column line 1.", "Column line 73.", "Column line 145."]);
    });
  });
});

// A dot leader is a box that clips its dots. Set on the bottom of the text,
// it reached above the line by the line's leading, and a line with a leader
// was taller than the same line without one. Word's line is as tall as its text.
test("a contents line with a dot leader is as tall as one without", async () => {
  await withHost({}, async (host) => {
    const { bytes, report } = await makeContentsDocx({ entries: 40 });
    await host.openDocument({ bytes, report, fileName: "contents.docx" });
    const lines = await host.page.evaluate((entry) => Array.from(document.querySelectorAll("#docBody article > p"))
      .filter((p) => p.textContent.startsWith(entry))
      .map((p) => ({ leader: !!p.querySelector(".ld-tab-leader"), height: p.getBoundingClientRect().height })), CONTENTS_ENTRY);
    const leader = lines.filter((line) => line.leader).map((line) => line.height);
    const plain = lines.filter((line) => !line.leader).map((line) => line.height);
    assert.equal(leader.length, 40);
    assert.equal(plain.length, 40);
    leader.concat(plain).forEach((height) => {
      assert.ok(Math.abs(height - plain[0]) <= 0.1, `a contents line is ${height} px tall; one without a leader is ${plain[0]} px`);
    });
  });
});

// Line spacing "at least 12 pt" makes a line as tall as its text when the
// text is taller. With the paragraph at its 7 pt mark's size and the text
// at 11 pt, each line was 18 px, the small mark's leading added below the
// text's, where Word's line is the 11 pt text's 16.9 px.
test("a line of 11 pt text at least 12 pt apart is as tall as the text, whatever the paragraph mark's size", async () => {
  await withHost({}, async (host) => {
    const { bytes, report } = await makeAtLeastDocx();
    await host.openDocument({ bytes, report, fileName: "at-least.docx" });
    const height = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody article > p"))
      .find((p) => p.textContent.includes("At least line 1.")).getBoundingClientRect().height);
    // Arial's single line is 1.152 times its size (Fixups.wordSingleLine).
    const line = 11 * 1.152 * 4 / 3;
    assert.ok(Math.abs(height - AT_LEAST_LINES * line) <= 1, `the paragraph is ${height} px tall; Word's ${AT_LEAST_LINES} lines are ${AT_LEAST_LINES * line} px`);
  });
});

describe("text past a saved page start continues on that page across a section boundary", () => {
  // Expected values come from Word itself: each document of
  // tests/reader/make-section-flow-docx.mjs opened in Word 16 through COM,
  // page starts read with GoTo and each paragraph's page and position with
  // Range.Information. Lines are 18 pt (24 px); positions are in px from the
  // page's top left corner.
  async function layout(host) {
    return host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).map((page) => {
      const box = page.getBoundingClientRect();
      const style = getComputedStyle(page);
      const lines = Array.from(page.querySelectorAll(":scope > article > p")).filter((p) => p.textContent.trim()).map((p) => {
        const rect = p.getBoundingClientRect();
        return { text: p.textContent.trim(), left: rect.left - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top };
      });
      return { width: box.width, limit: parseFloat(style.minHeight) - parseFloat(style.paddingBottom), lines };
    }));
  }

  function near(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} px, Word ${expected} px`);
  }

  const starts = (pages) => pages.map((page) => (page.lines[0] || {}).text);
  const texts = (pages) => pages.flatMap((page) => page.lines.map((line) => line.text));
  const counts = (pages) => pages.map((page) => page.lines.length);
  const alpha = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => `Alpha line ${from + index}.`);
  const gamma = Array.from({ length: 20 }, (_, index) => `Gamma line ${index + 1}.`);
  const figure = ["Figure block one.", "Figure body one.", "Figure caption one."];
  const find = (page, text) => page.lines.find((line) => line.text === text);

  function assertInside(pages) {
    pages.forEach((page, index) => page.lines.forEach((line) => {
      assert.ok(line.bottom <= page.limit + 0.5, `page ${index + 1}: "${line.text}" ends at ${line.bottom} px, the text area at ${page.limit} px`);
    }));
  }

  // A two-column section of 74 lines, 2 more than page 1 holds, before a
  // one-column figure section that carries the saved page start. Word gives
  // 2 pages: page 2 starts with lines 73 and 74 side by side, balanced, and
  // the figure follows 18 pt lower. The two lines made a page of their own,
  // 3 pages, as in a 10-page paper that showed as 12.
  test("two lines of a two-column section continue above the one-column figure section that starts the page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 2 });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-section.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Alpha line 73."]);
      assert.deepEqual(texts(pages), [...alpha(1, 74), ...figure, ...gamma]);
      assert.deepEqual(counts(pages), [72, 25]);
      const [left, right, block, caption, text] = ["Alpha line 73.", "Alpha line 74.", "Figure block one.", "Figure caption one.", "Gamma line 1."]
        .map((line) => find(pages[1], line));
      near(left.top, 96, "line 73 top");
      near(left.left, 96, "line 73 left");
      near(right.top, 96, "line 74 top");
      near(right.left, 432, "line 74 left");
      near(block.top, 120, "figure top");
      near(caption.top, 600, "caption top");
      near(text.top, 624, "the text after the figure");
      assertInside(pages);
    });
  });

  // 4 lines past page 1: Word sets lines 73 and 74 in the left column of
  // page 2, 75 and 76 in the right, and the figure 36 pt below the top
  // margin. With the empty start of the figure's paragraph they take 3 of a
  // page's 36 lines, under the tenth of a page the reader lets through here.
  test("four lines of a two-column section continue above the figure section, two to a column", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 4 });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-section-4.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Alpha line 73."]);
      assert.deepEqual(texts(pages), [...alpha(1, 76), ...figure, ...gamma]);
      const at = (line) => find(pages[1], line);
      near(at("Alpha line 74.").top, 120, "line 74 top");
      near(at("Alpha line 74.").left, 96, "line 74 left");
      near(at("Alpha line 75.").top, 96, "line 75 top");
      near(at("Alpha line 75.").left, 432, "line 75 left");
      near(at("Figure block one.").top, 144, "figure top");
      assertInside(pages);
    });
  });

  // The limit is the reader's own; Word has none and gives 2 pages here too
  // (lines 73 to 78 above the figure). 6 lines past page 1 take, with the
  // empty start of the figure's paragraph, 4 of a page's 36 lines, more than
  // a tenth: they keep a page of their own, as before.
  test("six lines before the figure section, more than a tenth of a page, keep a page of their own", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 6 });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-section-6.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 3, "the reader gives 3 pages; Word gives 2");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Alpha line 73.", "Figure block one."]);
      assert.deepEqual(counts(pages), [72, 6, 23]);
      assert.deepEqual(texts(pages), [...alpha(1, 78), ...figure, ...gamma]);
    });
  });

  // A title section with a 1-inch top margin, then two columns with a
  // 1.5-inch top margin after a continuous break. Word gives 3 pages; page 2
  // starts with line 61 at 108 pt, the top margin of the section at its top,
  // and holds 68 lines. Lines 61 and 62 made a page of their own with the
  // title's margin, 4 pages, as in a 31-page paper whose two top margins
  // differ by 1 pt.
  test("text continues on a page that starts in the same section with another top margin", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx();
      const rendered = await host.openDocument({ bytes, report, fileName: "margin-sections.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 3, "Word gives 3 pages");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 129."]);
      assert.deepEqual(texts(pages), [...Array.from({ length: 6 }, (_, index) => `Title line ${index + 1}.`), ...alpha(1, 140)]);
      assert.deepEqual(counts(pages), [66, 68, 12]);
      near(find(pages[0], "Alpha line 1.").top, 240, "line 1 top");
      near(find(pages[1], "Alpha line 61.").top, 144, "line 61 top");
      near(find(pages[1], "Alpha line 95.").top, 144, "line 95 top");
      near(find(pages[1], "Alpha line 95.").left, 432, "line 95 left");
      near(find(pages[2], "Alpha line 129.").top, 144, "line 129 top");
      assertInside(pages);
    });
  });

  // The same document with its saved page starts 10 lines late. The text
  // of one section continues however much of it runs over: 10 lines take 5
  // of the page's 36 lines, more than the tenth that text spanning sections
  // may take. Word gives the same 3 pages.
  test("ten lines of one section continue on a page with another top margin", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ stale: 10 });
      const rendered = await host.openDocument({ bytes, report, fileName: "margin-sections-10.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 3, "Word gives 3 pages");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 129."]);
      assert.deepEqual(counts(pages), [66, 68, 12]);
      near(find(pages[1], "Alpha line 61.").top, 144, "line 61 top");
      assertInside(pages);
    });
  });

  // A floating table as wide as both columns, with a caption longer than a
  // column, follows line 92 of the two-margin document. Word gives 2 pages
  // and sets the table whole at the top of page 2, from the left margin
  // (72 pt). The reader sets such a table in the column where its place in
  // the text falls. After lines 63 to 92 it fits at the foot of the first
  // column and reaches across the second. With lines 61 and 62 continued
  // above them it starts the second column, and its caption runs past the
  // page's edge. So a document with such a table keeps the page breaks it
  // had: lines 61 and 62 on a page of their own, 3 pages, the caption whole.
  test("a floating table wider than a column keeps its caption whole after two lines that run past a page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, wideTableAfter: 92 });
      const rendered = await host.openDocument({ bytes, report, fileName: "wide-table.docx" });
      const pages = await layout(host);
      const caption = await host.page.evaluate((text) => {
        const paragraph = Array.from(document.querySelectorAll("#docBody article td p")).find((p) => p.textContent.trim() === text);
        const page = paragraph.closest("section.docx");
        const box = page.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const rects = Array.from(range.getClientRects());
        return {
          left: Math.min(...rects.map((rect) => rect.left)) - box.left,
          right: Math.max(...rects.map((rect) => rect.right)) - box.left,
          edge: box.width - parseFloat(getComputedStyle(page).paddingRight)
        };
      }, WIDE_CAPTION);
      assert.ok(caption.right <= caption.edge + 0.5, `the caption ends at ${caption.right} px, the text area at ${caption.edge} px`);
      near(caption.left, 96, "caption left");
      assert.equal(rendered.pages, 3, "the reader gives 3 pages; Word gives 2");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 63."]);
      assert.deepEqual(texts(pages), [...Array.from({ length: 6 }, (_, index) => `Title line ${index + 1}.`), ...alpha(1, 100)]);
    });
  });

  // The document with the floating table and 140 lines. Its pages stay as
  // they were before text could continue across a section boundary: lines
  // 61 and 62 on a page of their own, and lines 127 to 130, which run past
  // the third page, continued on the fourth, since both are pages of one
  // section with the same margins. The reader gives 4 pages; Word gives 3.
  test("a document with a floating table wider than a column still continues text of one section between pages of the same margins", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 140, wideTableAfter: 92 });
      const rendered = await host.openDocument({ bytes, report, fileName: "wide-table-140.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 4, "the reader gives 4 pages; Word gives 3");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 63.", "Alpha line 127."]);
      assert.deepEqual(counts(pages), [66, 2, 64, 14]);
    });
  });

  // The same table in the text's flow, not floating (no w:tblpPr). Word
  // gives 2 pages and sets it at the top of the second column (324 pt,
  // 108 pt), where it runs past the page as it does in the reader. Such a
  // table holds nothing back: lines 61 and 62 continue.
  test("a table wider than a column that is in the text's flow goes where Word puts it", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, wideTableAfter: 92, floating: false });
      const rendered = await host.openDocument({ bytes, report, fileName: "wide-table-in-flow.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61."]);
      const table = await host.page.evaluate(() => {
        const element = document.querySelector("#docBody article > table");
        const page = element.closest("section.docx");
        const box = page.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return { page: Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).indexOf(page) + 1, left: rect.left - box.left, top: rect.top - box.top };
      });
      assert.equal(table.page, 2);
      near(table.left, 432, "table left");
      near(table.top, 144, "table top");
    });
  });

  // Where the document's picture lies, in px from the top left corner of its
  // page, with the left and right edges of that page's text area.
  async function picture(host) {
    return host.page.evaluate(() => {
      const image = document.querySelector("#docBody article img");
      const page = image.closest("section.docx");
      const box = page.getBoundingClientRect();
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(page);
      return {
        page: Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).indexOf(page) + 1,
        left: rect.left - box.left,
        right: rect.right - box.left,
        top: rect.top - box.top,
        textLeft: parseFloat(style.paddingLeft),
        textRight: box.width - parseFloat(style.paddingRight)
      };
    });
  }

  function assertPictureInside(found) {
    assert.ok(found.left >= found.textLeft - 0.5 && found.right <= found.textRight + 0.5,
      `the picture lies from ${found.left} px to ${found.right} px, the text area from ${found.textLeft} px to ${found.textRight} px`);
  }

  const titles = Array.from({ length: 6 }, (_, index) => `Title line ${index + 1}.`);

  // A picture as wide as both columns, anchored to a line after line 92 of
  // the two-margin document, with text wrapped square around it and aligned
  // to the left margin (wp:anchor). Word gives 2 pages and sets it from the
  // left margin. docx-preview floats it in the column of its anchor. After
  // lines 63 to 92 it starts at the foot of the first column and reaches
  // across the second. With lines 61 and 62 continued above them it starts
  // the second column and runs 240 px past the page's edge. So a document
  // with such a picture keeps the page breaks it had, as one with such a
  // table does: 3 pages, the picture inside the text area.
  test("a floating picture wider than a column stays inside the text area after two lines that run past a page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, picture: { after: 92, width: 468 } });
      const rendered = await host.openDocument({ bytes, report, fileName: "wide-picture.docx" });
      const pages = await layout(host);
      const found = await picture(host);
      assertPictureInside(found);
      near(found.left, 96, "picture left");
      assert.equal(rendered.pages, 3, "the reader gives 3 pages; Word gives 2");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 63."]);
      assert.deepEqual(texts(pages), [...titles, ...alpha(1, 92), PICTURE_ANCHOR, ...alpha(93, 100)]);
    });
  });

  // A column is 216 pt wide and the gap between the two 36 pt, so half of
  // the text's width is 234 pt. A floating picture 225 pt wide is wider than
  // a column: from the second column it ends 12 px past the text area.
  test("a floating picture wider than a column by less than half the gap between the columns counts as wider", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, picture: { after: 92, width: 225 } });
      const rendered = await host.openDocument({ bytes, report, fileName: "wide-picture-225.docx" });
      const pages = await layout(host);
      const found = await picture(host);
      assertPictureInside(found);
      assert.equal(rendered.pages, 3, "the reader gives 3 pages; Word gives 2");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 63."]);
    });
  });

  // A floating picture exactly as wide as a column fits in either column,
  // so it holds nothing back: lines 61 and 62 continue, and Word's 2 pages
  // come out. The picture starts the second column and ends at the edge of
  // the text area.
  test("a floating picture as wide as a column holds nothing back", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, picture: { after: 92, width: 216 } });
      const rendered = await host.openDocument({ bytes, report, fileName: "column-picture.docx" });
      const pages = await layout(host);
      const found = await picture(host);
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61."]);
      assert.equal(found.page, 2);
      near(found.left, 432, "picture left");
      near(found.right, 720, "picture right");
      assert.deepEqual(texts(pages), [...titles, ...alpha(1, 92), PICTURE_ANCHOR, ...alpha(93, 100)]);
    });
  });

  // The same wide picture aligned to the right margin, after line 126 of
  // 140. docx-preview floats it to the right of its anchor's column: from
  // the second column it reaches back across the first, and from the first
  // it starts 240 px left of the page. It ends the second column of the
  // third page. With lines 61 and 62 continued, the pages after them hold
  // two lines more, and the picture starts the first column of the next
  // page. The document keeps its 4 pages; Word gives 3.
  test("a floating picture wider than a column that is aligned to the right stays inside the text area", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 140, picture: { after: 126, width: 468, align: "right" } });
      const rendered = await host.openDocument({ bytes, report, fileName: "wide-picture-right.docx" });
      const pages = await layout(host);
      const found = await picture(host);
      assertPictureInside(found);
      assert.equal(rendered.pages, 4, "the reader gives 4 pages; Word gives 3");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 63.", "Alpha line 127."]);
      assert.deepEqual(counts(pages), [66, 2, 65, 14]);
    });
  });

  // A picture that text stays above and below, or that lies over the text,
  // is not a float in docx-preview, but it is drawn from its anchor's column
  // the same way, and Word sets it from the margin. After lines 90 and 92 it
  // starts in the first column as long as lines 61 and 62 keep their page,
  // and in the second, 240 px past the page's edge, when they continue.
  for (const [wrap, after] of [["topAndBottom", 90], ["none", 92]]) {
    test(`a picture wider than a column with wrapping "${wrap}" stays inside the text area after two lines that run past a page`, async () => {
      await withHost({}, async (host) => {
        const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, picture: { after, width: 468, wrap } });
        const rendered = await host.openDocument({ bytes, report, fileName: `wide-picture-${wrap}.docx` });
        const pages = await layout(host);
        const found = await picture(host);
        assertPictureInside(found);
        assert.equal(rendered.pages, 3, "the reader gives 3 pages; Word gives 2");
        assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 63."]);
      });
    });
  }

  // A word dropped over three lines at 65 pt (w:framePr w:dropCap="drop"),
  // after line 90. Word gives 2 pages and keeps the word in its anchor's
  // column: it starts the second column and the next line starts 108 pt
  // lower, two of its 54 pt lines. docx-preview floats the word's paragraph
  // left, on one line, 443 px wide where a column is 288 px. From the first
  // column it reaches across the second, and from the second it runs 59 px
  // past the page's edge. So this document keeps its page breaks too.
  test("a dropped word wider than a column stays inside the text area after two lines that run past a page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, dropCapAfter: 90 });
      const rendered = await host.openDocument({ bytes, report, fileName: "dropped-word.docx" });
      const pages = await layout(host);
      const found = await host.page.evaluate((text) => {
        const paragraph = Array.from(document.querySelectorAll("#docBody article > p")).find((p) => p.textContent.trim() === text);
        const page = paragraph.closest("section.docx");
        const box = page.getBoundingClientRect();
        const rect = paragraph.getBoundingClientRect();
        const style = getComputedStyle(page);
        return { left: rect.left - box.left, right: rect.right - box.left, textLeft: parseFloat(style.paddingLeft), textRight: box.width - parseFloat(style.paddingRight) };
      }, DROPPED_WORD);
      assert.ok(found.left >= found.textLeft - 0.5 && found.right <= found.textRight + 0.5,
        `the dropped word lies from ${found.left} px to ${found.right} px, the text area from ${found.textLeft} px to ${found.textRight} px`);
      assert.equal(rendered.pages, 3, "the reader gives 3 pages; Word gives 2");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61.", "Alpha line 63."]);
    });
  });

  // The same picture in the text's flow, in a paragraph of its own
  // (wp:inline). Word gives 2 pages and sets it at the top of the second
  // column (324 pt, 108 pt), where it runs past the page as it does in the
  // reader. Like a table in the text's flow, it holds nothing back.
  test("a picture wider than a column that is in the text's flow goes where Word puts it", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx({ lines: 100, picture: { after: 92, width: 468, wrap: "inline" } });
      const rendered = await host.openDocument({ bytes, report, fileName: "wide-picture-in-flow.docx" });
      const pages = await layout(host);
      const found = await picture(host);
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      assert.deepEqual(starts(pages), ["Title line 1.", "Alpha line 61."]);
      assert.equal(found.page, 2);
      near(found.left, 432, "picture left");
      near(found.top, 144, "picture top");
    });
  });

  // A one-column section has one place for a picture, however wide it is,
  // so a picture wider than its text holds nothing back. The figure's
  // section holds a floating picture 500 pt wide (its text is 468 pt wide)
  // and a block 72 pt shorter: Word gives 2 pages with lines 73 and 74 above
  // the figure, the picture from the left margin, and the caption at 450 pt.
  test("a floating picture wider than the text of a one-column section holds nothing back", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 2, figurePicture: 500 });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-section-picture.docx" });
      const pages = await layout(host);
      const found = await picture(host);
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Alpha line 73."]);
      assert.deepEqual(counts(pages), [72, 26]);
      assert.equal(found.page, 2);
      near(found.left, 96, "picture left");
      near(find(pages[1], "Figure block one.").top, 120, "figure top");
      near(find(pages[1], "Figure caption one.").top, 600, "caption top");
      near(find(pages[1], "Gamma line 1.").top, 624, "the text after the figure");
    });
  });

  // The figure section is continuous but on a landscape page, which Word
  // starts on a new page: 3 pages. The empty start of the figure's
  // paragraph, before the saved start, made a blank portrait page: 4 pages.
  test("the empty start of a paragraph split at a saved start joins its landscape page", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 0, figurePage: "landscape" });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-landscape.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 3, "Word gives 3 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Figure block one.", "Gamma line 11."]);
      assert.deepEqual(pages.map((page) => Math.round(page.width)), [816, 1056, 1056]);
      assert.deepEqual(texts(pages), [...alpha(1, 72), ...figure, ...gamma]);
    });
  });

  // 33 lines to a column and 200 lines before the figure: Word gives 4
  // pages of 66, 66, and 66 lines, and lines 199 and 200 above the figure.
  // The text past page 1 is 134 lines, all but 2 not laid out yet when it
  // is measured; lines 199 and 200 made a fifth page.
  test("a long two-column section fills its pages and its last two lines continue above the figure section", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 134, columnLines: 33 });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-long.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 4, "Word gives 4 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Alpha line 67.", "Alpha line 133.", "Alpha line 199."]);
      assert.deepEqual(counts(pages), [66, 66, 66, 25]);
      assert.deepEqual(texts(pages), [...alpha(1, 200), ...figure, ...gamma]);
      assertInside(pages);
    });
  });

  // Controls: Word starts the figure's page itself, and lines 73 and 74
  // keep a page of their own.
  test("two lines before a section that starts a new page keep a page of their own", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 2, figureSection: "nextPage" });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-next-page.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 3, "Word gives 3 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Alpha line 73.", "Figure block one."]);
      assert.deepEqual(counts(pages), [72, 2, 23]);
    });
  });

  test("two lines before a continuous section on a landscape page keep a page of their own", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 2, figurePage: "landscape" });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-landscape-over.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 4, "Word gives 4 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Alpha line 73.", "Figure block one.", "Gamma line 11."]);
      assert.deepEqual(counts(pages), [72, 2, 13, 10]);
      assert.deepEqual(pages.map((page) => Math.round(page.width)), [816, 816, 1056, 1056]);
    });
  });

  test("a figure section whose page start the text reaches exactly starts page 2", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFigureSectionDocx({ extra: 0 });
      const rendered = await host.openDocument({ bytes, report, fileName: "figure-fit.docx" });
      const pages = await layout(host);
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      assert.deepEqual(starts(pages), ["Alpha line 1.", "Figure block one."]);
      near(find(pages[1], "Figure block one.").top, 96, "figure top");
      near(find(pages[1], "Gamma line 1.").top, 600, "the text after the figure");
    });
  });
});

describe("page view follows Word's theme fonts, line heights, spacing, and fixed tables", () => {
  async function measure(host) {
    const { bytes, report } = await makeWordMetricsDocx();
    await host.openDocument({ bytes, report, fileName: "word-metrics.docx" });
    return host.page.evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll("#docBody article p"));
      const box = (text) => paragraphs.find((p) => p.textContent.includes(text)).getBoundingClientRect();
      const gap = (above, below) => box(below).top - box(above).bottom;
      const marker = Array.from(document.querySelectorAll("#docBody span")).find((span) => span.textContent.includes("Theme font marker"));
      const empty = paragraphs.find((p) => p.previousElementSibling && p.previousElementSibling.textContent.includes("Reference marker"));
      return {
        font: getComputedStyle(marker).fontFamily.split(",")[0].replace(/["']/g, "").trim(),
        references: box("Reference marker one.").height,
        empty: empty.getBoundingClientRect().height,
        large: empty.nextElementSibling.getBoundingClientRect().height,
        contextual: [gap("Contextual one.", "Contextual two."), gap("Contextual two.", "Contextual three."),
          gap("Contextual three.", "After the contextual")],
        list: [gap("List item one.", "List item two."), gap("List item two.", "After the list.")],
        cells: Array.from(document.querySelector("#docBody table").rows[0].cells).map((cell) => cell.getBoundingClientRect().width)
      };
    });
  }

  function near(actual, expected, tolerance, label) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} px, expected ${expected} px`);
  }

  // The survey's body runs name w:asciiTheme="majorBidi". Its theme leaves the
  // complex-script typeface empty and names Times New Roman for Arabic, the
  // w:themeFontLang w:bidi language; docx-preview defines no variable for the
  // slot, so the text took the paragraph's Aptos.
  test("a run in the majorBidi theme font uses the theme's font for the bidi language", async () => {
    await withHost({}, async (host) => {
      assert.equal((await measure(host)).font, "Times New Roman");
    });
  });

  // 10 pt runs and a 10 pt paragraph mark in a 12 pt style: Word spaces each
  // line at 10 pt (11.52 pt single, 15.36 px); CSS spaced them at the style's
  // 12 pt, 18.43 px. An empty paragraph is as tall as its mark, 1 pt or 16 pt.
  test("a paragraph is spaced by its runs and mark, not by a larger style size", async () => {
    await withHost({}, async (host) => {
      const result = await measure(host);
      near(result.references, 3 * 15.36, 0.5, "three 10 pt lines");
      assert.ok(result.empty < 2, `an empty paragraph with a 1 pt mark is ${result.empty} px tall`);
      // A 16 pt mark in the 11 pt Normal style. An empty paragraph is a line
      // of its mark, as in Word: 21.25 pt (28.33 px) measured in Word 365,
      // a 16 pt Aptos line at the style's 1.08 spacing. It was 1 em, 21.33 px.
      near(result.large, 21.25 * 4 / 3, 0.5, "an empty paragraph with a 16 pt mark");
    });
  });

  test("contextual spacing drops the space between paragraphs of one style only", async () => {
    await withHost({}, async (host) => {
      const result = await measure(host);
      // Spacing after is 200 twips, 13.33 px.
      near(result.contextual[0], 0, 0.5, "between two references");
      near(result.contextual[1], 0, 0.5, "between two references");
      near(result.contextual[2], 13.33, 0.5, "before a Normal paragraph");
      near(result.list[0], 0, 0.5, "between two list paragraphs, from the style");
      near(result.list[1], 13.33, 0.5, "after the list");
    });
  });

  // Word writes w:tblLayout w:type="fixed"; docx-preview read w:val and laid
  // every fixed table out to fit its content.
  test("a fixed table keeps its grid widths", async () => {
    await withHost({}, async (host) => {
      const cells = (await measure(host)).cells;
      [4000, 1000, 4360].forEach((twips, index) => near(cells[index], twips / 15, 1, `column ${index + 1}`));
    });
  });
});

// Word 365 lays the page-flow document out on 5 pages: the tall row runs
// from page 1 to page 3 under a header row repeated on pages 2 and 3, the
// row marked w:cantSplit moves whole to page 4, the numbered paragraph runs
// from page 4 to 5, and lines with superscripts are as far apart as plain
// lines. Page 1 prints the title page's footer of 12 empty lines; the other
// pages print the one-line footer.
describe("page view breaks tables, lists, and footers as Word does", () => {
  test("rows, numbered paragraphs, superscripts, and title-page footers land where Word puts them", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makePageFlowDocx();
      const rendered = await host.openDocument({ bytes, report, fileName: "page-flow.docx" });
      assert.equal(rendered.pages, 5, "Word gives 5 pages");
      const result = await host.page.evaluate(() => {
        document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
        const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
        const on = (marker) => pages.map((page, index) => Array.from(page.querySelectorAll("article"))
          .some((article) => article.textContent.includes(marker)) ? index + 1 : 0).filter(Boolean);
        const paragraph = (text) => Array.from(document.querySelectorAll("#docBody p")).find((p) => p.textContent.startsWith(text));
        const continued = Array.from(document.querySelectorAll("#docBody p[data-ld-continued]"))
          .filter((p) => /docx-num-/.test(p.className));
        return {
          tallStart: on("Tall row start"), tallEnd: on("Tall row end"),
          wholeStart: on("Whole row start"), wholeEnd: on("Whole row end"),
          numberedStart: on("Numbered start"), numberedEnd: on("Numbered end"),
          repeated: pages.map((page) => page.querySelectorAll("tr[data-ld-repeated]").length),
          continuedMarkers: continued.map((p) => getComputedStyle(p, "::before").content),
          footers: pages.map((page) => { const footer = page.querySelector("footer"); return footer ? footer.textContent.trim() || footer.children.length : null; }),
          raised: paragraph("Raised para").getBoundingClientRect().height,
          plain: paragraph("Plain para 2").getBoundingClientRect().height
        };
      });
      assert.deepEqual([result.tallStart, result.tallEnd], [[1], [3]], "the tall row breaks across pages");
      assert.deepEqual([result.wholeStart, result.wholeEnd], [[4], [4]], "a row marked cantSplit moves whole");
      assert.deepEqual(result.repeated, [0, 1, 1, 1, 0], "the header row repeats on each page the table runs onto");
      assert.deepEqual([result.numberedStart, result.numberedEnd], [[4], [5]], "a numbered paragraph breaks across pages");
      assert.equal(result.continuedMarkers.length, 1);
      assert.equal(result.continuedMarkers[0], "none", "its continuation shows no number");
      assert.deepEqual(result.footers, [12, "Page footer marker", "Page footer marker", "Page footer marker", "Page footer marker"]);
      assert.ok(Math.abs(result.raised - result.plain) < 0.5, `four lines with superscripts ${result.raised} px, plain ${result.plain} px`);
    });
  });

  // Where each marker's text is: the pages that hold it, and whether any of
  // its lines lies past the page's text area (below it, or in the overflow
  // column beside it, which the page clips).
  function placesOf(host, markers) {
    return host.page.evaluate((markers) => {
      document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
      const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
      const found = {};
      markers.forEach((marker) => {
        found[marker] = { pages: [], hidden: false };
      });
      pages.forEach((page, index) => {
        const article = page.querySelector(":scope > article");
        const box = article.getBoundingClientRect();
        const style = getComputedStyle(page);
        const bottom = page.getBoundingClientRect().top + parseFloat(style.minHeight) - parseFloat(style.paddingBottom);
        const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          markers.forEach((marker) => {
            if (!node.data.includes(marker)) {
              return;
            }
            const entry = found[marker];
            if (entry.pages[entry.pages.length - 1] !== index + 1) {
              entry.pages.push(index + 1);
            }
            const range = document.createRange();
            range.selectNodeContents(node);
            Array.from(range.getClientRects()).forEach((rect) => {
              if (rect.width > 0 && (rect.bottom > bottom + 0.5 || rect.left > box.right + 200)) {
                entry.hidden = true;
              }
            });
          });
        }
      });
      return { count: pages.length, found };
    }, markers);
  }

  // The core drops a table's deleted rows (tracked deletions), and a table
  // whose rows are all deleted is left with none. Its box has no width, and
  // at the section's left edge it read as left of the text area: it took a
  // page of its own, and its heading another.
  test("an empty table keeps its heading and the text after it on the page", async () => {
    await withHost({}, async (host) => {
      const fixture = await makeEmptyTableDocx();
      const rendered = await host.openDocument({ ...fixture, fileName: "empty-table.docx" });
      const places = await placesOf(host, ["Heading kept", "Body line 1.", "Body line 30."]);
      assert.equal(rendered.pages, 2);
      assert.deepEqual(places.found["Heading kept"].pages, [1]);
      assert.deepEqual(places.found["Body line 1."].pages, [1]);
      assert.deepEqual(places.found["Body line 30."].pages, [1]);
    });
  });

  // Split at the foot of a page, a row ends there with its cells' bottom
  // margin and border, which it did not have where Chrome ran it on into
  // the overflow column. With an 8 px bottom cell margin, the part that
  // stayed went past the page into that column, which the page clips, and
  // its 24 lines were not shown.
  test("a row split at the foot of a page keeps room for its cells' bottom margin", async () => {
    await withHost({}, async (host) => {
      const fixture = await makePaddedRowDocx();
      await host.openDocument({ ...fixture, fileName: "padded-row.docx" });
      const { found } = await placesOf(host, ["Padded line 1.", "Padded line 20.", "Padded line 40."]);
      assert.deepEqual(found["Padded line 1."], { pages: [1], hidden: false });
      assert.deepEqual(found["Padded line 20."], { pages: [1], hidden: false });
      assert.deepEqual(found["Padded line 40."], { pages: [2], hidden: false });
    });
  });

  // A row whose lines all fit and whose height (w:trHeight) does not had
  // nothing to split: split, it left an empty copy as tall as itself on the
  // next page and its own foot past the page.
  test("a row taller than the room left, with lines that fit, moves whole", async () => {
    await withHost({}, async (host) => {
      const fixture = await makeTallRowDocx();
      const rendered = await host.openDocument({ ...fixture, fileName: "tall-row.docx" });
      const result = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody table"))
        .map((table) => ({
          page: Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).indexOf(table.closest("section.docx")) + 1,
          rows: Array.from(table.rows).map((row) => row.textContent.trim())
        })));
      assert.equal(rendered.pages, 2);
      assert.deepEqual(result, [{ page: 2, rows: ["Tall row text."] }]);
    });
  });

  // Word does not break a row of exact height across pages: it started a
  // page with such a row where the page view had split it between its
  // lines, leaving the rest of its height past the page.
  test("a row of exact height moves whole", async () => {
    await withHost({}, async (host) => {
      const fixture = await makeExactRowDocx();
      await host.openDocument({ ...fixture, fileName: "exact-row.docx" });
      const { found } = await placesOf(host, ["Exact left line 1", "Exact right line 1", "Exact left line 8", "Opening line 50."]);
      assert.deepEqual(found["Opening line 50."].pages, [1]);
      assert.deepEqual(found["Exact left line 1"], { pages: [2], hidden: false });
      assert.deepEqual(found["Exact right line 1"], { pages: [2], hidden: false });
      assert.deepEqual(found["Exact left line 8"], { pages: [2], hidden: false });
    });
  });
});

describe("page view follows Word's page starts and stand-in fonts", () => {
  // Word gives 2 pages: page 1 holds the 57 lines, page 2 starts with the
  // paragraph whose start Word saved. docx-preview split that paragraph at
  // the saved start, and its empty first part, past page 1 in a section of
  // other columns, made a blank page 2.
  test("the empty first part of a paragraph split at a saved page start makes no page of its own", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeSavedStartAfterBreakDocx();
      const rendered = await host.openDocument({ bytes, report, fileName: "saved-start.docx" });
      assert.equal(rendered.pages, 2, "Word gives 2 pages");
      const first = await host.page.evaluate(() => {
        const page = document.querySelectorAll("#docBody .docx-wrapper > section.docx")[1];
        return Array.from(page.querySelectorAll("article")).map((article) => article.textContent).join("").trim().slice(0, 22);
      });
      assert.equal(first, "After the saved start.");
    });
  });

  // Aptos is not installed outside Office. Its text is drawn in Calibri with
  // the letter spacing that brings Calibri to Aptos's average width.
  test("Aptos text is drawn in Calibri spaced to Aptos's width", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeWordMetricsDocx();
      await host.openDocument({ bytes, report, fileName: "word-metrics.docx" });
      const style = await host.page.evaluate(() => {
        const span = Array.from(document.querySelectorAll("#docBody span")).find((s) => s.textContent.includes("Closing marker lynx"));
        const computed = getComputedStyle(span);
        // Whether Calibri or Carlito is installed, measured as the reader
        // does: a font that is present changes the probe's box.
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;font-size:200px;white-space:nowrap";
        probe.textContent = "Hxgmilw0";
        document.body.appendChild(probe);
        const box = (stack) => {
          probe.style.fontFamily = stack;
          const rect = probe.getBoundingClientRect();
          return rect.width + "x" + rect.height;
        };
        const standIn = ["Calibri", "Carlito"].some((name) =>
          ["serif", "monospace"].some((generic) => box(`"${name}", ${generic}`) !== box(generic)));
        probe.remove();
        return { family: computed.fontFamily, size: parseFloat(computed.fontSize), spacing: computed.letterSpacing, standIn };
      });
      assert.match(style.family, /^"?Aptos"?, "?Calibri"?/);
      if (style.standIn) {
        const spacing = parseFloat(style.spacing);
        assert.ok(Math.abs(spacing - 0.0188 * style.size) < 0.01, `letter spacing ${spacing} px at ${style.size} px`);
      } else {
        // Without Calibri or Carlito another font is drawn, and Calibri's
        // spacing would only make it wider.
        assert.equal(style.spacing, "normal");
      }
    });
  });

  // Inline styles on every paragraph gave each its own computed style in
  // Chromium: the 1,000-page report took 720 MiB instead of 294. The single
  // line and stand-in spacing come from shared rules instead.
  test("Word's line heights reach every paragraph without an inline style each", async () => {
    const inspect = () => {
      const paragraphs = Array.from(document.querySelectorAll("#docBody p"));
      const elements = paragraphs.concat(Array.from(document.querySelectorAll("#docBody p span")));
      return {
        paragraphs: paragraphs.length,
        withLine: paragraphs.filter((p) => getComputedStyle(p).getPropertyValue("--ld-line").trim()).length,
        // Paragraphs with text and no line spacing of their own: their line
        // is the single line, as a multiple of the size.
        lines: paragraphs.filter((p) => /^Default line/.test(p.textContent)).map((p) => {
          const style = getComputedStyle(p);
          return Math.round(parseFloat(style.lineHeight) / parseFloat(style.fontSize) * 1000) / 1000;
        }),
        inline: elements.filter((e) => /--ld-line|line-height|letter-spacing/.test(e.getAttribute("style") || "")).length
      };
    };
    for (const [name, make] of [["word-metrics.docx", makeWordMetricsDocx], ["default-line.docx", makeDefaultLineDocx]]) {
      await withHost({}, async (host) => {
        const { bytes, report } = await make();
        await host.openDocument({ bytes, report, fileName: name });
        const counts = await host.page.evaluate(inspect);
        assert.ok(counts.paragraphs > 0, name);
        assert.equal(counts.withLine, counts.paragraphs, `${name}: every paragraph has its font's single line`);
        assert.equal(counts.inline, 0, `${name}: no paragraph or run carries the line or spacing inline`);
        if (name === "default-line.docx") {
          // Calibri's single line, then Times New Roman's (Fixups.wordSingleLine).
          assert.deepEqual(counts.lines, [1.221, 1.152, 1.221, 1.152, 1.221, 1.152]);
        }
      });
    }
  });

  // Matching every page's lines at load styled all of a 1,000-page report
  // and took it from 2.2 to 7.5 seconds. A long document's later pages get
  // their lines when they come near the window.
  test("a long document's far pages get Word's lines when they come near", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeBigDocx(300);
      await host.openDocument({ bytes, report, fileName: "big-300.docx" });
      const matched = (index) => host.page.evaluate((at) => {
        const pages = document.querySelectorAll("#docBody .docx-wrapper > section.docx");
        const page = at < 0 ? pages[pages.length + at] : pages[at];
        const paragraphs = Array.from(page.querySelectorAll("p")).filter((p) => /\S/.test(p.textContent));
        return paragraphs.length > 0 && paragraphs.every((p) => /(^|\s)ld-l\d+(\s|$)/.test(p.className));
      }, index);
      assert.equal(await matched(0), true, "the first page is matched at load");
      assert.equal(await matched(-1), false, "the last page waits until it is near");
      // A background tab gets no intersection updates.
      await host.page.bringToFront();
      await host.page.evaluate(() => {
        const pages = document.querySelectorAll("#docBody .docx-wrapper > section.docx");
        pages[pages.length - 1].scrollIntoView();
      });
      const state = () => host.page.evaluate(() => {
        const scroller = document.getElementById("docScroller");
        const pages = document.querySelectorAll("#docBody .docx-wrapper > section.docx");
        const last = pages[pages.length - 1];
        const paragraphs = Array.from(last.querySelectorAll("p")).filter((p) => /\S/.test(p.textContent));
        return {
          done: paragraphs.every((p) => /(^|\s)ld-l\d+(\s|$)/.test(p.className)),
          matched: paragraphs.filter((p) => /(^|\s)ld-l\d+(\s|$)/.test(p.className)).length,
          paragraphs: paragraphs.length,
          pages: pages.length,
          scrollTop: Math.round(scroller.scrollTop),
          lastTop: Math.round(last.getBoundingClientRect().top - scroller.getBoundingClientRect().top),
          visibility: document.visibilityState
        };
      });
      let seen = await state();
      for (let tries = 0; !seen.done && tries < 50; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        seen = await state();
      }
      assert.ok(seen.done, `the last page is matched once near: ${JSON.stringify(seen)}`);
    });
  });
});

describe("page view follows Word's floating boxes, tab stops, and running headers", () => {
  // Expected values come from Word itself: tests/reader/make-floats-docx.mjs
  // exported to PDF by Word 16 gives 4 pages. The text box anchored in the
  // "II. Anchor Heading" paragraph prints at the top margin of page 2 across
  // both columns, 73.2 pt tall, with 12 pt and then the columns' text below
  // it; the heading is on page 2 as well. "I. Introduction" starts 115.2 pt
  // from the top of page 1. Every page's header ends at the right margin with
  // its page number. Each reference's text starts at its hanging indent
  // (20 pt), on the first line after the tab and on the lines after it.
  const POINT = 4 / 3;

  async function openFloats(host, options = {}) {
    const { bytes, report } = await makeFloatsDocx();
    return host.openDocument({ bytes, report, fileName: "floats.docx", ...options });
  }

  async function floatLayout(host) {
    return host.page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
      return pages.map((page, index) => {
        const box = page.getBoundingClientRect();
        const scale = box.width / page.offsetWidth;
        const style = getComputedStyle(page);
        const contentTop = box.top + parseFloat(style.paddingTop) * scale;
        const floats = Array.from(page.querySelectorAll(".ld-float")).map((node) => {
          const r = node.getBoundingClientRect();
          return {
            pageLevel: node.parentElement === page,
            top: (r.top - contentTop) / scale, bottom: (r.bottom - box.top) / scale,
            left: (r.left - box.left) / scale, right: (r.right - box.left) / scale,
            width: r.width / scale, height: r.height / scale,
            text: node.textContent
          };
        });
        const paragraphs = Array.from(page.querySelectorAll("article p")).filter((p) => !p.closest(".ld-float") && /\S/.test(p.textContent))
          .map((p) => {
            const rects = Array.from(p.getClientRects()).filter((r) => r.height > 0);
            return {
              text: p.textContent.trim().slice(0, 24),
              rects: rects.map((r) => ({ top: (r.top - box.top) / scale, bottom: (r.bottom - box.top) / scale, left: (r.left - box.left) / scale, right: (r.right - box.left) / scale }))
            };
          });
        const contentBottom = (box.top + (page.offsetHeight - parseFloat(style.paddingBottom)) * scale - box.top) / scale;
        return { index: index + 1, width: page.offsetWidth, floats, paragraphs, top: (contentTop - box.top) / scale, bottom: contentBottom };
      });
    });
  }

  test("a text box floated at the top margin sits at the top of its anchor's page, across the columns, over no text", async () => {
    await withHost({}, async (host) => {
      const rendered = await openFloats(host);
      assert.equal(rendered.pages, 4, `pages: ${rendered.pages}; Word gives 4`);
      const pages = await floatLayout(host);
      const withFloat = pages.filter((page) => page.floats.some((f) => f.text.includes("Floatbox heron")));
      assert.equal(withFloat.length, 1, "the box is shown once");
      const page = withFloat[0];
      const float = page.floats.find((f) => f.text.includes("Floatbox heron"));
      assert.equal(page.index, 2, `the box is on page ${page.index}; Word prints it on page 2`);
      const anchorPage = pages.find((p) => p.paragraphs.some((q) => q.text.startsWith("II. Anchor Heading")));
      assert.equal(anchorPage.index, 2, `the anchor heading is on page ${anchorPage.index}; Word puts it on page 2`);
      assert.ok(float.pageLevel, "the box belongs to the page, not to a column");
      assert.ok(Math.abs(float.top) <= 1, `the box starts ${float.top}px below the top margin`);
      assert.ok(Math.abs(float.width - 514 * POINT) <= 1, `the box is ${float.width}px wide; 514 pt spans both columns`);
      // Chrome draws each of the table's five 0.5 pt rules a pixel wide:
      // the reader's box is 1.3 pt taller than Word's.
      assert.ok(Math.abs(float.height - 73.2 * POINT) <= 2 * POINT, `the box is ${float.height}px tall; Word's is 73.2 pt`);
      for (const paragraph of page.paragraphs) {
        for (const rect of paragraph.rects) {
          assert.ok(rect.top >= float.bottom + 12 * POINT - 1,
            `"${paragraph.text}" starts at ${rect.top}px, inside the box or the 12 pt below it (box ends at ${float.bottom}px)`);
        }
      }
    });
  });

  // Word prints the figure box on page 3, from 718.6 to 747.25 pt, its foot
  // on the bottom margin (748 pt), and the columns' text above it ends at
  // 694.1 pt, at least 12 pt above the box.
  test("a text box floated to the foot of the margin sits at the foot of its anchor's page, below the text", async () => {
    await withHost({}, async (host) => {
      await openFloats(host);
      const pages = await floatLayout(host);
      const withFloat = pages.filter((page) => page.floats.some((f) => f.text.includes("Figurebox wren")));
      assert.equal(withFloat.length, 1, "the box is shown once");
      const page = withFloat[0];
      const float = page.floats.find((f) => f.text.includes("Figurebox wren"));
      assert.equal(page.index, 3, `the box is on page ${page.index}; Word prints it on page 3`);
      assert.ok(float.pageLevel, "the box belongs to the page, not to a column");
      assert.ok(Math.abs(float.bottom - page.bottom) <= 1, `the box ends at ${float.bottom}px; the bottom margin is at ${page.bottom}px`);
      // Word's 28.65 pt runs between the centres of the box's 0.75 pt line.
      assert.ok(Math.abs(float.height - 28.65 * POINT) <= 2 * POINT, `the box is ${float.height}px tall; Word's is 28.65 pt`);
      const floatTop = float.bottom - float.height;
      for (const paragraph of page.paragraphs) {
        for (const rect of paragraph.rects) {
          assert.ok(rect.bottom <= floatTop - 12 * POINT + 1,
            `"${paragraph.text}" ends at ${rect.bottom}px, inside the box or the 12 pt above it (box starts at ${floatTop}px)`);
        }
      }
    });
  });

  test("the text in a floating box does not take its anchor heading's small capitals", async () => {
    await withHost({}, async (host) => {
      await openFloats(host);
      const caps = await host.page.evaluate(() => {
        const cell = Array.from(document.querySelectorAll("#docBody td")).find((td) => td.textContent.includes("Floatbox heron"));
        return cell ? getComputedStyle(cell.querySelector("span") || cell).fontVariantCaps : null;
      });
      assert.equal(caps, "normal");
    });
  });

  test("a footnote reference's mark adds no height to its line", async () => {
    await withHost({}, async (host) => {
      await openFloats(host);
      const pages = await floatLayout(host);
      const heading = pages[0].paragraphs.find((p) => p.text.startsWith("I. Introduction"));
      const top = heading.rects[0].top / POINT;
      assert.ok(Math.abs(top - 115.2) <= 1.5, `"I. Introduction" starts ${top} pt from the top of the page; Word's starts at 115.2 pt`);
    });
  });

  async function referenceLayout(host) {
    return host.page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
      const out = [];
      pages.forEach((page, index) => {
        const box = page.getBoundingClientRect();
        const scale = box.width / page.offsetWidth;
        page.querySelectorAll("article").forEach((article) => {
          const a = article.getBoundingClientRect();
          article.querySelectorAll("p").forEach((p) => {
            const match = /^\[(\d+)\]/.exec(p.textContent);
            const tab = p.querySelector("span.ld-tab");
            if (!match || !tab) {
              return;
            }
            const range = document.createRange();
            range.selectNodeContents(p);
            const numberRange = document.createRange();
            const first = p.querySelector("span").firstChild;
            numberRange.setStart(first, 0);
            numberRange.setEnd(first, first.textContent.length);
            const after = document.createRange();
            after.setStartAfter(tab);
            after.setEnd(p, p.childNodes.length);
            const lines = Array.from(after.getClientRects()).filter((r) => r.width > 0);
            const lineLefts = [];
            for (const r of lines) {
              if (!lineLefts.some((l) => Math.abs(l.top - r.top) < 2)) {
                lineLefts.push({ top: r.top, left: r.left });
              }
            }
            lineLefts.sort((x, y) => x.top - y.top);
            const text = Array.from(range.getClientRects());
            out.push({
              page: index + 1, n: Number(match[1]),
              numberLeft: (numberRange.getBoundingClientRect().left - box.left) / scale,
              starts: lineLefts.map((l) => (l.left - box.left) / scale),
              right: Math.max(...text.map((r) => r.right - box.left)) / scale,
              articleRight: (a.right - box.left) / scale,
              articleLeft: (a.left - box.left) / scale,
              column: (text[0].left - a.left) > a.width / 2 ? "R" : "L"
            });
          });
        });
      });
      return out;
    });
  }

  test("a reference's text starts at its hanging indent, after the tab and on later lines, in two columns", async () => {
    await withHost({}, async (host) => {
      const { references } = await makeFloatsDocx();
      await openFloats(host);
      const first = await referenceLayout(host);
      assert.equal(first.length, references, "every reference is shown once");
      for (const entry of first) {
        assert.ok(entry.starts.length >= 2, `[${entry.n}] runs to two lines, as in Word`);
        for (const start of entry.starts) {
          const indent = (start - entry.numberLeft) / POINT;
          assert.ok(Math.abs(indent - 20) <= 1, `[${entry.n}] text starts ${indent} pt after its number; the hanging indent is 20 pt`);
        }
        // The text's rectangles take in the space that ends a justified line.
        assert.ok(entry.right <= entry.articleRight + 3 * POINT, `[${entry.n}] reaches ${entry.right}px; the text area ends at ${entry.articleRight}px`);
      }
      const lastPage = Math.max(...first.map((entry) => entry.page));
      assert.equal(lastPage, 4, `the references end on page ${lastPage}; Word ends them on page 4`);
      // docx-preview's own tab pass ran 500 ms after rendering and moved the
      // text again; the layout must not change after the reader settles.
      await new Promise((resolve) => setTimeout(resolve, 800));
      assert.deepEqual(await referenceLayout(host), first, "the references do not move after rendering");
    });
  });

  // Word sets the picture 2.9 pt from the column's left edge, on one line:
  // centred on the 125 pt stop. Before the tab has its width, the picture
  // does not fit beside it and wraps; the tab is sized from the picture's
  // whole width, not from what was left on the tab's line.
  test("a picture after a centred tab is centred on the stop, on one line", async () => {
    await withHost({}, async (host) => {
      await openFloats(host);
      const placed = await host.page.evaluate(() => {
        const image = Array.from(document.querySelectorAll("#docBody article img"))[0];
        const p = image.closest("p");
        const page = p.closest("section.docx");
        const scale = page.getBoundingClientRect().width / page.offsetWidth;
        const column = p.getBoundingClientRect();
        const box = image.getBoundingClientRect();
        const tab = p.querySelector("span.ld-tab").getBoundingClientRect();
        return { left: (box.left - column.left) / scale, sameLine: box.top < tab.bottom && box.bottom > tab.top };
      });
      assert.ok(placed.sameLine, "the picture is on the tab's line");
      assert.ok(Math.abs(placed.left / POINT - 2.9) <= 1.5, `the picture starts ${placed.left / POINT} pt into its column; Word's starts 2.9 pt in`);
    });
  });

  test("every page shows its page number at the right margin, also where a section names no header", async () => {
    await withHost({}, async (host) => {
      const rendered = await openFloats(host);
      const headers = await host.page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
        return pages.map((page) => {
          const header = Array.from(page.children).find((c) => c.nodeName === "HEADER");
          if (!header) {
            return null;
          }
          const p = header.querySelector("p");
          const range = document.createRange();
          range.selectNodeContents(p);
          const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
          const box = page.getBoundingClientRect();
          const scale = box.width / page.offsetWidth;
          const style = getComputedStyle(page);
          return {
            text: header.textContent.trim(),
            right: (Math.max(...rects.map((r) => r.right)) - box.left) / scale,
            margin: page.offsetWidth - parseFloat(style.paddingRight)
          };
        });
      });
      assert.equal(headers.length, rendered.pages);
      assert.deepEqual(headers.map((header) => header && header.text), headers.map((_, index) => String(index + 1)),
        "each page's header holds its page number");
      headers.forEach((header, index) => {
        assert.ok(Math.abs(header.right - header.margin) <= 2, `page ${index + 1}: the number ends at ${header.right}px; the right margin is at ${header.margin}px`);
      });
    });
  });

  test("a footnote with the author's own mark shows no number", async () => {
    await withHost({}, async (host) => {
      await openFloats(host);
      const marks = await host.page.evaluate(() => {
        const visible = (node) => node && getComputedStyle(node).display !== "none" && node.getClientRects().length > 0;
        const author = Array.from(document.querySelectorAll("#docBody article p")).find((p) => p.textContent.includes("A. Author and B. Writer") && !/^\[/.test(p.textContent));
        const note = Array.from(document.querySelectorAll("#docBody li")).find((li) => li.textContent.includes("Affiliation note wren"));
        return {
          shownNumbers: Array.from(author.querySelectorAll("sup")).filter(visible).map((s) => s.textContent),
          marker: note ? getComputedStyle(note).listStyleType : null
        };
      });
      assert.deepEqual(marks.shownNumbers, [], "no number at the reference");
      assert.equal(marks.marker, "none", "no number before the note");
    });
  });

  test("reading view sets the floating box between paragraphs, not over them", async () => {
    await withHost({ view: "reading" }, async (host) => {
      await openFloats(host);
      const overlaps = await host.page.evaluate(() => {
        const cell = Array.from(document.querySelectorAll("#docBody td")).find((td) => td.textContent.includes("Floatbox heron"));
        const box = cell ? cell.closest(".ld-float") || cell.closest("svg") || cell.closest("table") : null;
        if (!box) {
          return ["no box"];
        }
        const b = box.getBoundingClientRect();
        return Array.from(document.querySelectorAll("#docBody p")).filter((p) => !box.contains(p)).flatMap((p) =>
          Array.from(p.getClientRects()).filter((r) => r.height > 0 && r.bottom > b.top + 1 && r.top < b.bottom - 1 && r.right > b.left && r.left < b.right)
            .map(() => p.textContent.trim().slice(0, 24)));
      });
      assert.deepEqual(overlaps, []);
    });
  });

  // Word refits a box that fits its text when it lays the page out: a file
  // that saved the box at 140 pt prints it 73.2 pt tall, as Word does the
  // default fixture. The reader held such a box at the height saved.
  test("a box that fits its text is as tall as its text, whatever height the file saved", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFloatsDocx({ boxHeight: 140 });
      await host.openDocument({ bytes, report, fileName: "floats-tall.docx" });
      const pages = await floatLayout(host);
      const page = pages.find((p) => p.floats.some((f) => f.text.includes("Floatbox heron")));
      const float = page.floats.find((f) => f.text.includes("Floatbox heron"));
      // Chrome draws each of the table's five 0.5 pt rules a pixel wide:
      // the reader's box is 1.3 pt taller than Word's.
      assert.ok(Math.abs(float.height - 73.2 * POINT) <= 2 * POINT, `the box is ${float.height / POINT} pt tall; Word's is 73.2 pt`);
      for (const paragraph of page.paragraphs) {
        for (const rect of paragraph.rects) {
          assert.ok(rect.top >= float.bottom + 12 * POINT - 1,
            `"${paragraph.text}" starts at ${rect.top}px, inside the box or the 12 pt below it (box ends at ${float.bottom}px)`);
        }
      }
    });
  });

  // With 23 paragraphs before it, "II. Anchor Heading" no longer fits on
  // page 2 below the box, and Word moves the heading, and the box anchored
  // in it, to page 3: the box at the top margin and the heading 154.35 pt
  // from the top of the page. The reader set the box on page 2 and the
  // heading on page 3.
  test("a box goes to the next page with its anchor when Word moves the anchor there", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeFloatsDocx({ before: 23, savedStart: null });
      await host.openDocument({ bytes, report, fileName: "floats-23.docx" });
      const pages = await floatLayout(host);
      const boxPage = pages.find((p) => p.floats.some((f) => f.text.includes("Floatbox heron")));
      const anchorPage = pages.find((p) => p.paragraphs.some((q) => q.text.startsWith("II. Anchor Heading")));
      assert.equal(boxPage.index, 3, `the box is on page ${boxPage.index}; Word prints it on page 3`);
      assert.equal(anchorPage.index, 3, `the anchor heading is on page ${anchorPage.index}; Word puts it on page 3`);
      const heading = anchorPage.paragraphs.find((q) => q.text.startsWith("II. Anchor Heading"));
      const top = heading.rects[0].top / POINT;
      assert.ok(Math.abs(top - 154.35) <= 1.5, `the heading starts ${top} pt from the top of the page; Word's starts at 154.35 pt`);
    });
  });

  // Word never prints text past the paper's edge or in a third column. A
  // line the browser breaks later than the reader measured (here every
  // last line of a justified paragraph is spaced wider) left words of a
  // two-column paper in a third column, off the page.
  test("no text runs past the page or into a third column when lines come out longer than measured", async () => {
    await withHost({}, async (host) => {
      await host.page.addStyleTag({ content: '#docBody p[style*="text-align-last"] { letter-spacing: 0.4px; }' });
      await openFloats(host);
      const outside = await host.page.evaluate(() => {
        const found = [];
        document.querySelectorAll("#docBody .docx-wrapper > section.docx").forEach((page, index) => {
          const box = page.getBoundingClientRect();
          const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (!/\S/.test(node.nodeValue)) {
              continue;
            }
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.bottom > box.bottom + 1)) {
                found.push(`page ${index + 1}: "${node.nodeValue.trim().slice(0, 24)}" at ${Math.round(rect.left - box.left)}px`);
              }
            }
          }
        });
        return found;
      });
      assert.deepEqual(outside, []);
    });
  });
});

describe("page view follows Word's numbered headings, page fields, and stops past the indent", () => {
  // Expected values come from Word itself: tests/reader/make-numbered-docx.mjs
  // exported to PDF by Word 16. A Heading 1's text starts 100.82 pt from the
  // page's left edge (its "I." centred on the margin, then the style's
  // 10.8 pt stop and the level's 28.8 pt stop), a Heading 2's 108.02 pt (its
  // "A." at the margin, then the style's 14.4 pt stop and the 36 pt default
  // stop). The contents line is one line. The header's page number prints
  // at 6.96 pt, the footer's at 9.96 pt.
  async function numberedLayout(host, options = {}) {
    const { bytes, report } = await makeNumberedDocx(options);
    await host.openDocument({ bytes, report, fileName: "numbered.docx" });
    return host.page.evaluate(() => {
      const page = document.querySelector("#docBody .docx-wrapper > section.docx");
      const box = page.getBoundingClientRect();
      const scale = box.width / page.offsetWidth;
      const points = (value) => value / scale * 0.75;
      // Every page's headings: the pages share their left edge.
      const headings = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx article p")).filter((p) => /heading/i.test(p.className)).map((p) => {
        // The label is the paragraph's ::before box, which no range reaches:
        // its left edge is where the first line starts plus its own margin.
        const style = getComputedStyle(p);
        const before = getComputedStyle(p, "::before");
        const label = points(p.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) +
          parseFloat(style.textIndent) + (parseFloat(before.marginLeft) || 0) - box.left);
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const start = node.nodeValue.search(/\S/);
          if (start < 0 || node.parentElement.closest(".ld-tab")) {
            continue;
          }
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + 1);
          // The label ends where the paragraph's first content starts: the
          // label's tab, or the text when there is no tab.
          const x = points(range.getClientRects()[0].left - box.left);
          const tab = p.querySelector(".ld-tab");
          const first = tab && (tab.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) ? tab : null;
          // Where the text after the heading's last tab of its own starts
          // (a word's letters can be in more than one node).
          let after = NaN;
          let afterTab = NaN;
          const texts = [];
          const all = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          let text;
          while ((text = all.nextNode())) {
            if (!text.parentElement.closest(".ld-tab")) {
              texts.push(text);
            }
          }
          const following = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
          const tabs = Array.from(p.querySelectorAll(".ld-tab")).filter((item) => item !== first && following(node, item) &&
            texts.some((item2) => /\S/.test(item2.nodeValue) && following(item, item2)));
          if (tabs.length) {
            const lastTab = tabs[tabs.length - 1];
            const lastText = texts.find((item) => /\S/.test(item.nodeValue) && following(lastTab, item));
            const next = document.createRange();
            const at = lastText.nodeValue.search(/\S/);
            next.setStart(lastText, at);
            next.setEnd(lastText, at + 1);
            after = points(next.getClientRects()[0].left - box.left);
            afterTab = points(lastTab.getBoundingClientRect().left - box.left);
          }
          // The heading's words and the lines they are on: a word's line is
          // the row its first box is in (boxes of smaller letters sit lower
          // on the same row).
          const words = [];
          let current = null;
          texts.forEach((item) => {
            for (let index = 0; index < item.nodeValue.length; index += 1) {
              if (/\s/.test(item.nodeValue[index])) {
                current = null;
              } else {
                if (!current) {
                  current = { text: "", start: [item, index] };
                  words.push(current);
                }
                current.text += item.nodeValue[index];
                current.end = [item, index + 1];
              }
            }
          });
          const rows = [];
          const lines = [];
          words.forEach((word) => {
            const range = document.createRange();
            range.setStart(...word.start);
            range.setEnd(...word.end);
            const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
            let row = rows.findIndex((item) => rects[0].top < item.bottom && rects[0].bottom > item.top);
            if (row < 0) {
              rows.push({ top: rects[0].top, bottom: rects[0].bottom });
              lines.push([]);
              row = rows.length - 1;
            }
            lines[row].push({ text: word.text, left: points(rects[0].left - box.left), right: points(rects[rects.length - 1].right - box.left) });
          });
          const own = p.cloneNode(true);
          own.querySelectorAll(".ld-tab").forEach((item) => item.replaceWith("\t"));
          return { text: own.textContent.trim().split("\t")[0].trim(), x, label, labelEnd: first ? points(first.getBoundingClientRect().left - box.left) : x,
            labelWidth: (parseFloat(before.width) || NaN) * 0.75, after, afterTab, lines };
        }
        return { text: p.textContent.trim(), x: NaN, label, labelEnd: NaN };
      });
      const contents = Array.from(page.querySelectorAll("article p")).find((p) => p.textContent.includes("Contents line heron"));
      const range = document.createRange();
      const tops = [];
      if (contents) {
        range.selectNodeContents(contents);
      }
      for (const rect of contents ? range.getClientRects() : []) {
        if (rect.width > 0 && !tops.some((top) => Math.abs(top - rect.top) < 4)) {
          tops.push(rect.top);
        }
      }
      const numbers = {};
      Array.from(page.children).filter((child) => /^(HEADER|FOOTER)$/.test(child.nodeName)).forEach((part) => {
        const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (/^\s*\d+\s*$/.test(node.nodeValue)) {
            numbers[part.nodeName] = { text: node.nodeValue.trim(), size: parseFloat(getComputedStyle(node.parentElement).fontSize) * 0.75 };
          }
        }
      });
      return { headings, contentsLines: tops.length, numbers };
    });
  }

  test("a numbered heading's text starts where Word's does", async () => {
    await withHost({}, async (host) => {
      const layout = await numberedLayout(host);
      const word = { Introduction: 100.82, "Alpha Part": 108.02, "Beta Part": 108.02, "Gamma Part": 108.02, "Delta Part": 108.02, Method: 100.82 };
      assert.deepEqual(layout.headings.map((heading) => heading.text), Object.keys(word));
      for (const heading of layout.headings) {
        assert.ok(Math.abs(heading.x - word[heading.text]) <= 1.5, `"${heading.text}" starts at ${heading.x} pt; Word's starts at ${word[heading.text]} pt`);
      }
    });
  });

  // Word's PDF of the fixture: "I." spans 69.14 to 74.99 pt and "II." 67.46
  // to 76.67 pt, each centred on the 72 pt indent; the left-aligned "A." to
  // "D." start at 72.02 pt.
  test("a centred heading label is centred on its indent, as Word's is", async () => {
    await withHost({}, async (host) => {
      const layout = await numberedLayout(host);
      const word = [69.14, 72.02, 72.02, 72.02, 72.02, 67.46];
      layout.headings.forEach((heading, index) => {
        assert.ok(Math.abs(heading.label - word[index]) <= 1, `the label of "${heading.text}" starts at ${heading.label} pt; Word's starts at ${word[index]} pt`);
      });
    });
  });

  // The IEEE template centres its Heading 1 paragraphs, and their text does
  // not start with a tab: the label's own tab parts "I." from the text. Word
  // centres the label on the indent and sends the tab to the first stop past
  // the label's right edge, the style's 10.8 pt stop, so the gap is 10.8 pt
  // less half the label: Word's PDF of the fixture (centred: true) has 7.83,
  // 6.15, 4.47 and 4.25 pt after "I." to "IV.", and the text starting at
  // 280.85, 293.45, 293.45 and 291.41 pt. The label was an inline block
  // whose tab collapsed: "I.Introduction". (A Heading 2's "A." is left
  // aligned and keeps docx-preview's label, as on main: its text starts
  // 2.2 pt left of Word's 86.42 pt, a known gap this test leaves out.)
  // "V." has a 36 pt left indent of its own: Word centres it there (283.13
  // to 292.82 pt) and its text starts at 324.07 pt. "VI." has a tab of its
  // own after "Notes": Word's PDF puts "Annex" at 327.31 pt; that tab, on
  // the label's line, is measured in the label's frame too.
  // Chrome's small capitals are narrower than Word's ("Results" by about
  // 3 pt, "IV." by 1.2 pt), and the centred line moves by half of that: the
  // start is held to 2 pt and the gap to 0.7 pt of Word's, and the gap to
  // 0.15 pt of Word's rule, 10.8 pt less half the label as drawn here.
  // The starts are Word's only where the text is drawn in Times New Roman,
  // as on Windows. Linux draws it in Liberation Serif, whose small capitals
  // Chrome makes about 14% narrower ("Introduction" 69.4 px to 80.4 px), so
  // there the centred lines move by up to 4 pt and "Notes" ends before the
  // 36 pt stop, where Word's and Windows' end past it. On every platform
  // "Annex" is held to Word's rule: the first stop past the end of "Notes",
  // counted in the label's frame (the label centred on the indent).
  test("a centred heading label keeps Word's gap before the heading's text", async () => {
    await withHost({}, async (host) => {
      const layout = await numberedLayout(host, { centred: true });
      const word = { Introduction: { x: 280.85, gap: 7.83 }, Method: { x: 293.45, gap: 6.15 }, Results: { x: 293.45, gap: 4.47 },
        Outlook: { x: 291.41, gap: 4.25 }, Closing: { x: 324.07, gap: 31.25 }, Notes: { x: 266.09, gap: 4.24 } };
      const headings = layout.headings.filter((heading) => !/Part$/.test(heading.text));
      assert.deepEqual(headings.map((heading) => heading.text), Object.keys(word));
      const wordFont = process.platform === "win32";
      const annex = layout.headings.find((heading) => heading.text === "Notes");
      // The label's frame: "label" is where the label starts when centred on
      // the indent, so the indent is half the label past it, and the label
      // as drawn starts labelWidth before its end.
      const shift = annex.labelEnd - annex.labelWidth - annex.label;
      const indent = annex.label + annex.labelWidth / 2;
      const notesEnd = annex.afterTab - shift - indent;
      const stop = [10.8, 28.8].find((value) => value > notesEnd + 0.01) ?? 36 * (Math.floor(notesEnd / 36 + 0.0003) + 1);
      assert.ok(Math.abs(annex.after - shift - indent - stop) <= 0.15,
        `"Annex" starts ${annex.after - shift - indent} pt into the label's frame; "Notes" ends at ${notesEnd} pt, so Word's rule gives the ${stop} pt stop`);
      if (wordFont) {
        assert.ok(Math.abs(annex.after - 327.31) <= 1.5, `"Annex" starts at ${annex.after} pt; Word's starts at 327.31 pt`);
      }
      for (const heading of headings) {
        const expected = word[heading.text];
        if (wordFont) {
          assert.ok(Math.abs(heading.x - expected.x) <= 2, `"${heading.text}" starts at ${heading.x} pt; Word's starts at ${expected.x} pt`);
        }
        const gap = heading.x - heading.labelEnd;
        assert.ok(Math.abs(gap - expected.gap) <= 0.7, `"${heading.text}" starts ${gap} pt after its label; Word's starts ${expected.gap} pt after it`);
        // "V." is centred on its paragraph's 36 pt indent and its tab goes to
        // the 36 pt default stop past the style's last.
        const rule = (heading.text === "Closing" ? 72 - 36 : 10.8) - heading.labelWidth / 2;
        assert.ok(Math.abs(gap - rule) <= 0.15, `"${heading.text}" starts ${gap} pt after its ${heading.labelWidth} pt label; Word's rule gives ${rule} pt`);
      }
    });
  });

  // Word's PDF of the fixture (centred: true, wrapped: true): headings VII.
  // to XVII. are plain text, XVIII. to XXVI. small capitals as the IEEE
  // template sets them. Word centres each line on the indent as if the
  // label started there, and the label then reaches half its width left,
  // past the column's 72 pt edge when the line is full (X., XI.). Small
  // capitals are 80% capitals in Word, spaces included; Chrome drew them at
  // 70%, so XXII. to XXV. held "Wi..." on their first line where Word's
  // break before it, and their labels started up to 19 pt left of Word's.
  // XII.'s "Tii" ends 0.4% short of the column here, where Word's does not
  // fit: a near tie of plain text, left out.
  test("a wrapped centred heading breaks where Word's does, with its label where Word's is", async () => {
    await withHost({}, async (host) => {
      const layout = await numberedLayout(host, { centred: true, wrapped: true });
      const wrapped = layout.headings.slice(layout.headings.findIndex((heading) => heading.text === "Notes") + 1);
      const word = [[73.10, "Anchor"], [72.38, "Packet"], [76.22, "Ledger"], [69.62, "T"], [66.74, "Ti"], [70.70, "Message", "near tie"],
        [69.02, "Message"], [68.78, "Message"], [70.34, "Message"], [68.78, "Message"], [76.82, "Ledger"],
        [63.38, "W" + "i".repeat(10)], [74.42, "W" + "i".repeat(11)], [74.66, "W" + "i".repeat(12)], [71.78, "W" + "i".repeat(13)],
        [84.02, "Latency"], [82.34, "Latency"], [81.98, "Latency"], [83.66, "Latency"], [203.93, "Notes"]];
      assert.equal(wrapped.length, word.length, `${wrapped.length} headings after "Notes"; the fixture has ${word.length}`);
      wrapped.forEach((heading, index) => {
        const [label, last, skip] = word[index];
        if (skip) {
          return;
        }
        const first = heading.lines[0].map((item) => item.text);
        assert.equal(first[first.length - 1], last, `heading ${index + 7}'s first line ends "${first.slice(-2).join(" ")}"; Word's ends "${last}"`);
        // Where the text is drawn in Times New Roman, as on Windows (see the
        // test above); Liberation Serif has its widths but not its kerning.
        // The label as drawn ends where its tab starts.
        const drawn = heading.labelEnd - heading.labelWidth;
        if (process.platform === "win32") {
          assert.ok(Math.abs(drawn - label) <= 2, `the label of heading ${index + 7} starts at ${drawn} pt; Word's starts at ${label} pt`);
        }
      });
      // Digits and punctuation stay whole: Word starts "2-B," at 274.97 pt
      // and ends "Notes" at 394.40 pt. The text keeps its letters' case.
      const phase = wrapped[wrapped.length - 1].lines[0];
      assert.equal(phase.map((item) => item.text).join(" "), "Phase 2-B, Rev. 3.1 (Draft) Notes");
      if (process.platform === "win32") {
        assert.ok(Math.abs(phase[1].left - 274.97) <= 1, `"2-B," starts at ${phase[1].left} pt; Word's starts at 274.97 pt`);
        assert.ok(Math.abs(phase[phase.length - 1].right - 394.40) <= 1, `"Notes" ends at ${phase[phase.length - 1].right} pt; Word's ends at 394.40 pt`);
      }
    });
  });

  // The fixture's last paragraphs: nine lower case words in small capitals
  // set on the run, then a plain paragraph. Word's PDF ends "CACHE" at
  // 373.89 pt, and the plain paragraph's line starts 11.5 pt below the
  // small capitals' line, a 10 pt Times New Roman line: the small letters
  // do not make the line smaller.
  test("small capitals set on a run take Word's width and keep the line's height", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeNumberedDocx({ centred: true, wrapped: true });
      await host.openDocument({ bytes, report, fileName: "numbered.docx" });
      const result = await host.page.evaluate(() => {
        const page = document.querySelector("#docBody .docx-wrapper > section.docx");
        const box = page.getBoundingClientRect();
        const points = (value) => value / (box.width / page.offsetWidth) * 0.75;
        const paragraphs = Array.from(document.querySelectorAll("#docBody article p"));
        const index = paragraphs.findIndex((p) => p.textContent.trim().startsWith("buffer fabric kernel"));
        const caps = paragraphs[index];
        const range = document.createRange();
        range.selectNodeContents(caps);
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
        return { text: caps.textContent.trim(), right: points(Math.max(...rects.map((rect) => rect.right)) - box.left),
          pitch: points(paragraphs[index + 1].getBoundingClientRect().top - caps.getBoundingClientRect().top) };
      });
      assert.match(result.text, /^buffer fabric kernel channel thread vector signal memory cache$/);
      if (process.platform === "win32") {
        assert.ok(Math.abs(result.right - 373.89) <= 1, `"CACHE" ends at ${result.right} pt; Word's ends at 373.89 pt`);
      }
      assert.ok(Math.abs(result.pitch - 11.5) <= 0.3, `the next paragraph starts ${result.pitch} pt below; Word's starts 11.5 pt below`);
    });
  });

  // makeSmallCapsDocx: small capitals in runs whose font is not the
  // document's (Calibri 11) or the paragraph style's. Word's PDF of the
  // fixture (Word 16) draws every small letter in its run's own font, at 80%
  // of the run's size to the nearest half point; a run in capitals and small
  // capitals all in full size capitals; "ß" as "ß". Positions are the x of
  // each paragraph's closing "Sc", in points from the page's left edge.
  async function smallCapsLayout(host) {
    const { bytes, report } = await makeSmallCapsDocx();
    await host.openDocument({ bytes, report, fileName: "small-caps.docx" });
    return host.page.evaluate(() => {
      const page = document.querySelector("#docBody .docx-wrapper > section.docx");
      const box = page.getBoundingClientRect();
      const points = (value) => value / (box.width / page.offsetWidth) * 0.75;
      const result = {};
      document.querySelectorAll("#docBody article p").forEach((p) => {
        const id = /^Sc(\d+)/i.exec(p.textContent);
        if (!id) {
          return;
        }
        const chars = [];
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (let index = 0; index < node.data.length; index += 1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const rect = Array.from(range.getClientRects()).filter((r) => r.width > 0).pop();
            if (rect) {
              chars.push({ c: node.data[index], left: points(rect.left - box.left), top: points(rect.top - box.top) });
            }
          }
        }
        const lines = [];
        chars.forEach((char) => {
          let line = lines.find((each) => Math.abs(each.top - char.top) < 3);
          if (!line) {
            line = { top: char.top, text: "" };
            lines.push(line);
          }
          line.text += char.c;
        });
        const text = chars.map((char) => char.c).join("");
        const close = text.lastIndexOf("Sc");
        result[id[1]] = {
          closing: close > 0 ? chars[close].left : null,
          first: chars[0].top,
          ends: lines.map((line) => line.text.trim().split(/\s+/).pop().toUpperCase()),
          innerText: p.innerText,
          height: points(p.getBoundingClientRect().height),
          spans: Array.from(p.querySelectorAll("span.ld-sc")).map((span) => {
            const own = getComputedStyle(span);
            const run = getComputedStyle(span.parentElement);
            return { text: span.textContent, family: own.fontFamily, runFamily: run.fontFamily, weight: own.fontWeight, runWeight: run.fontWeight,
              style: own.fontStyle, runStyle: run.fontStyle, size: parseFloat(own.fontSize) * 0.75, runSize: parseFloat(run.fontSize) * 0.75 };
          })
        };
      });
      return result;
    });
  }

  test("small capitals keep their run's own font", async () => {
    await withHost({}, async (host) => {
      const layout = await smallCapsLayout(host);
      ["1", "2", "3", "12"].forEach((id) => {
        assert.ok(layout[id].spans.length > 0, `paragraph Sc${id} has small letters`);
        layout[id].spans.forEach((span) => {
          assert.equal(span.family, span.runFamily, `Sc${id} "${span.text}" is drawn in ${span.family}; its run's font is ${span.runFamily}`);
          assert.equal(span.weight, span.runWeight, `Sc${id} "${span.text}" weight`);
          assert.equal(span.style, span.runStyle, `Sc${id} "${span.text}" style`);
        });
      });
      if (process.platform === "win32") {
        // Word: Times New Roman bold 11.5 pt in a Calibri document, Arial
        // 10 pt and Garamond 12 pt.
        [["1", 348.79], ["2", 314.45], ["3", 346.03]].forEach(([id, word]) => {
          assert.ok(Math.abs(layout[id].closing - word) <= 1, `Sc${id} closes at ${layout[id].closing} pt; Word's at ${word} pt`);
        });
        // The 90 Calibri words wrap to Word's 7 lines, each ending on
        // Word's word.
        assert.deepEqual(layout["12"].ends, ["STREAM", "CACHE", "KERNEL", "MESSAGE", "SWITCH", "THREAD", "SC"],
          "the Calibri paragraph's lines end where Word's do");
      }
    });
  });

  test("small capitals take Word's size and leave capitals, ß and the line alone", async () => {
    await withHost({}, async (host) => {
      const layout = await smallCapsLayout(host);
      // Capitals and small capitals: Word draws full size capitals.
      assert.deepEqual(layout["4"].spans, [], "a run in capitals and small capitals gets no small letters");
      // 80% to the nearest half point: 11.5, 8, 9, 12 and 14 pt runs.
      [["1", 9], ["5", 6.5], ["6", 7], ["7", 9.5], ["8", 11]].forEach(([id, size]) => {
        layout[id].spans.forEach((span) => {
          assert.ok(Math.abs(span.size - size) < 0.01, `Sc${id} "${span.text}" is ${span.size} pt; Word's is ${size} pt`);
        });
      });
      assert.match(layout["9"].innerText, /^Sc9 STRAUßE MAß LEDGER Sc$/, "ß stays ß");
      // A heading at an exact 12 pt line: as tall as Word's line, and the
      // next paragraph's first line 15.72 pt below its own, as in Word.
      assert.ok(Math.abs(layout["13"].height - 12) <= 0.1, `the heading is ${layout["13"].height} pt tall; Word's line is 12 pt`);
      const pitch = layout["14"].first - layout["13"].first;
      assert.ok(Math.abs(pitch - 15.72) <= 0.3, `the next paragraph starts ${pitch} pt below the heading; Word's 15.72 pt`);
      if (process.platform === "win32") {
        [["4", 345.19], ["5", 261.65], ["6", 279.05], ["7", 351.43], ["8", 396.31], ["9", 182.06]].forEach(([id, word]) => {
          assert.ok(Math.abs(layout[id].closing - word) <= 2, `Sc${id} closes at ${layout[id].closing} pt; Word's at ${word} pt`);
        });
      }
    });
  });

  test("a contents line whose right stop is past the right indent stays on one line", async () => {
    await withHost({}, async (host) => {
      const layout = await numberedLayout(host);
      assert.equal(layout.contentsLines, 1, `the contents line takes ${layout.contentsLines} lines; Word's takes one`);
    });
  });

  test("a page number prints in its field code's size unless the field keeps its result's format", async () => {
    await withHost({}, async (host) => {
      const layout = await numberedLayout(host);
      assert.equal(layout.numbers.FOOTER && layout.numbers.FOOTER.text, "1");
      assert.ok(Math.abs(layout.numbers.FOOTER.size - 10) <= 0.1, `the footer's number is ${layout.numbers.FOOTER.size} pt; Word prints it at 10 pt`);
      assert.equal(layout.numbers.HEADER && layout.numbers.HEADER.text, "1");
      assert.ok(Math.abs(layout.numbers.HEADER.size - 7) <= 0.1, `the header's number is ${layout.numbers.HEADER.size} pt; Word prints it at 7 pt`);
    });
  });

  // A document of more than 60 sections opens in batches, and its first
  // pages were measured while the reader pane was still hidden: every
  // paragraph measured 0 wide, no tab got a width, and a contents page lost
  // its dot leaders and right-aligned page numbers. Word's PDF of the same
  // file (71 pages): the leaders run from 436.03 to 511.6 pt and "12" ends at
  // 522.16 pt, on the 450 pt stop.
  test("a contents tab is sized in a document long enough to open in batches", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeNumberedDocx({ morePages: 70 });
      await host.openDocument({ bytes, report, fileName: "numbered-long.docx" });
      const line = await host.page.evaluate(() => {
        const page = document.querySelector("#docBody .docx-wrapper > section.docx");
        const box = page.getBoundingClientRect();
        const points = (value) => value / (box.width / page.offsetWidth) * 0.75;
        const contents = Array.from(page.querySelectorAll("p")).find((p) => p.textContent.includes("Contents line heron"));
        const tab = contents.querySelector(".ld-tab");
        const walker = document.createTreeWalker(contents, NodeFilter.SHOW_TEXT);
        let node;
        let number = null;
        while ((node = walker.nextNode())) {
          if (node.nodeValue.trim() === "12") {
            number = node;
          }
        }
        const range = document.createRange();
        range.selectNodeContents(number);
        return { tab: tab ? points(tab.getBoundingClientRect().width) : 0, end: points(range.getBoundingClientRect().right - box.left) };
      });
      assert.ok(line.tab > 60, `the contents tab is ${line.tab} pt wide; Word's leaders run 75.6 pt`);
      assert.ok(Math.abs(line.end - 522.16) <= 1.5, `"12" ends at ${line.end} pt; Word's ends at 522.16 pt`);
    });
  });

  // A paragraph of a list style that cancels the style's numbering (w:numId
  // 0) loses the style's indents in Word, and its leading tab goes to the
  // 14.4 pt stop. Word 16 (COM) starts the text of "Cancelled tabbed" at
  // 14.4 pt from the margin, "Cancelled plain" at 0, and "Body tabbed" (the
  // style below, which keeps its 14.4 pt first line) at 36 pt, and
  // "Cancelled indented", whose list style's base indents 36 pt, at 0.
  // Where each paragraph's text starts on the first page, in points from
  // the left margin, by its first two words.
  async function textStarts(host) {
    return host.page.evaluate(() => {
        const page = document.querySelector("#docBody .docx-wrapper > section.docx");
        const article = page.querySelector("article");
        const box = page.getBoundingClientRect();
        const scale = box.width / page.offsetWidth;
        const margin = article.getBoundingClientRect().left + parseFloat(getComputedStyle(article).paddingLeft) * scale;
        const result = {};
        article.querySelectorAll("p").forEach((p) => {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const at = node.nodeValue.search(/\S/);
            if (at < 0 || node.parentElement.closest(".ld-tab")) {
              continue;
            }
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + 1);
            const name = node.nodeValue.trim().split(" ").slice(0, 2).join(" ");
            result[name] = (range.getClientRects()[0].left - margin) / scale * 0.75;
            return;
          }
        });
        return result;
    });
  }

  // Word 16, COM, on these fixtures (the transitional and the Strict file
  // give the same positions).
  const CANCELLED_WORD_STARTS = { "Cancelled tabbed": 14.4, "Cancelled plain": 0, "Body tabbed": 36.3,
    "Cancelled indented": 0, "Cancelled own": 36.3 };

  test("a paragraph that cancels its style's numbering starts where Word's does", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeCancelledNumberingDocx();
      await host.openDocument({ bytes, report, fileName: "cancelled-numbering.docx" });
      const starts = await textStarts(host);
      Object.keys(CANCELLED_WORD_STARTS).forEach((name) => {
        const word = CANCELLED_WORD_STARTS[name];
        assert.ok(Math.abs(starts[name] - word) <= 1, `"${name}" starts at ${starts[name]} pt; Word's at ${word} pt`);
      });
    });
  });

  // docx-preview reads only the transitional namespaces: a Strict document
  // lost its styles part, numbering and every paragraph property, and its
  // tabbed paragraphs went to the 36 pt default stop. Its body paragraphs
  // also lost the style's 14.4 pt first line.
  test("a Strict OOXML document keeps its styles, indents and tab stops", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeCancelledNumberingDocx({ strict: true });
      await host.openDocument({ bytes, report, fileName: "cancelled-numbering-strict.docx" });
      const starts = await textStarts(host);
      Object.keys(CANCELLED_WORD_STARTS).forEach((name) => {
        const word = CANCELLED_WORD_STARTS[name];
        assert.ok(Math.abs(starts[name] - word) <= 1, `"${name}" starts at ${starts[name]} pt; Word's at ${word} pt`);
      });
      const listed = await host.page.evaluate(() => {
        const item = Array.from(document.querySelectorAll("#docBody article p")).find((p) => /Listed item/.test(p.textContent));
        return item ? { numbered: /\bdocx-num-/.test(item.className), align: getComputedStyle(item).textAlign } : null;
      });
      assert.ok(listed && listed.numbered, "the listed item is numbered");
      assert.equal(listed.align, "justify");
    });
  });

  // A page that starts inside a word: the line before the break ended at an
  // optional hyphen, which Chrome prints only where a line breaks. Split
  // there, the page's last line ended "...revol" with no hyphen and the next
  // page started "ution...". Word prints the hyphen.
  test("a word broken across pages keeps its hyphen", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeSoftHyphenDocx();
      await host.openDocument({ bytes, report, fileName: "soft-hyphens.docx" });
      const splits = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody p[data-ld-continued]")).map((rest) => {
        const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
        const page = rest.closest("section.docx");
        const before = pages[pages.indexOf(page) - 1];
        const kept = before ? Array.from(before.querySelectorAll("article p")).pop() : null;
        const keptText = kept ? kept.textContent : "";
        const after = getComputedStyle(kept, "::after").content;
        return {
          inWord: /[a-z­]$/i.test(keptText) && /^[a-z]/i.test(rest.textContent),
          hyphen: /-|‐/.test(after) || /-$/.test(keptText.replace(/­$/, ""))
        };
      }));
      const inWord = splits.filter((split) => split.inWord);
      assert.ok(inWord.length > 0, `a page starts inside a word (${splits.length} splits)`);
      inWord.forEach((split, index) => assert.ok(split.hyphen, `split ${index + 1} inside a word shows no hyphen`));
    });
  });

  // A page's first part of a paragraph can be split again when its kept
  // lines wrap differently once split (a justified paragraph in columns).
  // The hyphen belongs to where each part now ends: the first split's
  // hyphen stayed on the part that was split again, so a page ending
  // between two words printed one ("following-"), and the new middle part,
  // which ends inside the word, printed none.
  test("a paragraph split twice keeps a hyphen only where a part ends inside a word", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeSoftHyphenDocx({ columns: true });
      await host.openDocument({ bytes, report, fileName: "soft-hyphens-columns.docx" });
      const splits = await host.page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("#docBody article p"));
        return all.map((rest, index) => {
          if (!rest.hasAttribute("data-ld-continued") || index === 0) {
            return null;
          }
          const kept = all[index - 1];
          return {
            inWord: /[a-z­]$/i.test(kept.textContent) && /^[a-z]/i.test(rest.textContent),
            hyphen: kept.hasAttribute("data-ld-hyphen") && /-/.test(getComputedStyle(kept, "::after").content),
            ends: kept.textContent.slice(-12)
          };
        }).filter(Boolean);
      });
      assert.ok(splits.some((split) => split.inWord), `a page starts inside a word (${splits.length} splits)`);
      assert.ok(splits.some((split) => !split.inWord), `a page starts between words (${splits.length} splits)`);
      splits.forEach((split, index) => assert.equal(split.hyphen, split.inWord,
        `split ${index + 1} (ends "${split.ends}") ${split.inWord ? "inside a word shows no" : "between words shows a"} hyphen`));
    });
  });

  // Lines joined by line breaks: one paragraph of 79 lines that crosses a
  // page. Word's PDF of the fixture: page 1 ends with "Row 56", page 2
  // starts with "Row 57", every line whole. The split fell between the
  // last letter of one line and the first of the next, which read as a word
  // broken in two (range text leaves the <br> out); its hyphen took a line
  // of its own and pushed "Row 56" past the page's right edge, out of view.
  for (const justified of [false, true]) {
    test(`a page break between lines joined by line breaks adds no hyphen and loses no line${justified ? " (justified)" : ""}`, async () => {
      await withHost({}, async (host) => {
        const { bytes, report } = await makeBreakLinesDocx({ justified });
        await host.openDocument({ bytes, report, fileName: "break-lines.docx" });
        const layout = await host.page.evaluate(() => {
          const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
          const rows = [];
          pages.forEach((page, index) => {
            const box = page.getBoundingClientRect();
            const walker = document.createTreeWalker(page.querySelector("article"), NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              const match = /Row (\d+)/.exec(node.nodeValue);
              if (!match) {
                continue;
              }
              const range = document.createRange();
              range.selectNodeContents(node);
              const inside = Array.from(range.getClientRects()).every((rect) =>
                rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 && rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5);
              rows.push({ row: Number(match[1]), page: index + 1, inside });
            }
          });
          const second = pages[1] && pages[1].querySelector("article");
          return { rows, hyphens: document.querySelectorAll("#docBody p[data-ld-hyphen]").length,
            secondPage: second ? second.textContent.trim() : "" };
        });
        assert.equal(layout.hyphens, 0, "no part is marked for a hyphen");
        assert.deepEqual(layout.rows.map((entry) => entry.row), Array.from({ length: 79 }, (_, index) => index + 1));
        layout.rows.forEach((entry) => assert.ok(entry.inside, `"Row ${entry.row}" is drawn outside page ${entry.page}`));
        const last = layout.rows.filter((entry) => entry.page === 1).pop();
        assert.equal(last && last.row, 56, `page 1 ends with "Row ${last && last.row}"; Word's ends with "Row 56"`);
        assert.match(layout.secondPage, /^Row 57 closes on a plain word/, `page 2 starts with "${layout.secondPage.slice(0, 30)}"`);
      });
    });
  }

  // The first letter after a line broken at a hyphenation point also
  // returns, first, the box of the hyphen at the end of the line before;
  // read from that box, the page split fell one letter late, after the
  // soft hyphen ("counterr-" | "evolution"). A page breaks a word where its
  // line broke: right after a soft hyphen.
  test("a word broken across pages breaks at its soft hyphen", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeSoftHyphenDocx();
      await host.openDocument({ bytes, report, fileName: "soft-hyphens.docx" });
      const splits = await host.page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("#docBody article p"));
        return all.map((rest, index) => {
          if (!rest.hasAttribute("data-ld-continued") || index === 0) {
            return null;
          }
          const kept = all[index - 1].textContent;
          return { inWord: /[a-z­]$/i.test(kept) && /^[a-z]/i.test(rest.textContent), soft: /­$/.test(kept), at: kept.slice(-8) + "|" + rest.textContent.slice(0, 8) };
        }).filter(Boolean);
      });
      const inWord = splits.filter((split) => split.inWord);
      assert.ok(inWord.length > 0, `a page starts inside a word (${splits.length} splits)`);
      inWord.forEach((split) => assert.ok(split.soft, `the page breaks a word after a letter, not its soft hyphen ("${split.at}")`));
    });
  });

  // A line also breaks after a hard hyphen. A page that starts there keeps
  // the word's parts where its line put them, and adds no hyphen of its own.
  test("a page that starts after a hard hyphen keeps the line's break", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeSoftHyphenDocx({ hard: true });
      await host.openDocument({ bytes, report, fileName: "hard-hyphens.docx" });
      const splits = await host.page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("#docBody article p"));
        return all.map((rest, index) => {
          if (!rest.hasAttribute("data-ld-continued") || index === 0) {
            return null;
          }
          const kept = all[index - 1];
          return { afterHyphen: /-$/.test(kept.textContent), marked: kept.hasAttribute("data-ld-hyphen"),
            at: kept.textContent.slice(-8) + "|" + rest.textContent.slice(0, 8) };
        }).filter(Boolean);
      });
      const after = splits.filter((split) => split.afterHyphen);
      assert.ok(after.length > 0, `a page starts after a hard hyphen (${splits.map((split) => split.at).join(", ")})`);
      splits.forEach((split) => assert.ok(!split.marked, `the part before "${split.at}" is marked for a hyphen`));
    });
  });

  // A part that ends inside a word ends with a hyphen, which can be wider
  // than the one its line was laid out with (it takes the paragraph's
  // size). On a line with no room for it, it pushed the last letters onto
  // a line of their own past the page; it takes no room there instead.
  test("a hyphen added at the foot of a page keeps the page's last line in place", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeTightHyphenDocx();
      await host.openDocument({ bytes, report, fileName: "tight-hyphen.docx" });
      // Where each of a page's last three letters is drawn: inside the page,
      // on the text area's last line (exact 6 pt lines: within 12 px of the
      // area's foot).
      const parts = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).map((page) => {
        const box = page.getBoundingClientRect();
        const style = getComputedStyle(page);
        const limit = box.top + parseFloat(style.minHeight) - parseFloat(style.paddingBottom);
        const paragraphs = page.querySelectorAll("article p");
        const kept = paragraphs[paragraphs.length - 1];
        const walker = document.createTreeWalker(kept, NodeFilter.SHOW_TEXT);
        let node;
        let last = null;
        while ((node = walker.nextNode())) {
          last = node;
        }
        const letters = [];
        for (let offset = last.nodeValue.length - 1; offset >= 0 && letters.length < 3; offset -= 1) {
          if (last.nodeValue[offset] !== "i") {
            continue;
          }
          const range = document.createRange();
          range.setStart(last, offset);
          range.setEnd(last, offset + 1);
          const rects = range.getClientRects();
          const rect = rects[rects.length - 1];
          letters.push(rect.left >= box.left && rect.right <= box.right && rect.bottom <= limit + 0.5 && rect.bottom > limit - 12);
        }
        return { hyphen: kept.hasAttribute("data-ld-hyphen") && /-/.test(getComputedStyle(kept, "::after").content), letters };
      }));
      const hyphenated = parts.filter((part) => part.hyphen);
      assert.ok(hyphenated.length > 0, `a page ends inside the word with a hyphen (${parts.length} pages)`);
      hyphenated.forEach((part, index) => assert.deepEqual(part.letters, [true, true, true],
        `page ${index + 1}'s last letters are not all on its last line`));
    });
  });

  // A document that leaves automatic hyphenation off, whose paragraphs run
  // 144 pt past the right margin (a negative right indent). The page split
  // fell at the first letter past the text area's right edge, inside a
  // word, and the part kept took a hyphen ("led-" | "ger"). Word breaks no
  // word there; the whole word goes on to the next page.
  // The same paragraphs holding numbers, in a document that hyphenates:
  // Chrome hyphenates no number, so a split between two digits takes no
  // hyphen, and the number goes on to the next page whole. And the same
  // words with each letter a run of its own: the word that moves on starts
  // some runs back.
  for (const [name, options] of [
    ["a document without automatic hyphenation breaks no word across pages", {}],
    ["a number is not broken across pages, in a document that hyphenates", { numbers: true }],
    ["a word made of many runs is not broken across pages", { runs: true }]
  ]) {
  test(name, async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeWideLinesDocx(options);
      await host.openDocument({ bytes, report, fileName: "wide-lines.docx" });
      const splits = await host.page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("#docBody article p"));
        return all.map((rest, index) => {
          if (!rest.hasAttribute("data-ld-continued") || index === 0) {
            return null;
          }
          const kept = all[index - 1];
          return {
            inWord: /[a-z0-9]$/i.test(kept.textContent) && /^[a-z0-9]/i.test(rest.textContent),
            hyphen: kept.hasAttribute("data-ld-hyphen"),
            at: kept.textContent.slice(-8) + "|" + rest.textContent.slice(0, 8)
          };
        }).filter(Boolean);
      });
      assert.ok(splits.length > 0, "a paragraph is split across pages");
      splits.forEach((split) => {
        assert.ok(!split.inWord, `the page splits a word ("${split.at}")`);
        assert.ok(!split.hyphen, `the part before "${split.at}" is marked for a hyphen`);
      });
    });
  });
  }

  // A footnote reference that says a mark of the author's own follows, with
  // no mark after it, whose note starts with the note's own reference mark
  // (w:footnoteRef). Word's PDF: no mark at the reference, and the note
  // starts with its number, 1.
  test("a note whose own mark is empty keeps its number in the note", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeEmptyMarkNoteDocx();
      await host.openDocument({ bytes, report, fileName: "empty-mark-note.docx" });
      const marks = await host.page.evaluate(() => {
        const visible = (node) => node && getComputedStyle(node).display !== "none" && node.getClientRects().length > 0;
        const lead = Array.from(document.querySelectorAll("#docBody article p")).find((p) => p.textContent.includes("Summary heron"));
        const note = Array.from(document.querySelectorAll("#docBody li")).find((li) => li.textContent.includes("Note heron"));
        return {
          shownNumbers: Array.from(lead.querySelectorAll("sup")).filter(visible).map((sup) => sup.textContent),
          marker: note ? getComputedStyle(note).listStyleType : null
        };
      });
      assert.deepEqual(marks.shownNumbers, [], "no mark at the reference");
      assert.notEqual(marks.marker, "none", "the note shows its number");
    });
  });

  // A header whose right indent reaches 36 pt past the paper's edge: Word's
  // PDF of it has no page number. The reader showed the number beside the
  // page.
  test("nothing past the paper's edge is shown", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeNumberedDocx({ offPage: true });
      await host.openDocument({ bytes, report, fileName: "numbered-off.docx" });
      const seen = await host.page.evaluate(() => {
        const page = document.querySelector("#docBody .docx-wrapper > section.docx");
        const header = Array.from(page.children).find((child) => child.nodeName === "HEADER");
        const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (/\d/.test(node.nodeValue)) {
            break;
          }
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        node.parentElement.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = range.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { past: rect.left - page.getBoundingClientRect().right, shown: !!hit && header.contains(hit) };
      });
      assert.ok(seen.past > 0, `the number starts ${seen.past}px past the page's right edge`);
      assert.equal(seen.shown, false, "the number past the page's edge is not shown");
    });
  });
});

// The reader splits pages at 100% and gives each section of a split page
// the height it was measured at. Drawn at another zoom, lines and table
// rows can take a little more room; what no longer fits went to a column
// beside the section, past the page's edge, where the page clips it. In
// 0.3.2 rows 35 to 60 of the long table never showed at 90%, and at 110% the
// last two lines of the two-margin sections lay past the page.
describe("text stays on its page at any zoom", () => {
  const ZOOMS = [90, 80, 75, 67, 50, 110, 150];
  const documents = {
    "wide-tables.docx": () => makeTablesDocx(),
    "margin-sections.docx": () => makeMarginSectionsDocx(),
    "figure-section.docx": () => makeFigureSectionDocx({ extra: 2 }),
    "two-column-floats.docx": () => makeFloatsDocx()
  };

  async function zoomTo(host, target) {
    for (let guard = 0; guard < 20; guard += 1) {
      const zoom = await host.page.evaluate(() => Number(document.documentElement.dataset.zoom));
      if (zoom === target) {
        return;
      }
      await host.page.click(zoom > target ? "#zoomOut" : "#zoomIn");
      await zoomSettled(host);
    }
    assert.fail(`zoom did not reach ${target}%`);
  }

  // Evaluated in the page: each page is scrolled into view and drawn, then
  // every block that lies in a column past its section's right edge is
  // listed, with how far down it reaches in the section's own pixels, and
  // each table row with whether it is inside its page's box.
  function measure() {
    return (async () => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const pages = Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx"));
      const past = [];
      const rows = [];
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        page.scrollIntoView({ block: "start" });
        // The reader looks at a page with a section of fixed height two
        // frames after it comes on screen, and marks it (__ldKept).
        const fixed = Array.from(page.children).some((node) => node.nodeName === "ARTICLE" && node.style.height);
        const zoomed = document.documentElement.dataset.zoom !== "100";
        for (let wait = 0; wait < 60 && fixed && zoomed && !page.__ldKept; wait += 1) {
          await frame();
        }
        await frame();
        const pageBox = page.getBoundingClientRect();
        Array.from(page.children).filter((node) => node.nodeName === "ARTICLE").forEach((article, section) => {
          const box = article.getBoundingClientRect();
          for (const node of article.children) {
            const outside = Array.from(node.getClientRects()).filter((rect) => rect.width > 0 && rect.left >= box.right - 0.5);
            if (outside.length) {
              past.push(`page ${index + 1}, section ${section + 1}: "${(node.textContent || "").trim().slice(0, 40)}"`);
            }
          }
        });
        page.querySelectorAll("tr").forEach((row) => {
          const box = row.getBoundingClientRect();
          rows.push({ text: (row.cells[0]?.textContent || "").trim(), inside: box.left < pageBox.right - 0.5 && box.bottom <= pageBox.bottom + 0.5 });
        });
      }
      document.getElementById("docScroller").scrollTop = 0;
      return { pages: pages.length, past, rows };
    })();
  }

  for (const [file, make] of Object.entries(documents)) {
    test(`${file}: nothing lies past a page's edge at ${ZOOMS.join(", ")}%`, async () => {
      await withHost({ viewport: { width: 1280, height: 860 } }, async (host) => {
        const { bytes, report } = await make();
        await host.openDocument({ bytes, report, fileName: file });
        for (const zoom of ZOOMS) {
          await zoomTo(host, zoom);
          const seen = await host.page.evaluate(measure);
          assert.deepEqual(seen.past, [], `${file} at ${zoom}%: blocks past the page's edge`);
          const hidden = seen.rows.filter((row) => !row.inside).map((row) => row.text);
          assert.deepEqual(hidden, [], `${file} at ${zoom}%: table rows outside their page`);
        }
      });
    });
  }

  // Every row of the long table shows at each zoom: rows 1 to 90 in order.
  test("wide-tables.docx: every row of the long table is on a page at each zoom", async () => {
    await withHost({ viewport: { width: 1280, height: 860 } }, async (host) => {
      const { bytes, report, longRows } = await makeTablesDocx();
      await host.openDocument({ bytes, report, fileName: "wide-tables.docx" });
      const expected = Array.from({ length: longRows }, (_, index) => `Row ${index + 1}`);
      for (const zoom of [100, ...ZOOMS]) {
        await zoomTo(host, zoom);
        const seen = await host.page.evaluate(measure);
        const shown = seen.rows.filter((row) => row.inside && /^Row \d+$/.test(row.text)).map((row) => row.text);
        assert.deepEqual(shown, expected, `wide-tables.docx at ${zoom}%: rows shown`);
      }
    });
  });

  // A window narrow enough that the page fits at 80%: the zoom the reader
  // picks itself, not one stepped to.
  test("margin-sections.docx: nothing lies past a page's edge at the fit zoom of a narrow window", async () => {
    await withHost({ viewport: { width: 720, height: 860 } }, async (host) => {
      const { bytes, report } = await makeMarginSectionsDocx();
      await host.openDocument({ bytes, report, fileName: "margin-sections.docx" });
      const zoom = await host.page.evaluate(() => Number(document.documentElement.dataset.zoom));
      assert.ok(zoom < 100, `the window fits the page below 100% (${zoom}%)`);
      const seen = await host.page.evaluate(measure);
      assert.deepEqual(seen.past, [], `margin-sections.docx at the fit zoom ${zoom}%: blocks past the page's edge`);
    });
  });

  // The observer reports each page that comes on screen, and the page on
  // screen when the zoom changes. Here no scroll event reaches the reader,
  // so the observer alone looks at the pages.
  test("pages are looked at by the observer when no scroll event arrives", async () => {
    const noScrollEvents = `window.addEventListener("scroll", (event) => event.stopImmediatePropagation(), true);`;
    await withHost({ viewport: { width: 1280, height: 860 }, initScript: noScrollEvents }, async (host) => {
      for (const [file, make] of Object.entries(documents)) {
        const { bytes, report } = await make();
        await host.openDocument({ bytes, report, fileName: file });
        for (const zoom of [90, 80, 110]) {
          await zoomTo(host, zoom);
          const seen = await host.page.evaluate(measure);
          assert.deepEqual(seen.past, [], `${file} at ${zoom}% with no scroll events: blocks past the page's edge`);
        }
        await zoomTo(host, 100);
      }
    });
  });

  // An observer can miss a page scrolled to at once; a scroll looks at the
  // waiting pages in the window too. Here the observer never reports.
  test("pages are looked at on scroll when the observer reports nothing", async () => {
    const silentObserver = `window.IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    };`;
    await withHost({ viewport: { width: 1280, height: 860 }, initScript: silentObserver }, async (host) => {
      for (const [file, make] of Object.entries(documents)) {
        const { bytes, report } = await make();
        await host.openDocument({ bytes, report, fileName: file });
        for (const zoom of [90, 80, 110]) {
          await zoomTo(host, zoom);
          await host.page.evaluate(() => {
            const scroller = document.getElementById("docScroller");
            scroller.scrollTop = scroller.scrollHeight;
          });
          const seen = await host.page.evaluate(measure);
          assert.deepEqual(seen.past, [], `${file} at ${zoom}% with a silent observer: blocks past the page's edge`);
        }
        await zoomTo(host, 100);
      }
    });
  });

  // At 100% the pages are as 0.3.2 laid them out: each page 1056 px (11 in)
  // high, and each section of a split page at the height it was measured
  // at ("" for a section that kept its own height). The same when the
  // document opens and after zooming through 50% to 150% and back. The
  // first page of two-column-floats.docx is 1 px taller than 0.3.2's: its
  // 8 pt footnote no longer takes the 10 pt minimum height of Normal's runs.
  const AT_100 = {
    "wide-tables.docx": [["888px"], [""]],
    "margin-sections.docx": [["", "720px"], ["816px"], ["816px"]],
    "figure-section.docx": [["864px"], ["", "", "336px"]],
    "two-column-floats.docx": [["", "830px"], ["805px"], ["866px"], ["921px"]]
  };

  test("the pages at 100% are 0.3.2's, when a document opens and after zooming out and back", async () => {
    await withHost({ viewport: { width: 1280, height: 860 } }, async (host) => {
      // Five frames on, so that a page the reader looked at would show it
      // (__ldKept): at 100% no page is looked at.
      const snapshot = () => host.page.evaluate(async () => {
        for (let wait = 0; wait < 5; wait += 1) {
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        }
        return Array.from(document.querySelectorAll("#docBody .docx-wrapper > section.docx")).map((page) => ({
          height: page.offsetHeight,
          sections: Array.from(page.children).filter((node) => node.nodeName === "ARTICLE").map((article) => article.style.height),
          lookedAt: !!page.__ldKept
        }));
      });
      for (const [file, make] of Object.entries(documents)) {
        const expected = AT_100[file].map((sections) => ({ height: 1056, sections, lookedAt: false }));
        const { bytes, report } = await make();
        await host.openDocument({ bytes, report, fileName: file });
        assert.equal(await host.page.evaluate(() => document.documentElement.dataset.zoom), "100");
        assert.deepEqual(await snapshot(), expected, `${file}: the pages at 100% when it opens`);
        // The documents open one after another in the same window: each new
        // one is looked at, not the pages of the one before.
        for (const zoom of ZOOMS) {
          await zoomTo(host, zoom);
          const seen = await host.page.evaluate(measure);
          assert.deepEqual(seen.past, [], `${file} at ${zoom}%: blocks past the page's edge`);
        }
        await zoomTo(host, 100);
        assert.deepEqual(await snapshot(), expected, `${file}: the pages at 100% after zooming to 50% and 150% and back`);
      }
    });
  });
});

// Fonts, pictures, and text boxes Word sets apart from docx-preview's CSS:
// tests/reader/make-fonts-boxes-docx.mjs.
describe("fonts, pictures, and text boxes take the space Word gives them", () => {
  async function open(host, part) {
    const { bytes, report } = await makeFontsBoxesDocx(part);
    await host.openDocument({ bytes, report, fileName: `${part}.docx` });
  }

  function near(actual, expected, tolerance, label) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} px, expected ${expected} px`);
  }

  // Consolas advances 1126/2048 em per character. Its stand-ins (DejaVu Sans
  // Mono, Liberation Mono) advance 0.6 em, 9.5% more, and code lines that
  // fit Word's line wrapped. Where Consolas is installed it draws itself.
  test("text in Consolas advances as Consolas does, in whatever font draws it", async () => {
    await withHost({}, async (host) => {
      await open(host, "mono");
      const result = await host.page.evaluate((text) => {
        const span = Array.from(document.querySelectorAll("#docBody span")).find((node) => node.textContent === text);
        const range = document.createRange();
        range.selectNodeContents(span);
        return { width: range.getBoundingClientRect().width, size: parseFloat(getComputedStyle(span).fontSize), length: text.length };
      }, MONO_TEXT);
      const advance = result.width / result.length / result.size;
      assert.ok(Math.abs(advance - 1126 / 2048) <= 0.003, `each character advances ${advance} em; Consolas advances ${1126 / 2048} em`);
    });
  });

  // A paragraph of Calibri 11 pt at 1.15 that holds only a picture 90 pt
  // tall. CSS set the picture on the baseline and added the font's descent
  // and half its leading below it, 5.6 px.
  test("a line that holds only a picture is as tall as the picture", async () => {
    await withHost({}, async (host) => {
      await open(host, "picture");
      const height = await host.page.evaluate(() => document.querySelector("#docBody img").closest("p").getBoundingClientRect().height);
      near(height, 90 * 4 / 3, 0.5, "the picture's paragraph");
    });
  });

  // The empty line of a code listing whose mark is 8 pt Consolas is one
  // 8 pt Consolas line (Word's single line for Consolas is 1.1701 em, 12.48
  // px), not a line of the style's 11 pt Calibri (17.9 px).
  test("an empty paragraph is a line of its mark's font", async () => {
    await withHost({}, async (host) => {
      await open(host, "empty");
      const heights = await host.page.evaluate(() => Array.from(document.querySelectorAll("#docBody article p"))
        .map((p) => p.getBoundingClientRect().height));
      assert.equal(heights.length, 3, "three paragraphs");
      near(heights[1], 8 * 1.1701 * 4 / 3, 0.5, "the empty paragraph");
    });
  });

  // A text box wrapped square that spans the column leaves no room beside
  // it, so Word sets the next paragraph below it: 10 pt below its anchor's
  // top and 150 pt tall. The box had taken no space and the paragraph after
  // it printed under the box's text.
  test("a box wrapped square as wide as the column pushes the text after it below it", async () => {
    await withHost({}, async (host) => {
      await open(host, "box");
      const result = await host.page.evaluate(() => {
        const article = document.querySelector("#docBody article");
        const after = Array.from(article.querySelectorAll("p")).find((p) => p.textContent.includes("After the box lynx."));
        const box = Array.from(document.querySelectorAll("#docBody *")).find((node) => node.textContent.includes("Calendar box heron.") &&
          !Array.from(node.children).some((child) => child.textContent.includes("Calendar box heron.")) && node.closest("p")).closest(".ld-float, svg, div");
        const top = article.getBoundingClientRect().top;
        return { after: after.getBoundingClientRect().top - top, boxBottom: box.getBoundingClientRect().bottom - top };
      });
      assert.ok(result.after >= 150 * 4 / 3 - 1, `the paragraph after the box starts ${result.after} px below the text's top; the box is 200 px tall`);
      assert.ok(result.after >= result.boxBottom - 1, `the paragraph after the box starts at ${result.after} px, inside the box (ends at ${result.boxBottom} px)`);
    });
  });

  // Word sets a run marked w:rtl in the complex-script font and size of its
  // style (w:rFonts/@w:cs, w:szCs): Traditional Arabic at 15 pt here. The
  // Arabic text took the style's 11 pt Times New Roman.
  test("a right-to-left run takes the complex-script font and size", async () => {
    await withHost({}, async (host) => {
      await open(host, "complex");
      const runs = await host.page.evaluate(([arabic, latin]) => {
        const style = (text) => {
          const span = Array.from(document.querySelectorAll("#docBody span")).find((node) => node.textContent.trim() === text);
          const computed = getComputedStyle(span);
          return { size: parseFloat(computed.fontSize), family: computed.fontFamily.split(",")[0].replace(/["']/g, "").trim() };
        };
        return { arabic: style(arabic), latin: style(latin) };
      }, [ARABIC_TEXT, LATIN_TEXT]);
      near(runs.arabic.size, 20, 0.1, "the Arabic run's size");
      assert.equal(runs.arabic.family, "Traditional Arabic");
      near(runs.latin.size, 11 * 4 / 3, 0.1, "the Latin run's size");
      assert.equal(runs.latin.family, "Times New Roman");
    });
  });

  // Word spaces paragraphs with HTML auto spacing 14 pt apart and ignores
  // the 5 pt in w:before and w:after; the reader spaced them 5 pt apart.
  test("paragraphs with HTML auto spacing are 14 pt apart", async () => {
    await withHost({}, async (host) => {
      await open(host, "auto");
      const gaps = await host.page.evaluate(() => {
        const paragraphs = Array.from(document.querySelectorAll("#docBody article p"));
        const box = (text) => paragraphs.find((p) => p.textContent.includes(text)).getBoundingClientRect();
        return [box("Auto two").top - box("Auto one").bottom, box("Auto three").top - box("Auto two").bottom];
      });
      gaps.forEach((gap, index) => near(gap, 14 * 4 / 3, 0.5, `gap ${index + 1}`));
    });
  });
});


describe("table rows at the foot of a page", () => {
  // A row whose text fits the page but whose space after its last paragraph
  // does not was moved by the browser into a column beside the page, where
  // nothing could be seen.
  test("a row that fits except for its trailing space stays visible", async () => {
    await withHost({}, async (host) => {
      const { bytes, report } = await makeTableEdgeDocx();
      await host.openDocument({ bytes, report, fileName: "table-edge.docx" });
      const hidden = await host.page.evaluate(() => {
        document.querySelectorAll("section.docx.ld-lazy").forEach((page) => page.classList.remove("ld-lazy"));
        const found = [];
        document.querySelectorAll("#docBody section.docx > article").forEach((article) => {
          const box = article.getBoundingClientRect();
          article.querySelectorAll("p").forEach((paragraph) => {
            if (paragraph.getBoundingClientRect().left >= box.right - 0.5) {
              found.push(paragraph.textContent);
            }
          });
        });
        return found;
      });
      assert.deepEqual(hidden, [], "no paragraph lies in a column beside the page");
    });
  });
});

