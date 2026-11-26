// Builds, at test time, documents whose tables split across pages in ways the
// page view measured wrongly. Each returns bytes and a report.
//
// makeEmptyTableDocx: a heading kept with a table that has no rows, as the
// sanitized package holds a table whose rows are all tracked deletions, then
// enough text for two pages.
//
// makeTallRowDocx: a row at least 200 pt tall holding one line, starting
// 100 px above the foot of the first page.
//
// makeExactRowDocx: a row of exact height (w:hRule="exact") crossing the
// foot of the first page.
//
// makePaddedRowDocx: a one-column row of one-line paragraphs in a cell with a
// bottom margin, crossing the foot of the first page.
//
// makeClippedRowDocx: a row of exact height whose cell holds more lines than
// fit in it.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 9));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Every line is exactly 12 pt (16 px) and paragraphs have no spacing unless
// a test sets it, so a US Letter page with 1-inch margins holds 54 lines.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>
<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>
<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const SECTION = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

function paragraph(text, style) {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function filler(prefix, count) {
  return Array.from({ length: count }, (_, index) => paragraph(`${prefix} line ${index + 1}.`));
}

// One paragraph of `count` lines, joined by line breaks.
function lines(prefix, count) {
  const runs = Array.from({ length: count }, (_, index) =>
    `<w:r>${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${prefix} line ${index + 1}</w:t></w:r>`);
  return `<w:p>${runs.join("")}</w:p>`;
}

function cell(width, content, properties = "") {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${properties}</w:tcPr>${content}</w:tc>`;
}

async function pack(body) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body.join("\n")}
${SECTION}
</w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS, options);
  zip.file("word/styles.xml", STYLES, options);
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

export async function makeEmptyTableDocx() {
  const table = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid></w:tbl>`;
  return pack([
    ...filler("Opening", 4),
    paragraph("Heading kept with the empty table", "Heading1"),
    table,
    ...filler("Body", 80)
  ]);
}

// 48 lines of text leave 6 lines (96 px) on the first page for a row that is
// at least 200 pt (267 px) tall.
export async function makeTallRowDocx() {
  const tall = `<w:trPr><w:trHeight w:val="4000" w:hRule="atLeast"/></w:trPr>`;
  const table = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>` +
    `<w:tr>${tall}${cell(4680, paragraph("Tall row text."))}${cell(4680, "<w:p/>")}</w:tr></w:tbl>`;
  return pack([...filler("Opening", 48), table, ...filler("Closing", 4)]);
}

// A row exactly 150 pt (200 px) tall holding eight lines in each cell, after
// 50 lines of text: four of its lines fit on the first page.
export async function makeExactRowDocx() {
  const exact = `<w:trPr><w:trHeight w:val="3000" w:hRule="exact"/></w:trPr>`;
  const table = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>` +
    `<w:tr>${exact}${cell(4680, lines("Exact left", 8))}${cell(4680, lines("Exact right", 8))}</w:tr></w:tbl>`;
  return pack([...filler("Opening", 50), table, ...filler("Closing", 4)]);
}

// A one-column row of one-line paragraphs with no spacing, in a cell with a
// bottom margin of `bottom` twips, after `before` lines of text.
export async function makePaddedRowDocx({ before = 30, bottom = 120 } = {}) {
  const lines = Array.from({ length: 40 }, (_, index) => paragraph(`Padded line ${index + 1}.`));
  const margin = `<w:tcMar><w:bottom w:w="${bottom}" w:type="dxa"/></w:tcMar>`;
  const table = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr>${cell(9360, lines.join(""), margin)}</w:tr></w:tbl>`;
  return pack([...filler("Opening", before), table, ...filler("Closing", 4)]);
}

// A row exactly 60 pt (80 px) tall whose cell holds ten 16 px lines: Word
// shows the first five and hides the rest.
export async function makeClippedRowDocx() {
  const exact = `<w:trPr><w:trHeight w:val="1200" w:hRule="exact"/></w:trPr>`;
  const table = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>` +
    `<w:tr>${exact}${cell(4680, lines("Clipped", 10))}${cell(4680, paragraph("Short cell."))}</w:tr></w:tbl>`;
  return pack([paragraph("Before the table."), table, paragraph("After the table.")]);
}
