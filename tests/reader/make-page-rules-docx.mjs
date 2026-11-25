// Builds, at test time, documents for the rules Word follows where it starts
// a page: styles that are not based on the default paragraph style, keep
// with next, section breaks, and "page break before". Every line is exactly
// 18 pt (24 px), so a US Letter page with 1-inch margins holds 36 lines in
// Word and in any font. Returns bytes and a report.
//
// makeStyleChainDocx: 36 one-line paragraphs in "Clause", a style based on
// no other, and one unstyled paragraph. The default paragraph style, Normal,
// adds 18 pt after each paragraph; Clause does not, so Word fits the 36
// lines on one page.
//
// makeKeepRulesDocx: with `chain: false`, three 10-line paragraphs in a
// style named "heading 2" that does not keep with the next, then a 10-line
// paragraph kept together and one line: Word ends page 1 after the third
// paragraph. With `chain: true`, 80 one-line paragraphs, each kept with the
// next: Word fills two pages and puts 8 lines on the third.
//
// makeSectionPagesDocx: a section of 5 lines, a section of 5 lines after a
// section break with no type (a new page), and a section of 3 lines after a
// continuous break, all on the same page size: Word prints 2 pages.
//
// makeColumnStartsDocx: one two-column section of 216 one-line paragraphs,
// 72 to a page, with a saved page start (w:lastRenderedPageBreak) at the
// top of every column, as Word 2007 saved them: Word prints 3 pages.
//
// makePageBreakBeforeDocx: "Chapter one", a Heading 1 whose style breaks the
// page before it, opens the document; 3 lines follow, then a paragraph that
// holds only a page break, then "Chapter two" in Heading 1 and 3 lines. The
// section has a first-page header and a running one. Word prints 2 pages,
// the first with the first-page header.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 12));
const HEADER_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";

function contentTypes(headers) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${headers.map((_, index) => `<Override PartName="/word/header${index + 1}.xml" ContentType="${HEADER_TYPE}"/>`).join("\n")}
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function documentRels(headers) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${headers.map((_, index) => `<Relationship Id="rIdH${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header${index + 1}.xml"/>`).join("\n")}
</Relationships>`;
}

// One line exactly 18 pt tall, with no spacing around it.
const LINE = `<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/>`;

function styles(extra) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
${extra}
</w:styles>`;
}

const PAGE = `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/>`;

// Section properties in schema order: references and type, the page, then
// what follows the columns (w:titlePg).
function section(head = "", tail = "") {
  return `<w:sectPr>${head}${PAGE}${tail}</w:sectPr>`;
}

function run(text) {
  return `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

// A paragraph of `count` lines, "<name> line 1." to "<name> line <count>.".
function lines(name, count) {
  const runs = [];
  for (let line = 1; line <= count; line += 1) {
    runs.push(`<w:r>${line > 1 ? "<w:br/>" : ""}<w:t xml:space="preserve">${name} line ${line}.</w:t></w:r>`);
  }
  return runs.join("");
}

function paragraph(content, properties = "") {
  return `<w:p><w:pPr>${properties}</w:pPr>${content}</w:p>`;
}

async function pack(body, styleXml, headers = []) {
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", contentTypes(headers), options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}</w:body></w:document>`, options);
  zip.file("word/_rels/document.xml.rels", documentRels(headers), options);
  zip.file("word/styles.xml", styleXml, options);
  headers.forEach((text, index) => {
    zip.file(`word/header${index + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W}"><w:p><w:pPr>${LINE}</w:pPr>${run(text)}</w:p></w:hdr>`, options);
  });
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

export async function makeStyleChainDocx() {
  const styleXml = styles(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:before="0" w:after="360" w:line="360" w:lineRule="exact"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Clause"><w:name w:val="Clause"/>
<w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr></w:style>`);
  const body = [];
  for (let line = 1; line <= 36; line += 1) {
    body.push(paragraph(run(`Clause line ${line}.`), `<w:pStyle w:val="Clause"/>`));
  }
  body.push(`<w:p>${run("Unstyled line.")}</w:p>`);
  body.push(section());
  return pack(body, styleXml);
}

export async function makeKeepRulesDocx({ chain = false } = {}) {
  const styleXml = styles(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr>${LINE}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
<w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>`);
  const body = [];
  if (chain) {
    for (let line = 1; line <= 80; line += 1) {
      body.push(paragraph(run(`Kept line ${line}.`), "<w:keepNext/>"));
    }
  } else {
    ["Clause A", "Clause B", "Clause C"].forEach((name) => {
      body.push(paragraph(lines(name, 10), `<w:pStyle w:val="Heading2"/>`));
    });
    body.push(paragraph(lines("Block D", 10), "<w:keepLines/>"));
    body.push(paragraph(run("Closing line.")));
  }
  body.push(section());
  return pack(body, styleXml);
}

export async function makeSectionPagesDocx() {
  const styleXml = styles(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr>${LINE}</w:pPr></w:style>`);
  const body = [];
  const sectionLines = (name, count, sectPr) => {
    for (let line = 1; line <= count; line += 1) {
      const last = line === count && sectPr;
      body.push(`<w:p>${last ? `<w:pPr>${sectPr}</w:pPr>` : ""}${run(`${name} line ${line}.`)}</w:p>`);
    }
  };
  sectionLines("First section", 5, section());
  sectionLines("Second section", 5, section());
  sectionLines("Third section", 3, null);
  body.push(section(`<w:type w:val="continuous"/>`));
  return pack(body, styleXml);
}

export async function makePageBreakBeforeDocx() {
  const styleXml = styles(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr>${LINE}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:pageBreakBefore/><w:outlineLvl w:val="0"/></w:pPr></w:style>`);
  const body = [
    paragraph(run("Chapter one"), `<w:pStyle w:val="Heading1"/>`),
    paragraph(lines("Chapter one", 3)),
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    paragraph(run("Chapter two"), `<w:pStyle w:val="Heading1"/>`),
    paragraph(lines("Chapter two", 3)),
    section(`<w:headerReference w:type="default" r:id="rIdH2"/><w:headerReference w:type="first" r:id="rIdH1"/>`, "<w:titlePg/>")
  ];
  return pack(body, styleXml, ["First page header.", "Running header."]);
}

export async function makeColumnStartsDocx() {
  const styleXml = styles(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr>${LINE}</w:pPr></w:style>`);
  const body = [];
  for (let line = 1; line <= 216; line += 1) {
    const saved = line > 1 && line % 36 === 1 ? "<w:lastRenderedPageBreak/>" : "";
    body.push(`<w:p><w:r>${saved}<w:t xml:space="preserve">Column line ${line}.</w:t></w:r></w:p>`);
  }
  body.push(`<w:sectPr>${PAGE.replace('<w:cols w:space="720"/>', '<w:cols w:num="2" w:space="720"/>')}</w:sectPr>`);
  return pack(body, styleXml);
}
