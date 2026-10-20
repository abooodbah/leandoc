// Unit tests for the reader's pure modules, run directly in Node.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Fixups = require(path.join(repositoryRoot, "assets", "fixups.js"));
const Wording = require(path.join(repositoryRoot, "assets", "fidelity.js"));
const cases = JSON.parse(readFileSync(path.join(repositoryRoot, "tests", "reader", "cases.json"), "utf8"));

test("Symbol table covers its two printable ranges", () => {
  assert.equal(Fixups.SYMBOL[0x20], " ");
  assert.equal(Fixups.SYMBOL[0x61], "α");
  assert.equal(Fixups.SYMBOL[0x7e], "∼");
  assert.equal(Fixups.SYMBOL[0xb7], "•");
  assert.equal(Fixups.SYMBOL[0xa8], "♦");
  assert.equal(Fixups.SYMBOL[0xef], "⎪");
  assert.equal(Fixups.SYMBOL[0xf0], undefined);
  assert.equal(Fixups.SYMBOL[0xfe], "⎭");
});

test("Word's standard bullets map to Unicode", () => {
  const map = (text, font) => Fixups.mapBulletText(text, Fixups.symbolFontKey(font));
  assert.equal(map("", "Symbol"), "•");
  assert.equal(map("", "Wingdings"), "▪");
  assert.equal(map("", "Wingdings"), "➢");
  assert.equal(map("", "Wingdings"), "✓");
  assert.equal(map("", "Wingdings"), "❖");
  assert.equal(map("", "Wingdings"), "◻");
  assert.equal(map("", "Wingdings"), "●");
  assert.equal(map("§", "Wingdings"), "▪");
  assert.equal(map("l", "Wingdings"), "●");
  assert.equal(map("·", "Symbol"), "•");
  assert.equal(map("o", "Courier New"), "o");
  assert.equal(map("-", "Arial"), "-");
});

test("Unknown symbol characters in bullets fall back to a bullet", () => {
  assert.equal(Fixups.mapBulletText("", "webdings"), "•");
  assert.equal(Fixups.mapBulletText("", ""), "•");
  assert.equal(Fixups.mapBulletText("", ""), "•");
  assert.equal(Fixups.mapBulletText("x", "wingdings-other"), "•");
});

test("Numbering placeholders are kept", () => {
  assert.equal(Fixups.mapBulletText("%1.%2.", "wingdings"), "%1.%2.");
  assert.equal(Fixups.mapBulletText("%1", "wingdings"), "%1✓");
});

test("Font names decide whether a font is symbolic", () => {
  assert.equal(Fixups.symbolFontKey("Symbol"), "symbol");
  assert.equal(Fixups.symbolFontKey("'Symbol', Symbol"), "symbol");
  assert.equal(Fixups.symbolFontKey("Wingdings"), "wingdings");
  assert.equal(Fixups.symbolFontKey("Wingdings 2"), "wingdings-other");
  assert.equal(Fixups.symbolFontKey("Webdings"), "webdings");
  assert.equal(Fixups.symbolFontKey("Segoe UI Symbol"), "");
  assert.equal(Fixups.symbolFontKey(undefined), "");
});

test("Inline symbol text maps completely or reports what is missing", () => {
  assert.deepEqual(Fixups.mapSymbolText("", "wingdings"), { text: "✓", complete: true, changed: true });
  assert.equal(Fixups.mapSymbolText("abc", "symbol").text, "αβχ");
  const partial = Fixups.mapSymbolText("", "webdings");
  assert.equal(partial.complete, false);
  assert.equal(Fixups.mapSymbolText("plain", "").changed, false);
});

test("Missing fonts get fallbacks after the document's family", () => {
  assert.equal(Fixups.withFontFallback("Calibri"), "Calibri, Carlito, sans-serif");
  assert.equal(Fixups.withFontFallback("'Times New Roman'"), "'Times New Roman', \"Liberation Serif\", Tinos, Times, serif");
  assert.equal(Fixups.withFontFallback("Unknown Font"), "Unknown Font");
  assert.equal(Fixups.withFontFallback("var(--docx-minorHAnsi-font)"), "var(--docx-minorHAnsi-font)");
  assert.equal(Fixups.withFontFallback("Calibri, Carlito, sans-serif"), "Calibri, Carlito, sans-serif");
});

test("Paragraph alignment becomes logical", () => {
  assert.equal(Fixups.logicalTextAlign("left"), "start");
  assert.equal(Fixups.logicalTextAlign("right"), "end");
  assert.equal(Fixups.logicalTextAlign("center"), "center");
  assert.equal(Fixups.logicalTextAlign("justify"), "justify");
});

test("Arabic number formats get counter styles", () => {
  assert.equal(Fixups.mapNumberFormat("hindiNumbers"), "arabic-indic");
  assert.equal(Fixups.mapNumberFormat("arabicAlpha"), "ld-arabic-alpha");
  assert.equal(Fixups.mapNumberFormat("decimal"), "decimal");
});

test("Only http, https, and mailto links stay links", () => {
  assert.deepEqual(Fixups.classifyHref("https://example.com/a"), { kind: "external", href: "https://example.com/a" });
  assert.deepEqual(Fixups.classifyHref(" http://example.com "), { kind: "external", href: "http://example.com/" });
  assert.deepEqual(Fixups.classifyHref("mailto:reader@example.com"), { kind: "external", href: "mailto:reader@example.com" });
  assert.deepEqual(Fixups.classifyHref("#_Toc123"), { kind: "internal", anchor: "_Toc123" });
  for (const blocked of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "file:///etc/passwd",
    "data:text/html,hi", "vbscript:x", "relative/path.docx", "", "#", "https://", "mailto:", "ms-word:ofe|u|x", "\\\\server\\share"]) {
    assert.equal(Fixups.classifyHref(blocked).kind, "blocked", blocked);
  }
});

test("mailto links keep only their addresses and allowed parameters", () => {
  const href = (raw) => Fixups.classifyHref(raw).href;
  assert.equal(href("MAILTO:a@example.com"), "mailto:a@example.com");
  assert.equal(href("mailto:a@example.com?subject=Hi&attach=/home/u/.ssh/id_rsa&body=x"),
    "mailto:a@example.com?subject=Hi&body=x");
  assert.equal(href("mailto:a@example.com?ATTACHMENT=%2Fetc%2Fpasswd&CC=b@example.com"),
    "mailto:a@example.com?CC=b@example.com");
  assert.equal(href("mailto:a b@example.com?subject=two words"),
    "mailto:a%20b@example.com?subject=two%20words");
  assert.equal(href("mailto:a@example.com#frag"), "mailto:a@example.com");
  assert.equal(href("mailto:?cc=b@example.com"), "mailto:?cc=b@example.com");
  for (const blocked of ["mailto:?attach=/etc/passwd", "mailto:?subject=x", "mailto:?cc="]) {
    assert.equal(Fixups.classifyHref(blocked).kind, "blocked", blocked);
  }
});

// Minimal element objects in the shape of an XML DOM: localName, children,
// attributes.
function el(localName, children = [], attributes = {}) {
  return {
    localName,
    children,
    attributes: Object.entries(attributes).map(([name, value]) => ({ localName: name, value }))
  };
}

test("Body paragraphs pair with the core's indexes, skipping what docx-preview skips", () => {
  const p = () => el("p");
  const textBoxParagraph = el("p");
  const body = el("body", [
    el("p", [el("r", [el("drawing", [el("txbxContent", [textBoxParagraph])])])]),
    el("customXml", [p()]),
    el("tbl", [el("tblPr", [el("bidiVisual")]), el("tr", [el("tc", [p(), el("tbl", [el("tr", [el("tc", [p()])])])]), el("tc", [p()])])]),
    el("sdt", [el("sdtContent", [p(), el("tbl", [el("tblPr", [el("bidiVisual", [], { val: "0" })]), el("tr", [el("tc", [p()])])])])]),
    p(),
    el("sectPr")
  ]);
  const model = { children: [] };
  const paragraph = () => ({ type: "paragraph", children: [] });
  const cell = (...children) => ({ type: "cell", children });
  const table = (...rows) => ({ type: "table", children: rows });
  const row = (...cells) => ({ type: "row", children: cells });
  model.children = [
    paragraph(),
    table(row(cell(paragraph(), table(row(cell(paragraph())))), cell(paragraph()))),
    paragraph(),
    table(row(cell(paragraph()))),
    paragraph()
  ];
  const result = Fixups.annotateBody(model, body);
  assert.equal(result.paired, true);
  assert.equal(result.paragraphs, 7);
  assert.equal(result.bidiVisualTables, 1);
  const classes = [];
  (function walk(children) {
    for (const child of children) {
      if (child.type === "paragraph") {
        classes.push(child.className);
      }
      walk(child.children || []);
    }
  }(model.children));
  // customXml's paragraph is index 1 for the core but never rendered.
  assert.deepEqual(classes, ["ld-p ld-pi-0", "ld-p ld-pi-2", "ld-p ld-pi-3", "ld-p ld-pi-4", "ld-p ld-pi-5", "ld-p ld-pi-6", "ld-p ld-pi-7"]);
  assert.equal(model.children[1].className, "ld-bidi-visual");
  assert.equal(model.children[3].className, undefined);
  assert.equal(Fixups.coreParagraphIndexes(body).has(textBoxParagraph), false);
});

test("Paragraphs inside mc:Fallback are skipped, as the core skips them", () => {
  const before = el("p");
  const fallbackParagraph = el("p");
  const after = el("p");
  const body = el("body", [
    before,
    el("AlternateContent", [el("Choice", [el("p")]), el("Fallback", [fallbackParagraph])]),
    after
  ]);
  const indexes = Fixups.coreParagraphIndexes(body);
  assert.equal(indexes.has(fallbackParagraph), false);
  assert.equal(indexes.get(before), 0);
});

test("Without XML the model order is used", () => {
  const model = { children: [{ type: "paragraph" }, { type: "paragraph", className: "x" }] };
  const result = Fixups.annotateBody(model, null);
  assert.equal(result.paired, false);
  assert.equal(model.children[1].className, "x ld-p ld-pi-1");
});

test("prepareModel fixes numbering, runs, symbols, styles, and theme fonts", () => {
  const doc = {
    numberingPart: {
      domNumberings: [
        { id: "1", level: 0, levelText: "", format: "bullet", rStyle: { "font-family": "Symbol" }, pStyle: { "text-align": "left" } },
        { id: "2", level: 0, levelText: "%1.", format: "hindiNumbers", rStyle: {}, pStyle: {} }
      ]
    },
    stylesPart: {
      styles: [
        { id: null, target: null, styles: [{ target: "span", values: { "font-family": "Calibri", "font-size": "11pt" } }] },
        { id: "Normal", target: "p", styles: [{ target: "p", values: { "text-align": "right" } }] }
      ]
    },
    themePart: { theme: { fontScheme: { majorFont: { latinTypeface: "Calibri Light" }, minorFont: { latinTypeface: "Cambria" } } } },
    documentPart: {
      body: {
        children: [{
          type: "paragraph",
          cssStyle: { "text-align": "left" },
          children: [
            { type: "run", cssStyle: { "font-family": "Wingdings" }, children: [{ type: "text", text: "" }] },
            { type: "run", cssStyle: {}, children: [{ type: "symbol", font: "Wingdings", char: 0xf0fc }] },
            { type: "run", cssStyle: { "font-family": "Arial" }, children: [{ type: "text", text: "plain" }] }
          ]
        }]
      }
    },
    parts: []
  };
  const stats = Fixups.prepareModel(doc);
  const [bullet, numbered] = doc.numberingPart.domNumberings;
  assert.equal(bullet.levelText, "•");
  assert.equal(bullet.rStyle["font-family"], Fixups.SYMBOL_FONT_STACK);
  assert.equal(bullet.pStyle["text-align"], "start");
  assert.equal(numbered.levelText, "%1.");
  assert.equal(numbered.format, "arabic-indic");
  assert.equal(doc.stylesPart.styles[1].styles[0].values["text-align"], "end");
  const defaults = doc.stylesPart.styles[0].styles;
  assert.equal(defaults[0].values["font-family"], "Calibri, Carlito, sans-serif");
  assert.deepEqual(defaults[1], { target: "p", values: { "font-family": "Calibri, Carlito, sans-serif", "font-size": "11pt" } });
  assert.equal(doc.themePart.theme.fontScheme.majorFont.latinTypeface, "Calibri Light, Carlito, sans-serif");
  const paragraph = doc.documentPart.body.children[0];
  assert.equal(paragraph.cssStyle["text-align"], "start");
  assert.equal(paragraph.children[0].children[0].text, "✓");
  assert.equal(paragraph.children[1].children[0].char, 0x2713);
  assert.equal(paragraph.children[2].cssStyle["font-family"], "Arial, \"Liberation Sans\", Arimo, Helvetica, sans-serif");
  assert.equal(paragraph.className, "ld-p ld-pi-0");
  assert.equal(stats.bullets, 1);
  assert.equal(stats.symbols, 2);
});

test("Images resolve only to blob or data URLs", async () => {
  const doc = {
    loadDocumentImage: async (id) => (id === "ok" ? "blob:https://app.leandoc.invalid/1" : null),
    loadNumberingImage: async () => { throw new Error("missing"); },
    loadFont: async () => "blob:font"
  };
  Fixups.guardResources(doc);
  assert.equal(await doc.loadDocumentImage("ok"), "blob:https://app.leandoc.invalid/1");
  assert.equal(await doc.loadDocumentImage("gone"), Fixups.EMPTY_IMAGE);
  assert.equal(await doc.loadNumberingImage("x"), Fixups.EMPTY_IMAGE);
  assert.equal(await doc.loadFont("x"), null);
  assert.equal(await doc.loadAltChunk("x"), "");
});

test("Lists join with commas and 'and'", () => {
  assert.equal(Wording.joinList([]), "");
  assert.equal(Wording.joinList(["a"]), "a");
  assert.equal(Wording.joinList(["a", "b"]), "a and b");
  assert.equal(Wording.joinList(["a", "b", "c"]), "a, b, and c");
});

test("Fidelity sentences match the fixed wording", () => {
  for (const entry of cases.fidelity) {
    const info = Wording.describeFidelity({ features: entry.features });
    if (entry.text === null) {
      assert.equal(info, null, entry.id);
    } else {
      assert.equal(info.text, entry.text, entry.id);
      assert.equal(info.items.length, entry.features.length, entry.id);
    }
  }
});

test("Fidelity uses singular nouns for one and falls back to known nouns", () => {
  const info = Wording.describeFidelity({ features: [
    { code: "text-box", count: 1, notDisplayed: true },
    { code: "smart-art", count: 3, notDisplayed: true },
    { code: "chart", count: 0, notDisplayed: true }
  ] });
  assert.equal(info.text, "This document contains 1 text box and 3 SmartArt graphics that LeanDoc does not display.");
  assert.deepEqual(info.items.map((item) => [item.label, item.count, item.status]), [
    ["Text box", 1, "Not displayed"], ["SmartArt graphics", 3, "Not displayed"]
  ]);
  const notices = Wording.describeFidelity({ features: [{ code: "comments", count: 4, notDisplayed: false }] });
  assert.equal(notices.text, "This document contains comments (hidden).");
  assert.equal(notices.items[0].status, "Hidden");
});

test("Fallback pages say what the file is", () => {
  for (const entry of cases.fallbacks) {
    const info = Wording.describeFallback({
      ok: entry.ok !== false, kind: entry.kind, errorCode: entry.errorCode || "", errorMessage: entry.errorMessage || ""
    });
    assert.equal(info.message, entry.text, entry.kind);
  }
});

test("Editor labels read as an action", () => {
  assert.equal(Wording.editorActionLabel("Word"), "Open in Word");
  assert.equal(Wording.editorActionLabel("LibreOffice Writer"), "Open in LibreOffice Writer");
  assert.equal(Wording.editorActionLabel("Open in Pages"), "Open in Pages");
  assert.equal(Wording.editorActionLabel(""), "");
  assert.equal(Wording.editorActionLabel(undefined), "");
});

test("The reader's Content Security Policy is exactly SPEC section 4.4", () => {
  const spec = readFileSync(path.join(repositoryRoot, "docs", "SPEC.md"), "utf8");
  const block = /### 4\.4 Content Security Policy\s+```text\n([\s\S]*?)```/.exec(spec);
  assert.ok(block, "SPEC.md has the policy block");
  const expected = block[1].replace(/\s+/g, " ").trim();
  const html = readFileSync(path.join(repositoryRoot, "assets", "reader.html"), "utf8");
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  assert.ok(meta, "reader.html has the policy meta element");
  assert.equal(meta[1], expected);
});

test("The stage script copies the runtime files and refuses source folders", () => {
  const script = path.join(repositoryRoot, "scripts", "stage-runtime-assets.mjs");
  for (const forbidden of [repositoryRoot, path.join(repositoryRoot, "assets"), path.join(repositoryRoot, "node_modules")]) {
    const result = spawnSync(process.execPath, [script, forbidden], { encoding: "utf8" });
    assert.notEqual(result.status, 0, forbidden);
  }
  const destination = mkdtempSync(path.join(os.tmpdir(), "leandoc-stage-"));
  try {
    const result = spawnSync(process.execPath, [script, destination], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const list = (folder) => readdirSync(path.join(destination, folder)).sort();
    assert.deepEqual(readdirSync(destination).sort(), ["fidelity.js", "fixups.js", "fonts", "reader.css", "reader.html", "reader.js", "vendor"]);
    assert.deepEqual(list("vendor"), ["docx-preview.min.js", "jszip.min.js"]);
    const css = readFileSync(path.join(repositoryRoot, "assets", "reader.css"), "utf8");
    const referenced = [...css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((match) => match[1]).sort();
    assert.deepEqual(list("fonts"), [...new Set(referenced)]);
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});

test("Reader files contain no em dash and no banned wording", () => {
  const banned = /\u2014|ultra-lightweight|blazing fast|zero dependency|completely secure/i;
  const files = [
    ...["reader.html", "reader.css", "reader.js", "fixups.js", "fidelity.js"].map((file) => path.join("assets", file)),
    ...readdirSync(path.join(repositoryRoot, "tests", "reader"))
      .filter((file) => /\.(mjs|json|md|py)$/.test(file))
      .map((file) => path.join("tests", "reader", file)),
    path.join("scripts", "stage-runtime-assets.mjs"),
    "THIRD_PARTY_NOTICES.md"
  ];
  for (const file of files) {
    const text = readFileSync(path.join(repositoryRoot, file), "utf8");
    // This file names the banned words in its own pattern.
    const pattern = file.endsWith("fixups.test.mjs") ? /\u2014/ : banned;
    assert.equal(pattern.test(text), false, file);
  }
});
