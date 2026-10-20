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

async function findCount(host, query) {
  await host.page.fill("#findInput", query);
  return host.page.$eval("#findCount", (node) => node.textContent);
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

  test("theme cycles System, Light, Dark and posts setTheme; pages stay white", async () => {
    await withHost({ theme: "system", colorScheme: "dark" }, async (host) => {
      await openFixture(host, "headings.docx");
      assert.equal(await host.page.textContent("#themeButton"), "System");
      const seen = [];
      for (const expected of ["light", "dark", "system"]) {
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
        if (expected === "dark") {
          assert.notEqual(colors[2], "rgb(244, 242, 238)", "canvas darkens");
        }
      }
      assert.deepEqual(seen, ["light", "dark", "system"]);
      const keyed = host.waitFor((message) => message.type === "setTheme");
      await host.page.keyboard.press("Control+Shift+T");
      assert.equal((await keyed).theme, "light");
      await host.send({ type: "theme", theme: "dark", view: "page" });
      assert.equal(await host.page.textContent("#themeButton"), "Dark");
    });
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
      assert.ok(Math.abs(await pageWidth() - base * 0.5) < 2, "page shrinks to half");
      await host.page.click("#zoomValue");
      assert.equal(await host.page.getAttribute("html", "data-zoom-mode"), "fit");
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
      const large = await measure();
      assert.equal(await host.page.textContent("#zoomValue"), "150%");
      assert.ok(Math.abs(large.width - base.width * 1.5) < 2, "page is scaled");
      assert.ok(large.scrollWidth >= large.width, "the scaled page can be scrolled to");
      assert.ok(large.scrollHeight > base.scrollHeight * 1.4, "scroll height follows the scale");
      for (let index = 0; index < 8; index += 1) {
        await host.page.click("#zoomOut", { force: true }).catch(() => {});
      }
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
      await host.page.waitForTimeout(60);
      assert.equal(await host.page.getAttribute('#outlineList a[data-index="0"]', "aria-current"), "location");
      await host.page.click("#outlineToggle");
      assert.equal(await host.page.isVisible("#outlineList"), false);
      await host.page.click("#outlineToggle");
      assert.equal(await host.page.isVisible("#outlineList"), true);
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
      assert.equal(await host.page.textContent("#findCount"), "1/10");
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
          paragraphs: document.querySelectorAll("#docBody section.docx article > p").length,
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
      assert.equal(result.firstParagraphs, 1);
      assert.equal(result.finalMarkers, 1);
      const meta = await host.page.evaluate(() => {
        const node = document.querySelector("[data-ld-file-meta], #fileMeta, .file-meta");
        return node ? node.textContent : null;
      });
      assert.ok(meta && meta.includes(`${result.pages} pages`), `header shows the page count: ${meta}`);
    });
  });
});
