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

  // Rebuilds a mailto link from its addresses and only the subject, body, cc,
  // and bcc parameters, so parameters such as attach= never reach a mail
  // client. The hosts apply the same rule (src/core/Links.h).
  var MAILTO_PARAMETERS = ["subject", "body", "cc", "bcc"];

  // Percent-encodes what the URL parser leaves raw in an opaque path but the
  // hosts refuse: spaces, controls, non-ASCII, quotes, backslashes, angle
  // brackets, and backticks.
  function encodeForHost(text) {
    return text.replace(/[\u0000-\u0020\u007f-\uffff"\\<>`]/g, function (character) {
      try {
        return encodeURIComponent(character);
      } catch (_error) {
        return "";
      }
    });
  }

  function cleanMailto(parsed) {
    var serialized = parsed.href;
    var rest = serialized.slice("mailto:".length).split("#")[0];
    var question = rest.indexOf("?");
    var addresses = question < 0 ? rest : rest.slice(0, question);
    var kept = [];
    var recipient = addresses.length > 0;
    if (question >= 0) {
      rest.slice(question + 1).split("&").forEach(function (pair) {
        var equals = pair.indexOf("=");
        var key = (equals < 0 ? pair : pair.slice(0, equals)).toLowerCase();
        if (MAILTO_PARAMETERS.indexOf(key) < 0) {
          return;
        }
        if ((key === "cc" || key === "bcc") && equals >= 0 && pair.length > equals + 1) {
          recipient = true;
        }
        kept.push(pair);
      });
    }
    if (!recipient) {
      return "";
    }
    return encodeForHost("mailto:" + addresses + (kept.length ? "?" + kept.join("&") : ""));
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
    if (scheme === "mailto:") {
      var mail = cleanMailto(parsed);
      return mail ? { kind: "external", href: mail } : { kind: "blocked" };
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
  // table cells included, text box content and mc:Fallback content excluded.
  function coreParagraphIndexes(body) {
    var indexes = new Map();
    var next = 0;
    (function visit(element) {
      var children = element.children || [];
      for (var index = 0; index < children.length; index += 1) {
        var child = children[index];
        if (child.localName === "txbxContent" || child.localName === "Fallback") {
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

  var BORDER_STYLES = {
    dashed: "dashed", dashSmallGap: "dashed", dotted: "dotted", dotDash: "dotted",
    dotDotDash: "dotted", double: "double", triple: "double", doubleWave: "double",
    inset: "inset", outset: "outset"
  };

  function cssBorder(element) {
    var type = getAttr(element, "val");
    if (!type || type === "nil" || type === "none") {
      return "none";
    }
    var size = parseInt(getAttr(element, "sz"), 10);
    var color = getAttr(element, "color");
    return (size > 0 ? size / 8 : 0.5) + "pt " + (BORDER_STYLES[type] || "solid") + " " +
      (color && /^[0-9a-f]{6}$/i.test(color) ? "#" + color : "black");
  }

  function modelChildren(element, type) {
    return (element.children || []).filter(function (child) {
      return child && child.type === type;
    });
  }

  // The grid column each cell of a row starts at.
  function cellColumns(row) {
    var column = row.gridBefore || 0;
    return modelChildren(row, "cell").map(function (cell) {
      var start = column;
      column += cell.span || 1;
      return start;
    });
  }

  // The last row a cell covers, following a vertical merge down.
  function lastMergedRow(rows, columns, from, column) {
    var last = from;
    for (var row = from + 1; row < rows.length; row += 1) {
      var cells = modelChildren(rows[row], "cell");
      var at = columns[row].indexOf(column);
      var cell = at >= 0 ? cells[at] : null;
      if (!cell || !cell.verticalMerge || cell.verticalMerge === "restart") {
        break;
      }
      last = row;
    }
    return last;
  }

  // docx-preview copies a table's own borders (w:tblBorders) to every cell
  // and reads no inside borders, so a table ruled only above, below, and
  // under its header printed a rule under every row. Word draws the top
  // border above the first row, the bottom one below the last, the left and
  // right ones on the outer columns, and insideH and insideV between cells.
  // A cell's own borders still win.
  function placeTableBorders(table, properties) {
    var borders = properties && childNamed(properties, "tblBorders");
    if (!borders || !table.cellStyle) {
      return false;
    }
    var edge = {};
    ["top", "bottom", "left", "right", "start", "end", "insideH", "insideV"].forEach(function (name) {
      var element = childNamed(borders, name);
      if (element) {
        edge[name] = cssBorder(element);
      }
    });
    edge.left = edge.left || edge.start;
    edge.right = edge.right || edge.end;
    ["border-top", "border-bottom", "border-left", "border-right"].forEach(function (name) {
      delete table.cellStyle[name];
    });
    var rows = modelChildren(table, "row");
    var columns = rows.map(cellColumns);
    rows.forEach(function (row, rowIndex) {
      var cells = modelChildren(row, "cell");
      cells.forEach(function (cell, cellIndex) {
        var style = cell.cssStyle || (cell.cssStyle = {});
        var bottomRow = lastMergedRow(rows, columns, rowIndex, columns[rowIndex][cellIndex]);
        var sides = {
          "border-top": rowIndex === 0 ? edge.top : edge.insideH,
          "border-bottom": bottomRow === rows.length - 1 ? edge.bottom : edge.insideH,
          "border-left": cellIndex === 0 ? edge.left : edge.insideV,
          "border-right": cellIndex === cells.length - 1 ? edge.right : edge.insideV
        };
        Object.keys(sides).forEach(function (name) {
          if (sides[name] && !style[name]) {
            style[name] = sides[name];
          }
        });
      });
    });
    return true;
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
      bidiVisualTables: 0,
      borderedTables: 0
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
        // A right-to-left table keeps docx-preview's borders: which of its
        // sides w:left names has not been checked against Word.
        if (bidi && isOn(bidi)) {
          addClass(modelTables[position], "ld-bidi-visual");
          result.bidiVisualTables += 1;
        } else if (placeTableBorders(modelTables[position], properties)) {
          result.borderedTables += 1;
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

  // Word's "single" line spacing is the font's own line height: Word prints
  // 10 pt Times New Roman single spaced at 11.52 pt, and Arial the same.
  // docx-preview writes w:lineRule="auto" spacing as a plain multiple of the
  // font size, so single spacing printed 13 percent tighter than Word and a
  // paper fit on fewer pages. Multiples scale that single line instead.
  // line-height: normal would follow each font, but Chrome rounds the
  // font's ascent and descent to whole pixels: 16 px lines for 10 pt Times.
  var SINGLE_LINE = 1.152;

  function wordLineHeight(value) {
    if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value.trim())) {
      return value;
    }
    return String(Math.round(parseFloat(value) * SINGLE_LINE * 1000) / 1000);
  }

  function fixStyleValues(values, target) {
    if (!values) {
      return;
    }
    if (values["line-height"]) {
      values["line-height"] = wordLineHeight(values["line-height"]);
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
  // docx-preview 0.4.1 renders the children of a run with direct
  // superscript or subscript (w:vertAlign) twice and keeps the second copy.
  // A footnote or endnote reference counts itself on every render, so such
  // a reference was numbered one too high and its note listed twice. The
  // reference already renders as <sup>, so the run's own vertical alignment
  // is dropped and its children render once.
  function fixNoteReferenceRun(run, stats) {
    if (!run.verticalAlign || !Array.isArray(run.children)) {
      return;
    }
    var hasReference = run.children.some(function (child) {
      return child && (child.type === "footnoteReference" || child.type === "endnoteReference");
    });
    if (hasReference) {
      delete run.verticalAlign;
      stats.noteReferences += 1;
    }
  }

  // Word prints a footnote at the foot of the page that refers to it.
  // docx-preview renders the reference as a bare <sup> and the note as an
  // <li> of its page, so both get a bookmark the reader can find when it
  // splits pages (reader.js placeNotes).
  var NOTE_REFERENCE_ANCHOR = "ld-fnref-";
  var NOTE_ANCHOR = "ld-fn-";

  function markNoteReferences(run) {
    if (!Array.isArray(run.children)) {
      return;
    }
    for (var index = run.children.length - 1; index >= 0; index -= 1) {
      var child = run.children[index];
      if (child && child.type === "footnoteReference" && child.id !== undefined) {
        run.children.splice(index, 0, { type: "bookmarkStart", name: NOTE_REFERENCE_ANCHOR + child.id });
      }
    }
  }

  function markNotes(part) {
    (part && Array.isArray(part.notes) ? part.notes : []).forEach(function (note) {
      if (note && note.id !== undefined && Array.isArray(note.children)) {
        note.children.unshift({ type: "bookmarkStart", name: NOTE_ANCHOR + note.id });
      }
    });
  }

  // PAGE, NUMPAGES, and SECTIONPAGES fields differ on every page, but
  // docx-preview shows the result Word cached once, and it renders the same
  // header and footer model on every page, so every footer read "page 1".
  // Their result text becomes a marker that the reader replaces with the
  // page's own number once the pages exist (reader.js numberPageFields).
  var PAGE_FIELD_START = "\ue000";
  var PAGE_FIELD_END = "\ue001";

  function pageFieldKeyword(instruction) {
    var match = /^\s*([A-Za-z]+)/.exec(instruction || "");
    var word = match ? match[1].toUpperCase() : "";
    return word === "PAGE" || word === "NUMPAGES" || word === "SECTIONPAGES" ? word : "";
  }

  function paragraphRuns(paragraph) {
    var runs = [];
    eachModelElement(paragraph.children || [], function (element) {
      if (element.type === "run") {
        runs.push(element);
      }
    });
    return runs;
  }

  function markPageFields(paragraph, stats) {
    var fields = [];
    paragraphRuns(paragraph).forEach(function (run) {
      var children = Array.isArray(run.children) ? run.children : [];
      if (run.fieldRun) {
        children.forEach(function (child) {
          if (child.type === "complexField" && child.charType === "begin") {
            fields.push({ instruction: "", result: false, marked: false });
          } else if (child.type === "complexField" && child.charType === "separate" && fields.length) {
            fields[fields.length - 1].result = true;
          } else if (child.type === "complexField" && child.charType === "end") {
            fields.pop();
          } else if (child.type === "instruction" && fields.length) {
            fields[fields.length - 1].instruction += child.text || "";
          }
        });
        return;
      }
      var field = fields[fields.length - 1];
      var keyword = field && field.result ? pageFieldKeyword(field.instruction) : "";
      if (!keyword) {
        return;
      }
      children.forEach(function (child) {
        if (child.type !== "text") {
          return;
        }
        if (field.marked) {
          child.text = "";
          return;
        }
        child.text = PAGE_FIELD_START + keyword + ":" + String(child.text || "") + PAGE_FIELD_END;
        field.marked = true;
        stats.pageFields += 1;
      });
    });
  }

  // Replaces each marker in `text` with the number for its page; the cached
  // value stays when a number is unknown.
  function fillPageFields(text, pageNumber, pageCount) {
    return String(text).replace(/\ue000(PAGE|NUMPAGES|SECTIONPAGES):([^\ue001]*)\ue001/g,
      function (_match, keyword, cached) {
        var value = keyword === "PAGE" ? pageNumber : pageCount;
        return value > 0 ? String(value) : cached;
      });
  }

  // A table of automatic width whose cells set no width is fitted to its
  // content by Word: pandoc writes equal grid columns, and Word prints a
  // narrow "Dimension" column beside wide description columns. docx-preview
  // fixed every column at the grid width, which wrapped the long cells and
  // made such a table twice as tall. Without the grid widths the browser
  // fits the columns to the content, as Word does.
  function fitAutoTable(table) {
    var style = table.cssStyle || {};
    if (!Array.isArray(table.columns) || (style.width && style.width !== "auto") ||
        style["table-layout"] === "fixed") {
      return false;
    }
    var sized = (table.children || []).some(function (row) {
      return row && row.type === "row" && (row.children || []).some(function (cell) {
        return cell && cell.type === "cell" && cell.cssStyle && cell.cssStyle.width;
      });
    });
    if (sized) {
      return false;
    }
    delete table.columns;
    return true;
  }

  var SILENT_TYPES =/^(run|bookmarkStart|bookmarkEnd|commentRangeStart|commentRangeEnd)$/;

  function isEmptyParagraph(paragraph) {
    if (paragraph.numbering) {
      return false;
    }
    var empty = true;
    eachModelElement(paragraph.children || [], function (element) {
      if (element.type === "text") {
        empty = empty && !element.text;
      } else if (!SILENT_TYPES.test(element.type || "")) {
        empty = false;
      }
    });
    return empty;
  }

  // Word gives no height to an empty paragraph that only carries the break
  // into a continuous section: in Word's own PDF of a pandoc-style paper the
  // heading after the title, the table after a two-column section, and the
  // text after the table sit where they would without it. docx-preview drew
  // a blank line for each, and pandoc writes one at every section break.
  function hideSectionBreakParagraphs(body) {
    var breaks = ((body && body.children) || []).filter(function (block) {
      return block && block.type === "paragraph" && block.sectionProps;
    });
    var hidden = 0;
    breaks.forEach(function (paragraph, index) {
      var next = index + 1 < breaks.length ? breaks[index + 1].sectionProps : body.props;
      if (next && next.type === "continuous" && isEmptyParagraph(paragraph)) {
        paragraph.cssStyle = paragraph.cssStyle || {};
        paragraph.cssStyle.display = "none";
        hidden += 1;
      }
    });
    return hidden;
  }

  // Word hyphenates only when the document turns on automatic hyphenation;
  // docx-preview's own style sheet hyphenates every document. An empty
  // <w:autoHyphenation/> reads as null and means on.
  function documentHyphenates(doc) {
    var settings = doc.settingsPart && doc.settingsPart.settings;
    return !!settings && Object.prototype.hasOwnProperty.call(settings, "autoHyphenation") &&
      settings.autoHyphenation !== false;
  }

  function prepareModel(doc) {
    var stats = { bullets: 0, symbols: 0, paragraphs: 0, paired: false, bidiVisualTables: 0,
      noteReferences: 0, pageFields: 0, autoHyphenation: false, sectionBreakParagraphs: 0, fittedTables: 0 };
    if (!doc) {
      return stats;
    }
    stats.autoHyphenation = documentHyphenates(doc);
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

    // docx-preview adds a style's linked style to its rules, so a heading
    // took the run size of its "Heading 1 Char" style (20 pt in pandoc's
    // reference document) over its own 10 pt. Word applies the linked
    // character style only to runs that name it, never to the paragraphs of
    // the paragraph style, so paragraph styles drop the link.
    var styles = doc.stylesPart && doc.stylesPart.styles;
    (styles || []).forEach(function (style) {
      if (style && style.target === "p" && style.linked) {
        style.linked = null;
      }
      (style.styles || []).forEach(function (entry) {
        fixStyleValues(entry.values, entry.target);
        // suppressAutoHyphens="0" only allows the document's hyphenation.
        if (entry.values && entry.values.hyphens === "auto" && !stats.autoHyphenation) {
          delete entry.values.hyphens;
        }
      });
    });

    // Word spaces a line by the text on it. In CSS every line of a paragraph
    // is also as tall as the paragraph's own font, and a style's run size
    // reaches only its spans, so a 9 pt abstract in a 10 pt document was
    // spaced as 10 pt and ran two lines longer than Word's. A paragraph style
    // that sets a run size gives it to its paragraphs too. A style without a
    // run size takes both sizes from its base style.
    (styles || []).forEach(function (style) {
      if (!style || style.target !== "p" || !Array.isArray(style.styles)) {
        return;
      }
      var run = style.styles.filter(function (entry) {
        return entry.target === "span" && entry.values && entry.values["font-size"];
      })[0];
      if (!run) {
        return;
      }
      var own = style.styles.filter(function (entry) {
        return entry.target === "p";
      })[0];
      if (!own) {
        own = { target: "p", values: {} };
        style.styles.push(own);
      }
      own.values = own.values || {};
      if (!own.values["font-size"]) {
        own.values["font-size"] = run.values["font-size"];
      }
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
    // A paragraph that names no style is in the default paragraph style.
    // docx-preview writes that style's run rules as ".docx p, p.<style> span",
    // so the text of such a paragraph matched only the docDefaults rule for
    // spans: body text in a pandoc document printed at 12 pt, not Normal's 10.
    // Naming the style gives the paragraph its class, and its runs the rule.
    var defaultParagraph = (styles || []).filter(function (style) {
      return style && style.target === "p" && style.isDefault && style.id;
    })[0];
    eachModelElement(roots, function (element) {
      if (element.type === "paragraph") {
        if (!element.styleName && defaultParagraph) {
          element.styleName = defaultParagraph.id;
        }
        if (element.cssStyle && element.cssStyle.hyphens === "auto" && !stats.autoHyphenation) {
          delete element.cssStyle.hyphens;
        }
        if (element.cssStyle && element.cssStyle["line-height"]) {
          element.cssStyle["line-height"] = wordLineHeight(element.cssStyle["line-height"]);
        }
        if (element.cssStyle && element.cssStyle["text-align"]) {
          element.cssStyle["text-align"] = logicalTextAlign(element.cssStyle["text-align"]);
        }
        markPageFields(element, stats);
      } else if (element.type === "run") {
        fixRun(element, stats);
        fixNoteReferenceRun(element, stats);
        markNoteReferences(element);
      } else if (element.type === "symbol") {
        fixSymbolElement(element, stats);
      } else if (element.type === "table" && fitAutoTable(element)) {
        stats.fittedTables += 1;
      }
    });

    var xmlDocument = doc.documentPart && doc.documentPart._xmlDocument;
    var xmlRoot = xmlDocument && (xmlDocument.documentElement || xmlDocument.firstElementChild);
    var xmlBody = xmlRoot ? childNamed(xmlRoot, "body") : null;
    var annotation = annotateBody(doc.documentPart && doc.documentPart.body, xmlBody);
    stats.paragraphs = annotation.paragraphs;
    stats.paired = annotation.paired;
    stats.bidiVisualTables = annotation.bidiVisualTables;
    stats.borderedTables = annotation.borderedTables;
    markNotes(doc.footnotesPart);
    stats.sectionBreakParagraphs = hideSectionBreakParagraphs(doc.documentPart && doc.documentPart.body);

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
    fillPageFields: fillPageFields,
    PAGE_FIELD_START: PAGE_FIELD_START,
    NOTE_REFERENCE_ANCHOR: NOTE_REFERENCE_ANCHOR,
    NOTE_ANCHOR: NOTE_ANCHOR,
    normalizeText: normalizeText,
    annotateBody: annotateBody,
    guardResources: guardResources,
    EMPTY_IMAGE: EMPTY_IMAGE,
    coreParagraphIndexes: coreParagraphIndexes,
    prepareModel: prepareModel
  });
}));
