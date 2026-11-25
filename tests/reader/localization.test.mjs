// Checks the interface translations without a browser, as LeanMark's
// tests/Test-Localization.mjs does: the English, Simplified Chinese, and
// Japanese tables have the same keys, placeholders, and key names, no string
// is empty or left in English, the language follows the system unless the
// reader chose one, every visible string in reader.html and every message the
// hosts and the core send has a translation, and the hosts' own strings (file
// dialogs, error boxes, the macOS menus) come in all three languages.
//
//   node --test tests/reader/localization.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const Wording = require(path.join(root, "assets", "fidelity.js"));
const strings = Wording.strings || {};
const tables = strings.tables || {};
const english = tables.en || {};
const LANGUAGES = ["zh-CN", "ja"];

// Names that stay in Latin letters in every language: the product, the
// formats, runtimes and products it names, units, and the names on keys.
const LATIN_NAMES = [
  "LeanDoc 0.1", "LeanDoc", "Word for the web", "Word 97-2003", "Word", "Microsoft Edge",
  "WebView2", "Windows", "Linux", "macOS", "SmartArt", "ActiveX", "OpenDocument",
  "Rich Text Format", "DDE", "DTD", "XML", "UTF-8", "MiB", "MB", "KB",
  "Ctrl", "Shift", "Cmd", "Esc", "Enter", "Tab", "Home", "End", "Delete", "Page Up",
  "Page Down", "F1", "F3", "F5",
  ".docx", ".dotx", ".docm", ".dotm", ".doc", ".rtf", ".odt"
];
const SORTED_NAMES = [...LATIN_NAMES].sort((a, b) => b.length - a.length);

function leftoverEnglish(text) {
  let rest = String(text).replace(/\{[a-zA-Z]+\}/g, " ");
  SORTED_NAMES.forEach((name) => {
    rest = rest.split(name).join(" ");
  });
  return (rest.match(/[A-Za-z]{2,}/g) || []).join(", ");
}

const hasHan = (text) => /[一-鿿]/.test(text);
const hasKana = (text) => /[぀-ヿ]/.test(text);
const placeholders = (text) => (String(text).match(/\{[a-zA-Z]+\}/g) || []).sort().join(" ");
// Key names and shortcuts such as Ctrl+Shift+T, F3, or Esc, which every
// language keeps as they are printed on the keys.
const keyNames = (text) => (String(text).match(
  /\b(?:Ctrl|Shift|Cmd|Alt)\+[^\s,)、，。）]*|\bF\d{1,2}\b|\bEsc\b/g) || []).sort().join(" ");
// Joiners such as " and " are allowed to be punctuation only.
const PUNCTUATION_KEYS = new Set(["list.pair", "list.separator", "list.last"]);

test("the tables sit between BEGIN and END markers in fidelity.js", () => {
  const source = read("assets/fidelity.js");
  const begin = source.indexOf("// BEGIN interface strings");
  const end = source.indexOf("// END interface strings");
  assert.ok(begin >= 0 && end > begin, "markers around the string tables");
  assert.ok(Object.keys(english).length >= 200,
    `an English table of the whole interface (${Object.keys(english).length} strings)`);
  assert.deepEqual(strings.languages, ["en", "zh-CN", "ja"], "the three interface languages");
});

for (const language of LANGUAGES) {
  test(`the ${language} table has every English key and nothing else`, () => {
    assert.ok(Object.keys(english).length > 0, "there is an English table");
    const table = tables[language] || {};
    const missing = Object.keys(english).filter((key) => !(key in table));
    const extra = Object.keys(table).filter((key) => !(key in english));
    assert.deepEqual(missing, [], "missing keys");
    assert.deepEqual(extra, [], "keys English lacks");
  });

  test(`no ${language} string is empty, and placeholders and key names are kept`, () => {
    assert.ok(tables[language], `there is a ${language} table`);
    const table = tables[language] || {};
    const empty = Object.keys(english).filter((key) =>
      typeof table[key] !== "string" || table[key].trim() === "" && !PUNCTUATION_KEYS.has(key) ||
      table[key] === "");
    assert.deepEqual(empty, [], "empty strings");
    const drift = Object.keys(english).filter((key) => key in table &&
      placeholders(english[key]) !== placeholders(table[key]));
    assert.deepEqual(drift, [], "placeholders changed");
    const keys = Object.keys(english).filter((key) => key in table &&
      keyNames(english[key]) !== keyNames(table[key]));
    assert.deepEqual(keys.map((key) => `${key}: ${table[key]}`), [], "key names changed");
  });

  test(`no ${language} string is left in English`, () => {
    assert.ok(tables[language], `there is a ${language} table`);
    const table = tables[language] || {};
    const left = Object.keys(english).filter((key) => {
      const value = table[key];
      if (typeof value !== "string") {
        return true;
      }
      if (PUNCTUATION_KEYS.has(key)) {
        return leftoverEnglish(value) !== "";
      }
      // A string with words in it must have Chinese or Japanese text; one
      // made of key names and placeholders only, such as
      // "{label} (Ctrl+Shift+E)", may keep its form.
      return leftoverEnglish(value) !== "" ||
        leftoverEnglish(english[key]) !== "" && !hasHan(value) && !hasKana(value);
    });
    assert.deepEqual(left.map((key) => `${key}: ${table[key]}`), [], "untranslated strings");
  });
}

test("the Japanese table is Japanese, not Chinese", () => {
  const japanese = Object.values(tables.ja || {});
  const share = japanese.filter(hasKana).length / Math.max(1, japanese.length);
  assert.ok(share > 0.6, `${Math.round(share * 100)}% of the Japanese strings have kana`);
  const chinese = Object.values(tables["zh-CN"] || {});
  assert.ok(chinese.filter(hasKana).length === 0, "no Chinese string has kana");
});

test("lookup fills placeholders and falls back to English", () => {
  const key = Object.keys(english).find((name) => placeholders(english[name]) === "" &&
    !PUNCTUATION_KEYS.has(name));
  assert.equal(strings.text("en", key), english[key]);
  assert.equal(strings.text("ja", key), (tables.ja || {})[key]);
  assert.equal(strings.text("zh-CN", key), (tables["zh-CN"] || {})[key]);
  const saved = tables.ja[key];
  delete tables.ja[key];
  assert.equal(strings.text("ja", key), english[key], "a key missing from a table gives English");
  tables.ja[key] = saved;
  assert.equal(strings.text("fr", key), english[key], "an unknown language gives English");
  assert.equal(strings.text("ja", "no.such.key"), "no.such.key", "an unknown key shows the key");
  assert.equal(strings.text("en", "identity.pages", { count: 12 }), "12 pages");
  const filled = strings.text("ja", "identity.pages", { count: 12 });
  assert.ok(filled.indexOf("12") >= 0 && filled.indexOf("{") < 0 && (hasHan(filled) || hasKana(filled)),
    `placeholders are filled (${filled})`);
});

test("the system language picks the interface language", () => {
  const resolve = strings.resolve;
  const expectations = {
    "ja-JP": "ja", "ja": "ja", "JA-jp": "ja", "ja_JP.UTF-8": "ja", "ja_JP": "ja",
    // Simplified Chinese tags, as in LeanMark's tests/Test-Localization.mjs.
    "zh-CN": "zh-CN", "zh-cn": "zh-CN", "zh": "zh-CN", "zh-SG": "zh-CN", "zh-Hans": "zh-CN",
    "zh-Hans-CN": "zh-CN", "zh-Hans-HK": "zh-CN", "zh_CN.UTF-8": "zh-CN", "zh_CN": "zh-CN",
    // Traditional Chinese keeps English, as in LeanMark: there is no
    // Traditional Chinese interface.
    "zh-TW": "en", "zh-HK": "en", "zh-MO": "en", "zh-Hant": "en", "zh-Hant-TW": "en",
    "zh_TW.UTF-8": "en", "zh_TW": "en",
    "fr-FR": "en", "": "en", "en-US": "en", "en": "en", "de-DE": "en", "C": "en", "POSIX": "en",
    "jv-ID": "en", "jax": "en", "zhx": "en"
  };
  for (const [tag, expected] of Object.entries(expectations)) {
    assert.equal(resolve("system", tag), expected, `system ${JSON.stringify(tag)}`);
  }
  assert.equal(resolve("system", undefined), "en", "no system language gives English");
});

test("a chosen language overrides the system, and an unknown one follows it", () => {
  const resolve = strings.resolve;
  assert.equal(resolve("en", "ja-JP"), "en");
  assert.equal(resolve("ja", "en-US"), "ja");
  assert.equal(resolve("zh-CN", "ja-JP"), "zh-CN");
  assert.equal(resolve("fr", "ja-JP"), "ja");
  assert.equal(resolve(undefined, "zh-SG"), "zh-CN");
  assert.equal(resolve("zh-CN", "zh-TW"), "zh-CN", "a Traditional Chinese system can still choose Simplified Chinese");
  assert.equal(strings.normalizeSetting("JA"), "ja", "settings ignore ASCII case, as the hosts' do");
  assert.equal(strings.normalizeSetting("zh-cn"), "zh-CN");
  assert.equal(strings.normalizeSetting("zh-TW"), "system", "a name the hosts do not save follows the system");
});

// reader.html stays in English and marks each visible string.
test("every visible string in reader.html has a key whose English is the page text", () => {
  const html = read("assets/reader.html");
  const body = html.slice(html.indexOf("<body"));
  const markup = body.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const SAME = new Set(["LeanDoc", "LD", "100%", "English", "简体中文", "日本語"]);
  const collapse = (text) => text.replace(/\s+/g, " ").trim();
  const pattern = /<([a-z0-9]+)((?:\s+[a-z0-9-]+(?:="[^"]*")?)*)\s*(\/?)>|<\/([a-z0-9]+)>|([^<]+)/gi;
  const stack = [];
  const unmarked = [];
  const drift = [];
  let match;
  while ((match = pattern.exec(markup))) {
    if (match[1]) {
      const attributes = {};
      (match[2].match(/[a-z0-9-]+(?:="[^"]*")?/gi) || []).forEach((pair) => {
        const index = pair.indexOf("=");
        attributes[index < 0 ? pair : pair.slice(0, index)] = index < 0 ? "" : pair.slice(index + 2, -1);
      });
      for (const name of ["title", "aria-label", "placeholder"]) {
        if (attributes[name] && !SAME.has(attributes[name])) {
          const key = attributes[`data-i18n-${name}`];
          if (!key) {
            unmarked.push(`${name}="${attributes[name]}"`);
          } else if (english[key] !== attributes[name]) {
            drift.push(`${key}: ${attributes[name]}`);
          }
        }
      }
      if (!match[3] && !["input", "br", "meta", "link"].includes(match[1])) {
        stack.push(attributes);
      }
    } else if (match[4]) {
      stack.pop();
    } else if (match[5]) {
      const text = collapse(match[5]);
      if (text && !SAME.has(text)) {
        const owner = stack[stack.length - 1] || {};
        const key = owner["data-i18n"];
        if (!key) {
          unmarked.push(text);
        } else if (english[key] !== text) {
          drift.push(`${key}: ${text}`);
        }
      }
    }
  }
  assert.deepEqual(unmarked, [], "text and attributes without a data-i18n key");
  assert.deepEqual(drift, [], "keys whose English is not the page text");
  assert.match(html, /<div id="docBody"[^>]*\blang="en"/, "the document keeps the language it had before");
  for (const value of ["system", "en", "zh-CN", "ja"]) {
    assert.match(html, new RegExp(`name="settings-language" value="${value}"`),
      `the settings panel offers ${value}`);
  }
});

// The literal English strings a piece of C++ or Objective-C++ source passes
// to a call, with adjacent literals joined.
function literalsAfter(source, call) {
  const found = [];
  let index = source.indexOf(call);
  while (index >= 0) {
    let rest = source.slice(index + call.length);
    const parts = [];
    for (;;) {
      const literal = rest.match(/^\s*(?:L|@)?"((?:[^"\\]|\\.)*)"/);
      if (!literal) {
        break;
      }
      parts.push(literal[1].replace(/\\"/g, "\""));
      rest = rest.slice(literal[0].length);
    }
    if (parts.length && !/^\s*\+/.test(rest)) {
      found.push(parts.join(""));
    }
    index = source.indexOf(call, index + call.length);
  }
  return found;
}

const englishValues = new Map(Object.entries(english).map(([key, value]) => [value, key]));

test("every status message a host sends has a translation", () => {
  const sources = {
    "src/windows/App.cpp": ["SendStatus("],
    "src/linux/LinuxApp.cpp": ["SendStatus("],
    "macos/src/LDDocument.mm": ["broadcastStatus:", "DocumentError(NSFileReadUnsupportedSchemeError,"],
    "macos/src/LDDocumentWindowController.mm": ["showStatus:"],
    "macos/src/LDEditor.mm": ["completion("]
  };
  const messages = [];
  for (const [file, calls] of Object.entries(sources)) {
    const source = read(file);
    calls.forEach((call) => literalsAfter(source, call).forEach((message) => messages.push([file, message])));
  }
  assert.ok(messages.length >= 18, `found the hosts' messages (${messages.length})`);
  const missing = messages.filter(([, message]) => {
    const key = englishValues.get(message);
    return !key || !/^(host|core)\./.test(key);
  });
  assert.deepEqual(missing.map(([file, message]) => `${file}: ${message}`), [], "messages without a key");
  for (const language of LANGUAGES) {
    const untranslated = messages.filter(([, message]) => {
      const shown = strings.hostText(language, message);
      return shown === message || !hasHan(shown) && !hasKana(shown);
    });
    assert.deepEqual(untranslated.map(([, message]) => message), [], `${language} host messages`);
    assert.equal(strings.hostText(language, "A message no table has."), "A message no table has.",
      "an unknown message is shown as sent");
  }
});

test("every sentence the core and the hosts put in a report has a translation", () => {
  const sources = ["src/core/DocCore.cpp", "src/core/Zip.cpp", "src/core/Xml.cpp", "src/core/Cfb.cpp",
    "src/core/Word.cpp", "src/windows/Platform.cpp"];
  const fixed = [];
  const codes = new Set();
  for (const file of sources) {
    const source = read(file);
    for (const call of ["failure.Set(", "Set(", "fail(", "ReadFailure(", "errorMessage = "]) {
      literalsAfter(source, call).forEach((message) => {
        if (/^[a-z][a-z-]+$/.test(message)) {
          codes.add(message);
        } else if (/[A-Z].* /.test(message)) {
          fixed.push(`${file}: ${message}`);
        }
      });
    }
    // A code passed before a message: Set("code", ...).
    for (const code of source.matchAll(/(?:Set|ReadFailure)\(\s*"([a-z][a-z-]+)"/g)) {
      codes.add(code[1]);
    }
  }
  assert.ok(fixed.length >= 15, `found the core's fixed sentences (${fixed.length})`);
  const missing = fixed.filter((entry) => !englishValues.has(entry.slice(entry.indexOf(": ") + 2)));
  assert.deepEqual(missing, [], "fixed sentences without a key");
  // A sentence built with a number has a translated sentence for its code.
  const uncoded = [...codes].filter((code) => !(`error.${code}` in english));
  assert.deepEqual(uncoded, [], "error codes without a sentence");
  for (const language of LANGUAGES) {
    const fallback = Wording.describeFallback({ ok: false, errorCode: "part-too-large",
      errorMessage: "A part of this document expands past LeanDoc's 64 MB limit." }, language);
    assert.equal(fallback.message, strings.text(language, "error.part-too-large"),
      `${language}: a sentence with a number shows its code's sentence`);
    const known = Wording.describeFallback({ ok: false, errorCode: "read-failed",
      errorMessage: "LeanDoc could not find this file." }, language);
    assert.equal(known.message, strings.text(language, "core.notFound"), `${language}: a known sentence`);
    assert.equal(known.title, strings.text(language, "fallback.couldNotOpen"));
  }
});

test("English wording is unchanged", () => {
  const fidelity = Wording.describeFidelity({ features: [
    { code: "text-box", count: 2, notDisplayed: true, singular: "text box", plural: "text boxes" },
    { code: "equation", count: 1, notDisplayed: true },
    { code: "tracked-changes", count: 3, notDisplayed: false },
    { code: "macros", count: 1, notDisplayed: false }] });
  assert.equal(fidelity.text, "This document contains 2 text boxes and 1 equation that LeanDoc does " +
    "not display. It also contains tracked changes (shown as accepted) and macros (not run).");
  assert.equal(fidelity.summary, "Some content in this document is not displayed.");
  assert.deepEqual(fidelity.items.map((item) => item.status),
    ["Not displayed", "Not displayed", "Shown as accepted", "Not run"]);
  assert.equal(Wording.describeFidelity({ features: [{ code: "comments", count: 1 }] }).summary,
    "This document has a notice.");
  assert.equal(Wording.describeFallback({ kind: "rtf" }).message,
    "This is a Rich Text Format document (.rtf). LeanDoc 0.1 reads .docx files only.");
  assert.equal(Wording.editorActionLabel("Word"), "Open in Word");
});

for (const language of LANGUAGES) {
  test(`fidelity notes and fallback pages are written in ${language}`, () => {
    const codes = Object.keys(english).filter((key) => key.startsWith("noun.") && key.endsWith(".one"))
      .map((key) => key.slice(5, -4)).filter((code) => code !== "smartart");
    const report = { features: codes.map((code, index) => ({
      code, count: index + 1, notDisplayed: index % 2 === 0,
      // The core's English nouns must not leak into another language.
      singular: "english noun", plural: "english nouns" })) };
    const fidelity = Wording.describeFidelity(report, language);
    for (const text of [fidelity.text, fidelity.summary, ...fidelity.items.map((item) => item.label + item.status)]) {
      assert.equal(leftoverEnglish(text), "", `no English in "${text}"`);
    }
    for (const kind of ["legacy-doc", "encrypted-ooxml", "rtf", "odt", "not-a-document"]) {
      const page = Wording.describeFallback({ kind }, language);
      assert.equal(leftoverEnglish(page.title + page.message), "", `${kind}: ${page.title} ${page.message}`);
    }
    const shown = Wording.describeFallback({ kind: "docx", ok: true }, language);
    assert.equal(shown.title, strings.text(language, "fallback.notShownTitle"));
    assert.equal(Wording.editorActionLabel("Word", language), strings.text(language, "editor.openIn", { name: "Word" }));
    assert.equal(Wording.editorActionLabel("Open with default app", language), strings.text(language, "editor.openDefault"));
    assert.equal(Wording.editorActionLabel("Open in LibreOffice Writer", language),
      strings.text(language, "editor.openIn", { name: "LibreOffice Writer" }));
  });
}

// The hosts' own strings: InterfaceText.h holds each in UTF-8 in all three
// languages, and no dialog, error box, or menu takes a bare English literal.
test("the hosts' own strings come in English, Chinese, and Japanese", () => {
  const header = read("src/core/InterfaceText.h");
  const entries = [...header.matchAll(/inline constexpr NativeText (k[A-Za-z0-9]+)\s*=\s*\{\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\s*\}/g)];
  const nativeKeys = Object.keys(english).filter((key) => key.startsWith("native."));
  assert.equal(entries.length, nativeKeys.length, "one entry per native string");
  const byEnglish = new Map(entries.map((entry) => [entry[2], entry]));
  for (const key of nativeKeys) {
    const entry = byEnglish.get(english[key]);
    assert.ok(entry, `${key} is in InterfaceText.h`);
    assert.equal(entry[3], tables["zh-CN"][key], `${key}: the Chinese text matches the table`);
    assert.equal(entry[4], tables.ja[key], `${key}: the Japanese text matches the table`);
  }
  const bare = [];
  const scan = (file, patterns) => {
    const source = read(file);
    patterns.forEach((pattern) => {
      for (const hit of source.matchAll(pattern)) {
        if (!/^LeanDoc$/.test(hit[1])) {
          bare.push(`${file}: ${hit[0].trim()}`);
        }
      }
    });
  };
  scan("src/windows/App.cpp", [/MessageBoxW\([^;]*?L"([^"]+)"/g, /SetTitle\(\s*L"([^"]*)"/g, /\{\s*L"([A-Z][^"]*)",\s*L"\*\./g, /Fail\(\s*L"([^"]*)"/g]);
  scan("src/linux/LinuxApp.cpp", [/gtk_file_dialog_set_title\([^,]+,\s*"([^"]*)"/g, /gtk_file_filter_set_name\([^,]+,\s*"([^"]*)"/g]);
  scan("macos/src/LDAppDelegate.mm", [/MenuItem\(@"([^"]+)"/g, /initWithTitle:@"([^"]+)"/g]);
  scan("macos/src/LDDocumentController.mm", [/panel\.title = @"([^"]*)"/g]);
  scan("macos/src/LDDocument.mm", [/DocumentError\(\s*NSFeatureUnsupportedError,\s*@"([^"]*)"/g]);
  assert.deepEqual(bare, [], "native strings that bypass InterfaceText.h");
});

test("every host saves the language and opens the reader in it", () => {
  const settings = read("src/core/ReaderSettings.h");
  for (const name of ["ParseLanguage", "LanguageName", "IsLanguageName", "SystemInterfaceLanguage",
    "ResolveInterfaceLanguage", "IsReaderUrl"]) {
    assert.match(settings, new RegExp(`\\b${name}\\(`), `ReaderSettings.h has ${name}`);
  }
  const windows = read("src/windows/App.cpp");
  assert.match(windows, /L"Language"/, "Windows saves Language beside Theme");
  assert.match(windows, /"setLanguage"/, "Windows handles setLanguage");
  assert.match(windows, /\?lang=/, "Windows opens reader.html?lang=");
  const linux = read("src/linux/LinuxApp.cpp");
  assert.match(linux, /"Reader",\s*"Language"/, "Linux saves [Reader] Language");
  assert.match(linux, /"setLanguage"/, "Linux handles setLanguage");
  assert.match(linux, /\?lang=/, "Linux opens reader.html?lang=");
  const mac = read("macos/src/LDDocumentWindowController.mm") + read("macos/src/LDAppDelegate.mm");
  assert.match(mac, /LeanDocLanguage/, "macOS saves LeanDocLanguage");
  assert.match(mac, /setLanguage/, "macOS handles setLanguage");
  assert.match(mac, /\?lang=/, "macOS opens reader.html?lang=");
});
