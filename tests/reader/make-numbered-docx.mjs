// Builds, at test time, a one-page document with the numbered headings of the
// IEEE template and the fields and stops around them:
// - Heading 1 and Heading 2 take their numbers from their styles (w:numPr in
//   the style). Level 0 prints "I." centred on its indent (w:lvlJc
//   "center") with a stop at 28.8 pt; the Heading 1 style sets its own first
//   line indent of 0 and a left stop at 10.8 pt. Level 1 prints "A." at a
//   14.4 pt hanging indent with a stop at 18 pt, which the Heading 2 style
//   clears, setting its own at 14.4 pt. Each heading's text starts with a
//   tab of its own. Word starts a Heading 1's text 28.8 pt from the margin
//   and a Heading 2's 36 pt from it.
// - A contents line whose right indent is 72 pt and whose dotted right stop
//   sits at 450 pt, 54 pt past that indent. Word keeps it on one line.
// - A header whose PAGE field keeps its result's 7 pt (\* MERGEFORMAT), and a
//   footer whose PAGE field does not: Word prints that one at the 10 pt of
//   its field code.
// All text is made up. Returns bytes and a report.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/>
<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:ind w:firstLine="200"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:numPr><w:numId w:val="1"/></w:numPr><w:tabs><w:tab w:val="left" w:pos="216"/></w:tabs><w:spacing w:before="160" w:after="80"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:smallCaps/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr><w:tabs><w:tab w:val="clear" w:pos="360"/><w:tab w:val="num" w:pos="288"/></w:tabs><w:spacing w:before="120" w:after="60"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs><w:ind w:right="1440" w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:pStyle w:val="Heading1"/><w:lvlText w:val="%1."/><w:lvlJc w:val="center"/>
<w:pPr><w:tabs><w:tab w:val="num" w:pos="576"/></w:tabs><w:ind w:firstLine="216"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:pStyle w:val="Heading2"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/>
<w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="288" w:hanging="288"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

function pageField(part, style, instruction, indent = "") {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${part} xmlns:w="${W}"><w:p><w:pPr><w:pStyle w:val="${style}"/>${indent}<w:jc w:val="right"/></w:pPr>
<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:${part}>`;
}

const WORDS = ("signal channel buffer packet stream latency cache vector kernel tensor " +
  "message router switch memory thread fabric anchor ledger beacon harbor").split(" ");

function words(seed, count) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    out.push(WORDS[(seed * 7 + index * 13) % WORDS.length]);
  }
  return out.join(" ");
}

function heading(text, style) {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:tab/><w:t>${text}</w:t></w:r></w:p>`;
}

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

// With `morePages`, that many one-paragraph pages follow, each after a page
// break. docx-preview makes a section of each page, and a document of more
// than 60 sections opens in batches (reader.js PROGRESSIVE_PAGES).
export async function makeNumberedDocx({ offPage = false, morePages = 0 } = {}) {
  const body = [];
  body.push(`<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t xml:space="preserve">Contents line heron about ${words(1, 9)}</w:t></w:r>` +
    `<w:r><w:tab/><w:t>12</w:t></w:r></w:p>`);
  body.push(heading("Introduction", "Heading1"));
  body.push(paragraph(`Lead para. ${words(2, 40)}.`));
  ["Alpha Part", "Beta Part", "Gamma Part", "Delta Part"].forEach((title, index) => {
    body.push(heading(title, "Heading2"));
    body.push(paragraph(`Part para ${index + 1}. ${words(index + 3, 30)}.`));
  });
  body.push(heading("Method", "Heading1"));
  body.push(paragraph(`Method para. ${words(9, 30)}.`));
  for (let index = 1; index <= morePages; index += 1) {
    body.push(`<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve">Later page ${index}. ${words(index, 20)}.</w:t></w:r></w:p>`);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/>
<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS, options);
  zip.file("word/styles.xml", STYLES, options);
  zip.file("word/settings.xml", SETTINGS, options);
  zip.file("word/numbering.xml", NUMBERING, options);
  // offPage: the header's right indent is -108 pt, 36 pt past the paper's
  // edge, so its right-aligned number is off the page. Word prints none.
  const indent = offPage ? `<w:ind w:right="-2160" w:firstLine="0"/>` : "";
  zip.file("word/header1.xml", pageField("hdr", "Header", " PAGE   \\* MERGEFORMAT ", indent), options);
  zip.file("word/footer1.xml", pageField("ftr", "Footer", " PAGE "), options);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    bytes,
    report: {
      ok: true,
      errorCode: "",
      errorMessage: "",
      kind: "docx",
      sourceBytes: bytes.length,
      features: [],
      outline: [],
      properties: { title: "", creator: "", rightToLeft: false }
    }
  };
}

// A two-column page whose left column holds two display equations wider
// than the column: a flat run of names with subscripts, separated by commas,
// as Word's equation editor writes a set. The second sits in a borderless
// table of two cells, the equation and its number, as a paper template sets
// numbered equations. Word breaks both after commas and keeps them in the
// column. A sum and a quotient follow, which Word breaks before their
// operators. The long paragraph after them fills the left column and goes on
// at the top of the right one, beside the equations.
const MATH = "http://schemas.openxmlformats.org/officeDocument/2006/math";

function mathRun(text) {
  return `<m:r><m:t xml:space="preserve">${text}</m:t></m:r>`;
}

function subscript(base, sub) {
  return `<m:sSub><m:e>${mathRun(base)}</m:e><m:sub>${mathRun(sub)}</m:sub></m:sSub>`;
}

// With `morePages`, that many one-paragraph pages follow after page breaks,
// so the document opens in batches as makeNumberedDocx's does.
export async function makeEquationDocx({ morePages = 0 } = {}) {
  const equation = mathRun("Kinds = {Alph") + subscript("a", "north") + mathRun(", Bet") + subscript("a", "south") +
    mathRun(", Gamm") + subscript("a", "east") + mathRun(", Delt") + subscript("a", "west") +
    mathRun(",  Rho, Sigma,  Omeg") + subscript("a", "upper") + mathRun(",  Omeg") + subscript("a", "lower") +
    mathRun(", Kapp") + subscript("a", "GenericMember") + mathRun("}");
  const body = [];
  body.push(paragraph(`Left lead para. ${words(3, 45)}.`));
  const display = `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>${equation}</m:oMath></m:oMathPara></w:p>`;
  const none = ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`).join("");
  const cell = (width, content) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc>`;
  body.push(display);
  body.push(paragraph(`Left middle para. ${words(4, 20)}.`));
  const numbered = (content, number, [left, right] = [3960, 360], fixed = false) => `<w:tbl><w:tblPr>${fixed ? `<w:tblW w:w="${left + right}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` : `<w:tblW w:w="0" w:type="auto"/>`}<w:tblBorders>${none}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="${left}"/><w:gridCol w:w="${right}"/></w:tblGrid><w:tr>` +
    cell(left, content) + cell(right, `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="right"/></w:pPr><w:r><w:t>(${number})</w:t></w:r></w:p>`) + "</w:tr></w:tbl>";
  const centred = (math) => `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>${math}</m:oMath></m:oMathPara></w:p>`;
  body.push(numbered(display, 1));
  body.push(paragraph(`Left third para. ${words(6, 20)}.`));
  body.push(centred(mathRun("Total = Alpha + Beta + Gamma + Delta + Epsilon + Zeta + Theta + Iota + Kappa + Lambda")));
  body.push(centred(mathRun("Ratio = (AlphaBetaGammaDeltaEpsilon) / (ZetaThetaIotaKappaLambdaMu) - (NuXiOmicronPiRhoSigmaTau)")));
  body.push(paragraph(`Left tail para. ${words(5, 450)}.`));
  // A short numbered equation in the right column, in a table of fixed
  // widths wider than the column: the equation fits its cell.
  body.push(numbered(centred(mathRun("Short = Alpha + Beta")), 2, [4300, 800], true));
  body.push(paragraph(`Right last para. ${words(8, 20)}.`));
  for (let index = 1; index <= morePages; index += 1) {
    body.push(`<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve">Later page ${index}. ${words(index, 20)}.</w:t></w:r></w:p>`);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="${MATH}"><w:body>${body.join("\n")}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
<w:cols w:num="2" w:space="720"/></w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES.replace(/<Override PartName="\/word\/(numbering|header1|footer1)\.xml"[^>]*\/>\n?/g, ""), options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS.replace(/<Relationship Id="rId[345]"[^>]*\/>\n?/g, ""), options);
  zip.file("word/styles.xml", STYLES, options);
  zip.file("word/settings.xml", SETTINGS, options);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    bytes,
    report: { ok: true, errorCode: "", errorMessage: "", kind: "docx", sourceBytes: bytes.length, features: [], outline: [],
      properties: { title: "", creator: "", rightToLeft: false } }
  };
}

function packageDocx(parts) {
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  Object.keys(parts).forEach((name) => zip.file(name, parts[name], options));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }).then((bytes) => ({
    bytes,
    report: { ok: true, errorCode: "", errorMessage: "", kind: "docx", sourceBytes: bytes.length, features: [], outline: [],
      properties: { title: "", creator: "", rightToLeft: false } }
  }));
}

const PLAIN_SECTION = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

const SMALL_STYLES_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`;

// A "Body Text" style with a 14.4 pt first line and a left stop at 14.4 pt,
// and a list style based on it that numbers its paragraphs (the level: a
// 32.4 pt left indent, 18 pt hanging). Some paragraphs of the list style
// cancel the numbering (w:numId 0), as a paper does to write prose in a list
// style. Word then drops the style's indents: such a paragraph starts at the
// margin, and its leading tab goes to the 14.4 pt stop (Word 16, COM: left
// indent and first line 0, text at 14.4 pt). A Body Text paragraph starts at
// 14.4 pt, so its leading tab goes on to the 36 pt default stop. A list
// style whose base sets a 36 pt left indent loses that too.
export function makeCancelledNumberingDocx() {
  const styles = `${SMALL_STYLES_HEAD}
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/>
<w:pPr><w:tabs><w:tab w:val="left" w:pos="288"/></w:tabs><w:ind w:firstLine="288"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ListPara"><w:name w:val="list para"/><w:basedOn w:val="BodyText"/>
<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="BodyLeft"><w:name w:val="body left"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="720" w:firstLine="288"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ListLeft"><w:name w:val="list left"/><w:basedOn w:val="BodyLeft"/>
<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
</w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="ListPara"/><w:lvlText w:val="%1)"/><w:lvlJc w:val="left"/>
<w:pPr><w:tabs><w:tab w:val="num" w:pos="648"/></w:tabs><w:ind w:left="648" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;
  const cancel = `<w:pStyle w:val="ListPara"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>`;
  const para = (props, name, tab) => `<w:p><w:pPr>${props}</w:pPr>${tab ? "<w:r><w:tab/></w:r>" : ""}<w:r><w:t xml:space="preserve">${name} ${words(11, 40)}.</w:t></w:r></w:p>`;
  const body = [
    para(cancel, "Cancelled tabbed", true),
    para(cancel, "Cancelled plain", false),
    para(`<w:pStyle w:val="BodyText"/>`, "Body tabbed", true),
    para(`<w:pStyle w:val="ListPara"/>`, "Listed item", false),
    para(cancel.replace("ListPara", "ListLeft"), "Cancelled indented", false)
  ];
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
${PLAIN_SECTION}
</w:body></w:document>`;
  return packageDocx({
    "[Content_Types].xml": CONTENT_TYPES.replace(/<Override PartName="\/word\/(header1|footer1)\.xml"[^>]*\/>\n?/g, ""),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": DOCUMENT_RELS.replace(/<Relationship Id="rId[45]"[^>]*\/>\n?/g, ""),
    "word/styles.xml": styles,
    "word/settings.xml": SETTINGS,
    "word/numbering.xml": numbering
  });
}

// A paragraph whose footnote reference says a mark of the author's own
// follows (w:customMarkFollows) but has none: the next run is the
// paragraph's bold lead-in. The note starts with its own reference mark
// (w:footnoteRef). Word prints no mark at the reference and the note's
// number, 1, in the note. A second, ordinary note follows.
export function makeEmptyMarkNoteDocx() {
  const styles = `${SMALL_STYLES_HEAD}
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
</w:styles>`;
  const ref = (id, attributes = "") => `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"${attributes}/></w:r>`;
  const body = [
    `<w:p>${ref(1, ' w:customMarkFollows="1"')}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Summary heron. </w:t></w:r><w:r><w:t xml:space="preserve">${words(12, 40)}.</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t xml:space="preserve">Second para ${words(13, 20)}.</w:t></w:r>${ref(2)}</w:p>`
  ];
  const note = (id, text) => `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:footnote>`;
  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}">
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
${note(1, "Note heron: made-up funding text.")}
${note(2, "Note wren: a second made-up note.")}
</w:footnotes>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
${PLAIN_SECTION}
</w:body></w:document>`;
  return packageDocx({
    "[Content_Types].xml": CONTENT_TYPES.replace(/<Override PartName="\/word\/(numbering|header1|footer1)\.xml"[^>]*\/>\n?/g, "")
      .replace("</Types>", `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>\n</Types>`),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": DOCUMENT_RELS.replace(/<Relationship Id="rId[345]"[^>]*\/>\n?/g, "")
      .replace("</Relationships>", `<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>\n</Relationships>`),
    "word/styles.xml": styles,
    "word/settings.xml": SETTINGS,
    "word/footnotes.xml": footnotes
  });
}

// Paragraphs of long words with optional hyphens (U+00AD, as Word saves a
// soft hyphen typed into the text), so most lines end inside a word. A page
// starts inside one of them. Word prints a hyphen at the end of such a line,
// at the foot of a page as anywhere else.
export function makeSoftHyphenDocx() {
  const parts = ["counter", "revolution", "aries", "inter", "national", "ization", "photo", "synthe", "sizing"];
  const word = (seed) => [0, 1, 2].map((step) => parts[(seed + step) % parts.length]).join("­");
  const body = [];
  for (let index = 0; index < 12; index += 1) {
    const text = Array.from({ length: 60 }, (_, at) => word(index * 5 + at)).join(" ");
    body.push(`<w:p><w:r><w:t xml:space="preserve">Hyphen para ${index + 1}. ${text}.</w:t></w:r></w:p>`);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
${PLAIN_SECTION}
</w:body></w:document>`;
  return packageDocx({
    "[Content_Types].xml": CONTENT_TYPES.replace(/<Override PartName="\/word\/(numbering|header1|footer1)\.xml"[^>]*\/>\n?/g, ""),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": DOCUMENT_RELS.replace(/<Relationship Id="rId[345]"[^>]*\/>\n?/g, ""),
    "word/styles.xml": `${SMALL_STYLES_HEAD}\n</w:styles>`,
    "word/settings.xml": SETTINGS
  });
}
