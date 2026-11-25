// The interface in Simplified Chinese and Japanese, in Chromium with the fake
// host: the system language picks it, reader.html?lang= paints it first, the
// settings panel switches it at once and asks the host to save it, and the
// longest strings fit (no clipped button, nothing outside the settings panel,
// CJK text drawn with a CJK font). Expected strings come from the tables in
// assets/fidelity.js, so the checks follow the translations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { FakeHost, launchBrowser, loadCases, networkAttempts, prepareFixture, repositoryRoot, stageAssets } from "./fake-host.mjs";

const require = createRequire(import.meta.url);
const Wording = require(path.join(repositoryRoot, "assets", "fidelity.js"));
const t = (language, key, values) => Wording.strings.text(language, key, values);
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

const FEATURES = [
  { code: "text-box", count: 2, notDisplayed: true, singular: "text box", plural: "text boxes" },
  { code: "smart-art", count: 1, notDisplayed: true, singular: "SmartArt graphic", plural: "SmartArt graphics" },
  { code: "tracked-changes", count: 3, notDisplayed: false, singular: "tracked change", plural: "tracked changes" },
  { code: "embedded-fonts", count: 2, notDisplayed: false, singular: "embedded font", plural: "embedded fonts" },
  { code: "remote-template", count: 1, notDisplayed: false, singular: "remote template", plural: "remote templates" }
];

async function withHost(options, body) {
  const host = await FakeHost.open(browser, assets, options);
  try {
    await body(host);
    assert.deepEqual(await host.cspViolations(), [], "no Content Security Policy violations");
    assert.deepEqual(host.offOrigin, [], "no request leaves the app origin");
    assert.deepEqual(host.notFound, [], "no request for a missing file");
    assert.deepEqual(host.consoleErrors, [], "no console errors");
    assert.deepEqual(networkAttempts, [], "the browser made no network attempt of its own");
  } finally {
    await host.close();
  }
}

async function openWithNotes(host) {
  const { bytes, report } = prepareFixture(fixtures, "headings.docx", { features: FEATURES });
  await host.send({ type: "tabs", tabs: [
    { id: 1, name: "headings.docx", path: "/docs/headings.docx" },
    { id: 2, name: "tables.docx", path: "/docs/tables.docx" }], active: 1 });
  await host.openDocument({ tab: 1, bytes, report, fileName: "headings.docx" });
  return report;
}

const chrome = (host) => host.page.evaluate(() => ({
  lang: document.documentElement.lang,
  documentLang: document.getElementById("docBody").lang,
  open: document.getElementById("openButton").textContent.trim(),
  openTitle: document.getElementById("openButton").title,
  find: document.getElementById("findInput").placeholder,
  page: document.getElementById("viewPage").textContent.trim(),
  theme: document.getElementById("themeLabel").textContent.trim(),
  themeTitle: document.getElementById("themeButton").title,
  settings: document.getElementById("settingsTitle").textContent.trim(),
  tagline: document.getElementById("fileMeta").textContent.trim(),
  emptyTitle: document.getElementById("stateTitle").textContent.trim(),
  languageGroupHidden: document.querySelector('input[name="settings-language"]').closest("fieldset").hidden
}));

test("the Language choice shows only when the host reports a language", async () => {
  await withHost({}, async (host) => {
    assert.equal((await chrome(host)).languageGroupHidden, true, "an older host: no choice that cannot be saved");
  });
  await withHost({ language: "system", systemLanguage: "en-US" }, async (host) => {
    const state = await chrome(host);
    assert.equal(state.languageGroupHidden, false, "the host saves a language: the choice shows");
    assert.equal(state.open, "Open", "an English system keeps English");
    assert.equal(state.lang, "en");
  });
  // As in LeanMark: there is no Traditional Chinese interface, so a
  // Traditional Chinese system keeps English and can still choose 简体中文.
  await withHost({ language: "system", systemLanguage: "zh-TW" }, async (host) => {
    const state = await chrome(host);
    assert.equal(state.open, "Open", "a zh-TW system keeps English");
    assert.equal(state.lang, "en");
  });
});

for (const [language, systemLanguage] of [["ja", "ja-JP"], ["zh-CN", "zh-SG"], ["zh-CN", "zh-Hans-CN"]]) {
  test(`a ${systemLanguage} system shows the interface in ${language}`, async () => {
    await withHost({ language: "system", systemLanguage }, async (host) => {
      let state = await chrome(host);
      assert.equal(state.lang, language, "the page language");
      assert.equal(state.open, t(language, "open.button"));
      assert.equal(state.openTitle, t(language, "open.title"));
      assert.equal(state.find, t(language, "find.placeholder"));
      assert.equal(state.page, t(language, "view.page"));
      assert.equal(state.theme, t(language, "theme.light"));
      assert.equal(state.themeTitle, t(language, "theme.buttonTitle", { name: t(language, "theme.light") }));
      assert.equal(state.settings, t(language, "settings.title"));
      assert.equal(state.tagline, t(language, "app.tagline"));
      assert.equal(state.emptyTitle, t(language, "empty.title"));

      const report = await openWithNotes(host);
      state = await chrome(host);
      assert.equal(state.documentLang, "en", "the document itself keeps the language it had before");
      const shown = await host.page.evaluate(() => ({
        fidelity: document.getElementById("fidelityText").textContent,
        details: document.getElementById("fidelityDetails").textContent,
        meta: document.getElementById("fileMeta").textContent,
        statuses: [...document.querySelectorAll("#fidelityList .feature-status")].map((node) => node.textContent),
        outline: document.getElementById("outlineLabel").textContent
      }));
      assert.equal(shown.fidelity, Wording.describeFidelity(report, language).text);
      assert.equal(shown.details, t(language, "fidelity.details"));
      assert.equal(shown.outline, t(language, "outline.title"));
      assert.ok(shown.meta.indexOf(t(language, "identity.pages", { count: 1 }).replace("1", "")) >= 0 ||
        shown.meta.indexOf(t(language, "identity.onePage")) >= 0, `the page count in ${language}: ${shown.meta}`);
      assert.deepEqual(shown.statuses, Wording.describeFidelity(report, language).items.map((item) => item.status));

      await host.send({ type: "status", message: "LeanDoc opens web and email links only.", tone: "warning" });
      assert.equal(await host.page.textContent("#statusToast"), t(language, "host.webAndEmailOnly"),
        "a host message is shown translated");
      await host.send({ type: "status", message: "Something a newer host says.", tone: "info" });
      assert.equal(await host.page.textContent("#statusToast"), "Something a newer host says.",
        "an unknown host message is shown as sent");

      await host.page.click("#settingsButton");
      const list = await host.page.evaluate(() => ({
        groups: [...document.querySelectorAll("#shortcutList h4")].map((node) => node.textContent),
        labels: [...document.querySelectorAll("#shortcutList dd")].map((node) => node.textContent)
      }));
      assert.equal(list.groups[0], t(language, "group.reader"));
      assert.ok(list.labels.indexOf(t(language, "shortcut.theme")) >= 0, "the shortcut list is translated");
      await screenshot(host, `language-${language}-${systemLanguage}-settings`);
    });
  });
}

test("reader.html?lang= paints the interface language before any host message", async () => {
  for (const language of ["ja", "zh-CN"]) {
    await withHost({ handshake: false, query: `?lang=${language}` }, async (host) => {
      const state = await chrome(host);
      assert.equal(state.lang, language);
      assert.equal(state.open, t(language, "open.button"));
      assert.equal(state.emptyTitle, t(language, "empty.title"));
      await screenshot(host, `language-${language}-start`);
    });
  }
  await withHost({ handshake: false, query: "?lang=fr" }, async (host) => {
    assert.equal((await chrome(host)).open, "Open", "an unknown language starts in English");
  });
});

test("the settings panel switches the language at once and asks the host to save it", async () => {
  await withHost({ language: "system", systemLanguage: "en-US" }, async (host) => {
    await openWithNotes(host);
    await host.page.click("#settingsButton");
    const saved = host.waitFor((message) => message.type === "setLanguage" && message.language === "ja");
    await host.page.check('input[name="settings-language"][value="ja"]');
    await saved;
    let state = await chrome(host);
    assert.equal(state.lang, "ja");
    assert.equal(state.open, t("ja", "open.button"), "the toolbar switched without a reload");
    assert.equal(state.settings, t("ja", "settings.title"), "the open panel switched");
    assert.equal(await host.page.textContent("#shortcutList h4"), t("ja", "group.reader"),
      "the open shortcut list switched");
    assert.equal(await host.page.textContent("#fidelityDetails"), t("ja", "fidelity.details"),
      "the fidelity bar switched");

    const chinese = host.waitFor((message) => message.type === "setLanguage" && message.language === "zh-CN");
    await host.page.check('input[name="settings-language"][value="zh-CN"]');
    await chinese;
    assert.equal((await chrome(host)).open, t("zh-CN", "open.button"));

    const english = host.waitFor((message) => message.type === "setLanguage" && message.language === "en");
    await host.page.check('input[name="settings-language"][value="en"]');
    await english;
    state = await chrome(host);
    assert.equal(state.open, "Open");
    assert.equal(state.lang, "en");
    assert.equal(await host.page.textContent("#fidelityText"), Wording.describeFidelity({ features: FEATURES }).text);

    const system = host.waitFor((message) => message.type === "setLanguage" && message.language === "system");
    await host.page.check('input[name="settings-language"][value="system"]');
    await system;
    assert.equal((await chrome(host)).open, "Open", "System follows the English system again");
  });
  await withHost({ language: "en", systemLanguage: "ja-JP" }, async (host) => {
    assert.equal((await chrome(host)).open, "Open", "a saved English overrides a Japanese system");
    assert.equal(await host.page.isChecked('input[name="settings-language"][value="en"]'), true);
  });
  await withHost({ language: "ja", systemLanguage: "en-US" }, async (host) => {
    assert.equal((await chrome(host)).open, t("ja", "open.button"), "a saved Japanese overrides an English system");
  });
});

test("fallback pages and the editor button are translated", async () => {
  await withHost({ language: "zh-CN", systemLanguage: "en-US", editor: { kind: "default", label: "Open with default app" } },
    async (host) => {
      await host.send({ type: "tabs", tabs: [{ id: 1, name: "old.doc", path: "/docs/old.doc" }], active: 1 });
      await host.send({ type: "fallback", tab: 1, generation: 1, fileName: "old.doc", displayPath: "/docs/old.doc",
        report: { ok: true, kind: "legacy-doc", features: [] } });
      const page = await host.page.evaluate(() => ({
        eyebrow: document.getElementById("stateEyebrow").textContent,
        message: document.getElementById("stateMessage").textContent,
        editor: document.getElementById("stateEditorButton").textContent,
        open: document.getElementById("stateOpenButton").textContent,
        meta: document.getElementById("fileMeta").textContent
      }));
      assert.equal(page.eyebrow, t("zh-CN", "kind.legacy-doc.title"));
      assert.equal(page.message, t("zh-CN", "kind.legacy-doc.message"));
      assert.equal(page.editor, t("zh-CN", "editor.openDefault"));
      assert.equal(page.open, t("zh-CN", "fallback.openButton"));
      assert.equal(page.meta, t("zh-CN", "identity.notShown"));
    });
});

// The layout with each language's strings: no button or label clipped (the
// file name and the line under it shorten with an ellipsis by design), no
// text outside the settings panel, the toolbar in one row without overflow,
// and CJK text drawn with a font that has the glyphs.
const cjkFontInstalled = (() => {
  try {
    return execFileSync("fc-list", [":lang=ja", "family"], { encoding: "utf8" }).trim() !== "" &&
      execFileSync("fc-list", [":lang=zh-cn", "family"], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
})();

for (const language of ["en", "ja", "zh-CN"]) {
  for (const width of [1280, 1024, 760]) {
    test(`the ${language} interface fits at ${width} px`, async () => {
      await withHost({ language, systemLanguage: "en-US", viewport: { width, height: 860 } }, async (host) => {
        await openWithNotes(host);
        await host.page.click("#fidelityDetails");
        await host.page.click("#settingsButton");
        await host.page.evaluate(() => document.fonts.ready);
        const problems = await host.page.evaluate(() => {
          const found = [];
          const visible = (node) => node.getClientRects().length > 0 &&
            getComputedStyle(node).visibility !== "hidden";
          const name = (node) => (node.id ? "#" + node.id : node.tagName.toLowerCase() +
            (node.className && typeof node.className === "string" ? "." + node.className.split(" ")[0] : "")) +
            " \"" + (node.textContent || "").trim().slice(0, 30) + "\"";
          const clips = (node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 2;
          document.querySelectorAll(
            "#chrome button, #chrome .segment, #chrome label, #settingsPanel button, #settingsPanel label, " +
            "#settingsPanel legend, #settingsPanel h2, #settingsPanel h3, #settingsPanel h4, #settingsPanel dd, " +
            "#settingsPanel dt, #fidelityList span, .outline-label"
          ).forEach((node) => {
            if (visible(node) && getComputedStyle(node).overflow !== "visible" && clips(node)) {
              found.push("clipped " + name(node));
            }
            if (visible(node) && node.tagName === "BUTTON" && clips(node) &&
                getComputedStyle(node).whiteSpace === "nowrap") {
              found.push("clipped " + name(node));
            }
          });
          const panel = document.getElementById("settingsPanel").getBoundingClientRect();
          document.querySelectorAll("#settingsPanel *").forEach((node) => {
            if (!visible(node) || node.closest("svg")) {
              return;
            }
            const box = node.getBoundingClientRect();
            if (box.width > 0 && (box.right > panel.right + 0.5 || box.left < panel.left - 0.5)) {
              found.push("outside the settings panel " + name(node));
            }
          });
          const panelScroll = document.getElementById("settingsPanel");
          if (panelScroll.scrollWidth > panelScroll.clientWidth + 1) {
            found.push("the settings panel scrolls sideways");
          }
          const toolbar = document.querySelector(".toolbar");
          if (toolbar.scrollWidth > toolbar.clientWidth + 1) {
            found.push("the toolbar overflows");
          }
          const topbar = document.querySelector(".topbar");
          if (topbar.scrollWidth > topbar.clientWidth + 1) {
            found.push("the top bar overflows");
          }
          // Toolbar controls must not overlap one another.
          const controls = [...toolbar.children].filter(visible).map((node) => [node, node.getBoundingClientRect()]);
          for (let a = 0; a < controls.length; a += 1) {
            for (let b = a + 1; b < controls.length; b += 1) {
              const [, first] = controls[a];
              const [, second] = controls[b];
              if (first.left < second.right - 1 && second.left < first.right - 1 &&
                  first.top < second.bottom - 1 && second.top < first.bottom - 1) {
                found.push("overlap " + name(controls[a][0]) + " " + name(controls[b][0]));
              }
            }
          }
          return found;
        });
        assert.deepEqual(problems, [], `${language} at ${width} px`);
        await screenshot(host, `language-${language}-${width}`);

        if (language !== "en") {
          const family = await host.page.evaluate(() => getComputedStyle(document.getElementById("settingsTitle")).fontFamily);
          const expected = language === "ja" ? /Hiragino Sans|Yu Gothic|Noto Sans CJK JP/ : /PingFang SC|Microsoft YaHei|Noto Sans CJK SC/;
          assert.match(family, expected, `the ${language} font stack names ${language} fonts first among the system fonts`);
          if (!cjkFontInstalled) {
            console.log(`# skipped: no CJK font is installed, so ${language} glyph rendering is not checked`);
            return;
          }
          // DevTools' CSS agent fetches the page's stylesheet again outside
          // page routing, which the recording proxy sees as one CONNECT to the
          // app origin. That request is the test tool's, not the reader's, so
          // it is taken off the record here, and nothing else may be added.
          const before = networkAttempts.length;
          const session = await host.page.context().newCDPSession(host.page);
          await session.send("DOM.enable");
          await session.send("CSS.enable");
          await new Promise((resolve) => setTimeout(resolve, 300));
          const added = networkAttempts.splice(before);
          assert.ok(added.every((attempt) => attempt === "CONNECT app.leandoc.invalid:443 HTTP/1.1"),
            `only DevTools' stylesheet fetch reached the network (${JSON.stringify(added)})`);
          const { root } = await session.send("DOM.getDocument");
          for (const selector of ["#settingsTitle", "#openButton", "#fidelityText"]) {
            const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
            const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
            const cjk = fonts.filter((font) => !/IBM Plex/i.test(font.familyName) && font.glyphCount > 0);
            assert.ok(cjk.length > 0, `${selector} is drawn with a CJK font (${JSON.stringify(fonts)})`);
          }
        }
      });
    });
  }
}

async function screenshot(host, name) {
  await host.page.evaluate(() => document.fonts.ready);
  await host.page.screenshot({ path: path.join(screenshotDirectory, `${name}.png`) });
}
