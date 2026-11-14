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

export async function makeNumberedDocx({ offPage = false } = {}) {
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
