// LeanDoc reader fixes applied around docx-preview. Pure functions, usable in
// the page (window.LeanDocFixups) and in Node for unit tests.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LeanDocFixups = api;
  }
}(this, function () {
  "use strict";

  // Symbol, Wingdings, and Webdings are fonts whose glyphs sit at byte codes
  // (0x20 to 0xFF), and Word stores them as U+F020 to U+F0FF. Systems without
  // those fonts draw nothing or a box, so each character is mapped to the
  // Unicode character it shows.
  function fill(table, start, text) {
    var chars = Array.from(text);
    for (var index = 0; index < chars.length; index += 1) {
      if (chars[index] !== "\u0000") {
        table[start + index] = chars[index];
      }
    }
    return table;
  }

  var SYMBOL = {};
  fill(SYMBOL, 0x20,
    " !∀#∃%&∋()∗+,−./0123456789:;<=>?" +
    "≅ΑΒΧΔΕΦΓΗΙϑ" +
    "ΚΛΜΝΟΠΘΡΣΤΥ" +
    "ςΩΞΨΖ[∴]⊥_‾αβχ" +
    "δεφγηιϕκλμν" +
    "οπθρστυϖωξψ" +
    "ζ{|}∼");
  fill(SYMBOL, 0xa0,
    "€ϒ′≤⁄∞ƒ♣♦♥♠" +
    "↔←↑→↓°±″≥×∝" +
    "∂•÷≠≡≈…⏐⎯↵ℵ" +
    "ℑℜ℘⊗⊕∅∩∪⊃⊇⊄" +
    "⊂⊆∈∉∠∇®©™∏√" +
    "⋅¬∧∨⇔⇐⇑⇒⇓◊〈" +
    "®©™∑⎛⎜⎝⎡⎢⎣⎧" +
    "⎨⎩⎪\u0000〉∫⌠⎮⌡⎞⎟" +
    "⎠⎤⎥⎦⎫⎬⎭");

  // Wingdings: the characters Word uses for bullets and check boxes, plus
  // common arrows, stars, and circled numbers. Others stay unmapped.
  var WINGDINGS = {};
  fill(WINGDINGS, 0x20, " \u0000✂\u0000\u0000\u0000\u0000\u0000☎");
  fill(WINGDINGS, 0x3f, "✍");
  fill(WINGDINGS, 0x45, "☜☞☝☟✋☺\u0000☹");
  fill(WINGDINGS, 0x51, "✈");
  fill(WINGDINGS, 0x54, "❄");
  fill(WINGDINGS, 0x6c,
    "●❍■□\u0000❑❒⬧⧫◆❖" +
    "⬥⌧\u0000⌘❀✿❝❞");
  fill(WINGDINGS, 0x80,
    "⓪①②③④⑤⑥⑦⑧⑨⑩" +
    "⓿❶❷❸❹❺❻❼❽❾❿");
  fill(WINGDINGS, 0x9e,
    "·•▪○\u0000\u0000◉◎\u0000▪◻" +
    "\u0000✦★✶✴✹✵\u0000⌖\u0000\u0000" +
    "\u0000✪✰");
  fill(WINGDINGS, 0xd5, "⌫⌦\u0000➢");
  fill(WINGDINGS, 0xe8, "➔");
  fill(WINGDINGS, 0xef,
    "⇦⇨⇧⇩⬄⇳\u0000\u0000\u0000\u0000\u0000" +
    "\u0000✗✓☒☑");

  // Webdings has no settled Unicode table. Its bullets fall back to "•".
  var WEBDINGS = {};

  var TABLES = { symbol: SYMBOL, wingdings: WINGDINGS, webdings: WEBDINGS };

  // Used for every replaced character. The first family covers "•" and "▪";
  // the rest cover arrows and check marks on each platform.
  var SYMBOL_FONT_STACK =
    "Arial, \"Segoe UI Symbol\", \"Apple Symbols\", \"DejaVu Sans\", " +
    "\"Noto Sans Symbols 2\", sans-serif";

  function firstFamily(value) {
    if (typeof value !== "string") {
      return "";
    }
    var first = value.split(",")[0] || "";
    return first.replace(/["']/g, "").trim().toLowerCase();
  }

  function symbolFontKey(fontFamily) {
    var name = firstFamily(fontFamily);
    if (name === "symbol") {
      return "symbol";
    }
    if (/^wingdings( [23])?$/.test(name)) {
      return name === "wingdings" ? "wingdings" : "wingdings-other";
    }
    if (name === "webdings") {
      return "webdings";
    }
    return "";
  }

  function isPrivateUse(code) {
    return code >= 0xf020 && code <= 0xf0ff;
  }

  function hasPrivateUse(text) {
    return /[-]/.test(text || "");
  }

  // Returns the mapped text and whether every symbol character was mapped.
  function mapSymbolText(text, fontKey) {
    var table = TABLES[fontKey] || null;
    var result = "";
    var complete = true;
    var changed = false;
    var chars = Array.from(String(text || ""));
    for (var index = 0; index < chars.length; index += 1) {
      var code = chars[index].codePointAt(0);
      var base = isPrivateUse(code) ? code - 0xf000 : code;
      var symbolic = isPrivateUse(code) || (table !== null && code <= 0xff);
      if (!symbolic) {
        result += chars[index];
        continue;
      }
      var mapped = table ? table[base] : undefined;
      if (mapped === undefined && !table) {
        mapped = SYMBOL[base] === "•" ? "•" : WINGDINGS[base];
      }
      if (mapped === undefined) {
        complete = false;
        result += chars[index];
      } else {
        if (mapped !== chars[index]) {
          changed = true;
        }
        result += mapped;
      }
    }
    return { text: result, complete: complete, changed: changed };
  }

  // Numbering level text such as "\uf0b7" in Symbol. Placeholders like "%1"
  // are kept, and in numbered levels only private-use characters are mapped.
  // A symbol character without a mapping becomes "\u2022", so a list never
  // shows an empty or boxed marker.
  function mapBulletText(levelText, fontKey) {
    var text = String(levelText || "");
    var numbered = /%\d/.test(text);
    var table = TABLES[fontKey] || null;
    return text.split(/(%\d)/).map(function (part) {
      if (/^%\d$/.test(part)) {
        return part;
      }
      return Array.from(part).map(function (char) {
        var code = char.codePointAt(0);
        var privateUse = isPrivateUse(code);
        if (!privateUse && (numbered || !fontKey || code > 0xff)) {
          return char;
        }
        var base = privateUse ? code - 0xf000 : code;
        var mapped;
        if (table) {
          mapped = table[base];
        } else if (!fontKey) {
          mapped = SYMBOL[base] === "\u2022" ? "\u2022" : WINGDINGS[base];
        }
        return mapped === undefined ? "\u2022" : mapped;
      }).join("");
    }).join("");
  }

  // Families that are often missing outside Windows, with metric-compatible
  // or generic fallbacks. The document's own family stays first.
  var FONT_FALLBACKS = {
    "calibri": "Carlito, sans-serif",
    "calibri light": "Carlito, sans-serif",
    "cambria": "Caladea, serif",
    "cambria math": "Caladea, serif",
    "arial": "\"Liberation Sans\", Arimo, Helvetica, sans-serif",
    "helvetica": "\"Liberation Sans\", Arimo, sans-serif",
    "times new roman": "\"Liberation Serif\", Tinos, Times, serif",
    "courier new": "\"Liberation Mono\", Cousine, Courier, monospace",
    "aptos": "sans-serif",
    "aptos display": "sans-serif",
    "segoe ui": "system-ui, sans-serif",
    "verdana": "\"DejaVu Sans\", sans-serif",
    "tahoma": "\"DejaVu Sans\", sans-serif",
    "trebuchet ms": "sans-serif",
    "century gothic": "sans-serif",
    "georgia": "serif",
    "garamond": "serif",
    "book antiqua": "serif",
    "palatino linotype": "Palatino, serif",
    "consolas": "\"DejaVu Sans Mono\", monospace",
    "lucida console": "monospace",
    "traditional arabic": "\"Noto Naskh Arabic\", serif",
    "simplified arabic": "\"Noto Naskh Arabic\", serif",
    "arabic typesetting": "\"Noto Naskh Arabic\", serif",
    "sakkal majalla": "\"Noto Naskh Arabic\", serif",
    "andalus": "serif"
  };

  function withFontFallback(value) {
    if (typeof value !== "string" || !value || /\bvar\(/.test(value) ||
        /(serif|monospace|system-ui)\s*$/.test(value)) {
      return value;
    }
    var fallback = FONT_FALLBACKS[firstFamily(value)];
    return fallback ? value + ", " + fallback : value;
  }

  // Word stores jc="left" and jc="right" relative to the paragraph direction
  // (Transitional "left" is "start"). docx-preview writes physical left and
  // right, which flips right-to-left paragraphs. Logical values fix that and
  // change nothing for left-to-right text.
  function logicalTextAlign(value) {
    if (value === "left") {
      return "start";
    }
    if (value === "right") {
      return "end";
    }
    return value;
  }

  function classifyHref(raw) {
    var href = typeof raw === "string" ? raw.trim() : "";
    if (!href) {
      return { kind: "blocked" };
    }
    if (href.charAt(0) === "#") {
      var anchor = href.slice(1);
      try {
        anchor = decodeURIComponent(anchor);
      } catch (_error) {
        // Keep the raw anchor name.
      }
      return anchor ? { kind: "internal", anchor: anchor } : { kind: "blocked" };
    }
    var parsed;
    try {
      parsed = new URL(href);
    } catch (_error) {
      return { kind: "blocked" };
    }
    var scheme = parsed.protocol.toLowerCase();
    if ((scheme === "http:" || scheme === "https:") && parsed.hostname) {
      return { kind: "external", href: parsed.href };
    }
    if (scheme === "mailto:" && href.length > 7) {
      return { kind: "external", href: href };
    }
    return { kind: "blocked" };
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function eachModelElement(rootElements, visit) {
    var stack = [];
    for (var index = rootElements.length - 1; index >= 0; index -= 1) {
      if (rootElements[index]) {
        stack.push(rootElements[index]);
      }
    }
    while (stack.length) {
      var element = stack.pop();
      visit(element);
      var children = element.children;
      if (Array.isArray(children)) {
        for (var child = children.length - 1; child >= 0; child -= 1) {
          if (children[child] && typeof children[child] === "object") {
            stack.push(children[child]);
          }
        }
      }
    }
  }

  // docx-preview's block grammar: the body holds p, tbl, and sdt (whose
  // sdtContent is read like the body); a table holds tr, a row holds tc, and a
  // cell holds p and tbl. The model lists paragraphs and tables in exactly
  // this order, which lets the XML and the model be paired one to one.
  function xmlBlocks(container, inCell, paragraphs, tables) {
    var children = container ? container.children || [] : [];
    for (var index = 0; index < children.length; index += 1) {
      var element = children[index];
      var name = element.localName;
      if (name === "p") {
        paragraphs.push(element);
      } else if (name === "tbl") {
        tables.push(element);
        var rows = element.children || [];
        for (var row = 0; row < rows.length; row += 1) {
          if (rows[row].localName !== "tr") {
            continue;
          }
          var cells = rows[row].children || [];
          for (var cell = 0; cell < cells.length; cell += 1) {
            if (cells[cell].localName === "tc") {
              xmlBlocks(cells[cell], true, paragraphs, tables);
            }
          }
        }
      } else if (name === "sdt" && !inCell) {
        var content = childNamed(element, "sdtContent");
        if (content) {
          xmlBlocks(content, false, paragraphs, tables);
        }
      }
    }
  }

  function modelBlocks(children, paragraphs, tables) {
    for (var index = 0; index < (children || []).length; index += 1) {
      var element = children[index];
      if (!element) {
        continue;
      }
      if (element.type === "paragraph") {
        paragraphs.push(element);
      } else if (element.type === "table") {
        tables.push(element);
        (element.children || []).forEach(function (row) {
          (row.children || []).forEach(function (cell) {
            modelBlocks(cell.children, paragraphs, tables);
          });
        });
      }
    }
  }

  function childNamed(element, localName) {
    var children = element.children || [];
    for (var index = 0; index < children.length; index += 1) {
      if (children[index].localName === localName) {
        return children[index];
      }
    }
    return null;
  }

  function getAttr(element, localName) {
    if (!element || !element.attributes) {
      return null;
    }
    for (var index = 0; index < element.attributes.length; index += 1) {
      var attribute = element.attributes[index];
      if ((attribute.localName || attribute.name) === localName) {
        return attribute.value;
      }
    }
    return null;
  }

  function isOn(element) {
    var value = getAttr(element, "val");
    return value === null || !/^(0|false|off)$/i.test(value);
  }

  // The core's paragraph index: every w:p under the body in document order,
  // table cells included, text box content excluded.
  function coreParagraphIndexes(body) {
    var indexes = new Map();
    var next = 0;
    (function visit(element) {
      var children = element.children || [];
      for (var index = 0; index < children.length; index += 1) {
        var child = children[index];
        if (child.localName === "txbxContent") {
          continue;
        }
        if (child.localName === "p") {
          indexes.set(child, next);
          next += 1;
        }
        visit(child);
      }
    }(body));
    return indexes;
  }

  function addClass(element, className) {
    element.className = element.className
      ? element.className + " " + className
      : className;
  }

  // Pairs body paragraphs and tables of the parsed model with the XML so that
  // each rendered paragraph carries the core's index (class ld-pi-N) and each
  // table with w:bidiVisual carries ld-bidi-visual.
  function annotateBody(modelBody, xmlBody) {
    var modelParagraphs = [];
    var modelTables = [];
    modelBlocks(modelBody ? modelBody.children : [], modelParagraphs, modelTables);
    var result = {
      paragraphs: modelParagraphs.length,
      paired: false,
      bidiVisualTables: 0
    };
    var xmlParagraphs = [];
    var xmlTables = [];
    if (xmlBody) {
      xmlBlocks(xmlBody, false, xmlParagraphs, xmlTables);
    }
    var indexes = xmlBody ? coreParagraphIndexes(xmlBody) : null;
    result.paired = !!indexes && xmlParagraphs.length === modelParagraphs.length;
    modelParagraphs.forEach(function (paragraph, position) {
      var index = result.paired ? indexes.get(xmlParagraphs[position]) : position;
      addClass(paragraph, "ld-p ld-pi-" + index);
    });
    if (xmlTables.length === modelTables.length) {
      xmlTables.forEach(function (table, position) {
        var properties = childNamed(table, "tblPr");
        var bidi = properties && childNamed(properties, "bidiVisual");
        if (bidi && isOn(bidi)) {
          addClass(modelTables[position], "ld-bidi-visual");
          result.bidiVisualTables += 1;
        }
      });
    }
    return result;
  }

  function mapNumberFormat(format) {
    if (format === "hindiNumbers") {
      return "arabic-indic";
    }
    if (format === "arabicAlpha") {
      return "ld-arabic-alpha";
    }
    if (format === "arabicAbjad") {
      return "ld-arabic-abjad";
    }
    return format;
  }

  function fixStyleValues(values, target) {
    if (!values) {
      return;
    }
    if (values["font-family"]) {
      values["font-family"] = withFontFallback(values["font-family"]);
    }
    if (target !== "table" && values["text-align"]) {
      values["text-align"] = logicalTextAlign(values["text-align"]);
    }
  }

  function fixRun(run, stats) {
    var style = run.cssStyle || {};
    var key = symbolFontKey(style["font-family"]);
    if (key) {
      var complete = true;
      var texts = (run.children || []).filter(function (child) {
        return child && child.type === "text";
      });
      var mapped = texts.map(function (child) {
        var result = mapSymbolText(child.text, key);
        complete = complete && result.complete;
        return result.text;
      });
      if (complete) {
        texts.forEach(function (child, index) {
          child.text = mapped[index];
        });
        style["font-family"] = SYMBOL_FONT_STACK;
        stats.symbols += texts.length;
        return;
      }
    }
    if (style["font-family"]) {
      style["font-family"] = withFontFallback(style["font-family"]);
    }
  }

  function fixSymbolElement(element, stats) {
    var key = symbolFontKey(element.font);
    var code = Number(element.char);
    if (!key && !isPrivateUse(code)) {
      return;
    }
    var mapped = mapSymbolText(String.fromCharCode(code), key);
    if (mapped.complete && mapped.text.length === 1) {
      element.char = mapped.text.charCodeAt(0);
      element.font = SYMBOL_FONT_STACK;
      stats.symbols += 1;
    }
  }

  var EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  // Images resolve only to blob: or data: URLs. A relationship whose target
  // is missing from the package would otherwise leave src="null", which the
  // web runtime requests from the app origin. Fonts and imported HTML chunks
  // are never loaded.
  function guardResources(doc) {
    if (!doc || doc.leandocGuarded) {
      return;
    }
    doc.leandocGuarded = true;
    ["loadDocumentImage", "loadNumberingImage"].forEach(function (name) {
      var original = doc[name];
      if (typeof original !== "function") {
        return;
      }
      doc[name] = function () {
        var pending;
        try {
          pending = Promise.resolve(original.apply(doc, arguments));
        } catch (_error) {
          pending = Promise.resolve(null);
        }
        return pending.then(function (url) {
          return typeof url === "string" && /^(blob:|data:image\/)/.test(url) ? url : EMPTY_IMAGE;
        }, function () {
          return EMPTY_IMAGE;
        });
      };
    });
    doc.loadFont = function () {
      return Promise.resolve(null);
    };
    doc.loadAltChunk = function () {
      return Promise.resolve("");
    };
  }

  // Runs on docx-preview's parsed model before it renders. Changing the model
  // is more robust than patching the generated CSS text: numbering, symbol
  // runs, and fonts are typed fields here, and the renderer escapes them.
  function prepareModel(doc) {
    var stats = { bullets: 0, symbols: 0, paragraphs: 0, paired: false, bidiVisualTables: 0 };
    if (!doc) {
      return stats;
    }
    guardResources(doc);
    var numberings = doc.numberingPart && doc.numberingPart.domNumberings;
    (numberings || []).forEach(function (numbering) {
      numbering.format = mapNumberFormat(numbering.format);
      var rStyle = numbering.rStyle || (numbering.rStyle = {});
      if (typeof numbering.levelText === "string") {
        var key = symbolFontKey(rStyle["font-family"]);
        if (key || hasPrivateUse(numbering.levelText)) {
          numbering.levelText = mapBulletText(numbering.levelText, key);
          rStyle["font-family"] = SYMBOL_FONT_STACK;
          stats.bullets += 1;
        } else if (rStyle["font-family"]) {
          rStyle["font-family"] = withFontFallback(rStyle["font-family"]);
        }
      }
      fixStyleValues(numbering.pStyle, "p");
    });

    var styles = doc.stylesPart && doc.stylesPart.styles;
    (styles || []).forEach(function (style) {
      (style.styles || []).forEach(function (entry) {
        fixStyleValues(entry.values, entry.target);
      });
    });

    // docDefaults run fonts apply to spans only. Paragraphs take them too, so
    // list markers and empty paragraphs use the document's font, not the
    // reader's.
    var defaults = (styles || []).filter(function (style) {
      return style && !style.id && !style.target && Array.isArray(style.styles);
    })[0];
    if (defaults) {
      var runDefaults = defaults.styles.filter(function (entry) {
        return entry.target === "span";
      })[0];
      var paragraphDefaults = defaults.styles.filter(function (entry) {
        return entry.target === "p";
      })[0];
      if (runDefaults && runDefaults.values) {
        if (!paragraphDefaults) {
          paragraphDefaults = { target: "p", values: {} };
          defaults.styles.push(paragraphDefaults);
        }
        paragraphDefaults.values = paragraphDefaults.values || {};
        ["font-family", "font-size"].forEach(function (name) {
          if (runDefaults.values[name] && !paragraphDefaults.values[name]) {
            paragraphDefaults.values[name] = runDefaults.values[name];
          }
        });
      }
    }

    var fontScheme = doc.themePart && doc.themePart.theme &&
      doc.themePart.theme.fontScheme;
    if (fontScheme) {
      ["majorFont", "minorFont"].forEach(function (name) {
        var font = fontScheme[name];
        if (font && font.latinTypeface) {
          font.latinTypeface = withFontFallback(font.latinTypeface);
        }
      });
    }

    var roots = [];
    if (doc.documentPart && doc.documentPart.body) {
      roots.push(doc.documentPart.body);
    }
    (doc.parts || []).forEach(function (part) {
      if (part && part.rootElement) {
        roots.push(part.rootElement);
      }
    });
    [doc.footnotesPart, doc.endnotesPart].forEach(function (part) {
      if (part && Array.isArray(part.notes)) {
        roots.push.apply(roots, part.notes);
      }
    });
    eachModelElement(roots, function (element) {
      if (element.type === "paragraph" && element.cssStyle &&
          element.cssStyle["text-align"]) {
        element.cssStyle["text-align"] = logicalTextAlign(element.cssStyle["text-align"]);
      } else if (element.type === "run") {
        fixRun(element, stats);
      } else if (element.type === "symbol") {
        fixSymbolElement(element, stats);
      }
    });

    var xmlDocument = doc.documentPart && doc.documentPart._xmlDocument;
    var xmlRoot = xmlDocument && (xmlDocument.documentElement || xmlDocument.firstElementChild);
    var xmlBody = xmlRoot ? childNamed(xmlRoot, "body") : null;
    var annotation = annotateBody(doc.documentPart && doc.documentPart.body, xmlBody);
    stats.paragraphs = annotation.paragraphs;
    stats.paired = annotation.paired;
    stats.bidiVisualTables = annotation.bidiVisualTables;

    // keepOrigin kept the XML only for the pairing above.
    (doc.parts || []).forEach(function (part) {
      if (part) {
        delete part._xmlDocument;
      }
    });
    return stats;
  }

  return Object.freeze({
    SYMBOL: SYMBOL,
    WINGDINGS: WINGDINGS,
    SYMBOL_FONT_STACK: SYMBOL_FONT_STACK,
    symbolFontKey: symbolFontKey,
    hasPrivateUse: hasPrivateUse,
    mapSymbolText: mapSymbolText,
    mapBulletText: mapBulletText,
    withFontFallback: withFontFallback,
    logicalTextAlign: logicalTextAlign,
    mapNumberFormat: mapNumberFormat,
    classifyHref: classifyHref,
    normalizeText: normalizeText,
    annotateBody: annotateBody,
    guardResources: guardResources,
    EMPTY_IMAGE: EMPTY_IMAGE,
    coreParagraphIndexes: coreParagraphIndexes,
    prepareModel: prepareModel
  });
}));
