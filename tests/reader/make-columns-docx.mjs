// Builds, at test time, a document laid out like an IEEE paper written by pandoc:
// two-column sections separated by continuous section breaks, a full-width table
// between them, a footnote, and heading styles whose linked character styles carry
// a different size, as pandoc's reference document does. Returns bytes and a report.
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
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`;

// Heading1 is 10 pt small caps; its linked character style says 20 pt. Word ignores
// the linked style for paragraphs in Heading1, so headings print at 10 pt.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="200"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:link w:val="TitleChar"/>
<w:pPr><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="48"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:link w:val="Heading1Char"/>
<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b w:val="0"/><w:smallCaps/><w:sz w:val="20"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="TitleChar"><w:name w:val="Title Char"/><w:link w:val="Title"/>
<w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/><w:link w:val="Heading1"/>
<w:rPr><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>
<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const FOOTNOTES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}">
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>
<w:r><w:t xml:space="preserve"> Footnote marker heron: the authors are with a university department.</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

const WORDS = ("speedup efficiency workers ladder library runtime memory node cluster benchmark " +
  "measure score platform energy session record trace batch shard gradient").split(" ");

function words(seed, count) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    out.push(WORDS[(seed * 7 + index * 11) % WORDS.length]);
  }
  return out.join(" ");
}

function paragraph(text, { style, footnote = false } = {}) {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const note = footnote
    ? `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`
    : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${note}</w:p>`;
}

const PAGE = `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="900" w:bottom="1440" w:left="900" w:header="540" w:footer="720" w:gutter="0"/>`;

// Ends a section inside the last paragraph of it, as Word and pandoc write it.
function sectionBreak(columns) {
  const cols = columns > 1 ? `<w:cols w:num="${columns}" w:space="360"/>` : `<w:cols w:space="720"/>`;
  return `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/>${PAGE}${cols}</w:sectPr></w:pPr></w:p>`;
}

function table() {
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="3480" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const row = (a, b, c) => `<w:tr>${cell(a)}${cell(b)}${cell(c)}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10440" w:type="dxa"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="3480"/><w:gridCol w:w="3480"/><w:gridCol w:w="3480"/></w:tblGrid>
${row("Dimension", "Question", "Measure")}${row("Speedup", "How fast", "Ratio")}${row("Energy", "What it costs", "Joules")}</w:tbl>`;
}

async function packDocx(documentXml, styles = STYLES) {
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS, options);
  zip.file("word/styles.xml", styles, options);
  zip.file("word/footnotes.xml", FOOTNOTES, options);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function report(bytes, outline) {
  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    kind: "docx",
    sourceBytes: bytes.length,
    features: [],
    outline,
    properties: { title: "", creator: "", rightToLeft: false }
  };
}

const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

// Pandoc's table shape: automatic width, equal grid columns, no cell widths,
// rules above and below the table and under the header row, 8 pt cell text.
function pandocTable(rows, { header }) {
  const rule = `<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="000000"/></w:tcBorders>`;
  const cell = (text, isHeader) => `<w:tc><w:tcPr>${isHeader ? rule : ""}<w:tcMar><w:left w:w="50" w:type="dxa"/><w:right w:w="50" w:type="dxa"/></w:tcMar></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
  const columns = header.length;
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="1584"/>`).join("");
  const row = (cells, isHeader) => `<w:tr>${cells.map((text) => cell(text, isHeader)).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="8" w:color="000000"/></w:tblBorders><w:jc w:val="center"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>` +
    row(header, true) + rows.map((cells) => row(cells, false)).join("") + `</w:tbl>`;
}

// A paragraph with an inline equation whose subscript is four runs, as pandoc
// writes E_sess; a three-line table; and a table long enough to split across
// pages, all in one column.
export async function makeTablesDocx({ longRows = 90 } = {}) {
  const run = (text) => `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>${text}</m:t></m:r>`;
  const equation = `<m:oMath><m:sSub><m:e><m:r><m:t>E</m:t></m:r></m:e><m:sub>${["s", "e", "s", "s"].map(run).join("")}</m:sub></m:sSub></m:oMath>`;
  const body = [
    `<w:p><w:r><w:t xml:space="preserve">Equation marker newt: the session efficiency </w:t></w:r>${equation}<w:r><w:t xml:space="preserve"> is computed per run.</w:t></w:r></w:p>`,
    paragraph("TABLE A", { style: "Heading1" }),
    pandocTable([
      ["Speedup", "How fast does it do my work?", "Speedup or efficiency, scored 1 to 5", "Efficiency on a stated part of the job, and retention"],
      ["Scalability", "Do more processors keep paying off?", "Slope of efficiency against scale", "Average efficiency over each doubling of processors"],
      ["Energy", "What does the work consume?", "Utilization, scored 1 to 5", "Energy per unit of work at scale"]
    ], { header: ["Dimension", "Question for the user", "Original measure", "Bounded measure"] }),
    paragraph("TABLE B", { style: "Heading1" }),
    pandocTable(Array.from({ length: longRows }, (_, index) => [`Row ${index + 1}`, "ok", `A longer description of row ${index + 1} that fills its cell`]),
      { header: ["Run", "State", "Description"] }),
    paragraph("Closing paragraph lynx.")
  ];
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="${M}"><w:body>${body.join("\n")}
<w:sectPr>${PAGE}<w:cols w:space="720"/></w:sectPr>
</w:body></w:document>`;
  const bytes = await packDocx(documentXml);
  return { bytes, longRows, report: report(bytes, []) };
}

// One-line paragraphs with exact 12 pt lines and `after` twips of spacing after,
// in one section with no page break. With 880 twips, a page's twelfth line ends
// above the bottom margin while its spacing after reaches past it.
export async function makeSpacedDocx({ count = 100, after = 880 } = {}) {
  const body = [];
  for (let index = 1; index <= count; index += 1) {
    body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="${after}" w:line="240" w:lineRule="exact"/></w:pPr>` +
      `<w:r><w:t xml:space="preserve">Spaced line ${index}.</w:t></w:r></w:p>`);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
<w:sectPr>${PAGE}<w:cols w:space="720"/></w:sectPr>
</w:body></w:document>`;
  const bytes = await packDocx(documentXml);
  return { bytes, count, report: report(bytes, []) };
}

// longParagraphs: paragraphs in the long two-column section (S2), which runs over
// several pages. Every paragraph carries its section and index, so tests can find it.
export async function makeColumnsDocx({ longParagraphs = 60 } = {}) {
  const body = [];
  body.push(paragraph("Columns Paper Title", { style: "Title" }));
  body.push(sectionBreak(1));
  body.push(paragraph("I. Introduction", { style: "Heading1" }));
  for (let index = 1; index <= longParagraphs; index += 1) {
    body.push(paragraph(`S2 para ${index}. ${words(index, 45)}.`, { footnote: index === 1 }));
  }
  body.push(sectionBreak(2));
  body.push(paragraph("TABLE I", { style: "Heading1" }));
  body.push(table());
  body.push(sectionBreak(1));
  for (let index = 1; index <= 6; index += 1) {
    body.push(paragraph(`S4 para ${index}. ${words(index + 100, 40)}.`));
  }
  body.push(sectionBreak(2));
  for (let index = 1; index <= 2; index += 1) {
    body.push(paragraph(`S5 para ${index}. ${words(index + 200, 20)}.`));
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
<w:sectPr><w:type w:val="continuous"/>${PAGE}<w:cols w:num="2" w:space="360"/></w:sectPr>
</w:body></w:document>`;
  const bytes = await packDocx(documentXml);
  return { bytes, longParagraphs, report: report(bytes, [{ level: 1, text: "I. Introduction", paragraph: 2 }]) };
}

// One-column pages with what Word breaks across pages in its own way: a
// table whose header row repeats and whose tall row breaks between lines,
// a row marked not to break, a numbered paragraph longer than the room left
// on a page, superscripts, and a title page with its own footer of empty
// lines while the other pages print a one-line footer.
export async function makePageFlowDocx() {
  const run = (text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const sup = (text) => `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>${text}</w:t></w:r>`;
  const body = [];
  body.push(paragraph("Page Flow Title", { style: "Title" }));
  for (let index = 1; index <= 3; index += 1) {
    body.push(paragraph(`Plain para ${index}. ${words(index, 60)}.`));
  }
  body.push(`<w:p>${run(`Raised para. ${words(9, 12)} m`)}${sup("2")}${run(` ${words(10, 12)} kg`)}${sup("-1")}${run(` ${words(11, 12)} x`)}${sup("3")}${run(` ${words(12, 12)}.`)}</w:p>`);
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="5220" w:type="dxa"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`;
  const row = (properties, a, b) => `<w:tr>${properties ? `<w:trPr>${properties}</w:trPr>` : ""}${cell(a)}${cell(b)}</w:tr>`;
  body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10440" w:type="dxa"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="5220"/><w:gridCol w:w="5220"/></w:tblGrid>
${row("<w:tblHeader/>", "Header marker owl", "Column two")}
${row("", "Short row", "One line")}
${row("", `Tall row start. ${words(20, 900)}. Tall row end.`, "Beside the tall row")}
${row("<w:cantSplit/>", `Whole row start. ${words(30, 260)}. Whole row end.`, "Kept whole")}
</w:tbl>`);
  body.push(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(`Numbered start. ${words(40, 500)}. Numbered end.`)}</w:p>`);
  body.push(paragraph(`Closing para. ${words(50, 30)}.`));
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
<w:sectPr><w:footerReference w:type="first" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/>${PAGE}<w:cols w:space="720"/><w:titlePg/></w:sectPr>
</w:body></w:document>`;
  const empty = Array.from({ length: 12 }, () => "<w:p/>").join("");
  const footer = (content) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W}">${content}</w:ftr>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES.replace("</Types>",
    `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`), options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS.replace("</Relationships>",
    `<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
<Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`), options);
  zip.file("word/styles.xml", STYLES, options);
  zip.file("word/footnotes.xml", FOOTNOTES, options);
  zip.file("word/footer1.xml", footer(empty), options);
  zip.file("word/footer2.xml", footer(`<w:p><w:r><w:t>Page footer marker</w:t></w:r></w:p>`), options);
  zip.file("word/numbering.xml", numbering, options);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { bytes, report: report(bytes, []) };
}

// A one-column page filled with 57 one-line paragraphs, the last with 6 pt
// after it, leaving less than a line, then a continuous break into two
// columns whose first paragraph starts with the page start Word saved
// (w:lastRenderedPageBreak).
// No line spacing anywhere, so every paragraph's line height is the
// browser's normal one until the reader gives it the font's single line:
// Calibri paragraphs and Times New Roman paragraphs.
export async function makeDefaultLineDocx() {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>`;
  const body = [];
  for (let index = 1; index <= 6; index += 1) {
    const font = index % 2 ? "" : `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr>`;
    body.push(`<w:p><w:r>${font}<w:t xml:space="preserve">Default line ${index}. ${words(index, 30)}.</w:t></w:r></w:p>`);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
<w:sectPr>${PAGE}</w:sectPr>
</w:body></w:document>`;
  const bytes = await packDocx(documentXml, styles);
  return { bytes, report: report(bytes, []) };
}

export async function makeSavedStartAfterBreakDocx() {
  const body = [];
  for (let index = 1; index <= 56; index += 1) {
    body.push(paragraph(`Line ${index}.`));
  }
  body.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>Line 57.</w:t></w:r></w:p>`);
  body.push(sectionBreak(1));
  body.push(`<w:p><w:r><w:lastRenderedPageBreak/><w:t xml:space="preserve">After the saved start. ${words(3, 40)}.</w:t></w:r></w:p>`);
  body.push(paragraph(`Second column text. ${words(4, 40)}.`));
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
<w:sectPr><w:type w:val="continuous"/>${PAGE}<w:cols w:num="2" w:space="360"/></w:sectPr>
</w:body></w:document>`;
  const bytes = await packDocx(documentXml);
  return { bytes, report: report(bytes, []) };
}
