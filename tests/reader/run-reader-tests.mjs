// Reader tests: the staged reader in Chromium with a fake host.
// Run: npm run test:reader (or node --test tests/reader/run-reader-tests.mjs)
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
import { makeColumnsDocx, makeDefaultLineDocx, makePageFlowDocx, makeSavedStartAfterBreakDocx, makeSpacedDocx, makeTablesDocx } from "./make-columns-docx.mjs";
import { lineText, makeSavedPagesDocx, makeWordMetricsDocx } from "./make-saved-pages-docx.mjs";

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
      // too and gives 23.
      assert.equal(rendered.pages, 23);
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
