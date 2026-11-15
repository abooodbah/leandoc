// Builds, at test time, documents in which text runs past a page start Word
// saved (w:lastRenderedPageBreak) at a boundary between sections, as in a
// two-column paper whose text sets a little longer in LeanDoc than in Word.
// Every line is exactly 18 pt (24 px), so a column of a US Letter page with
// 1-inch margins holds 36 lines in Word and in any font. Returns bytes and a
// report.
//
// makeFigureSectionDocx: a two-column section that fills page 1 and runs
// `extra` lines past it, a one-column section that holds a figure (a line
// kept with the next that carries the saved page start, a 342 pt block, and
// a caption), and a two-column section of 20 lines. `columnLines` is how
// many lines a column of a page holds (36, or fewer with a larger bottom
// margin). With `figureSection: "nextPage"` the figure's section starts a
// page of its own, and with `figurePage: "landscape"` it is a continuous
// section on a landscape page, which Word also starts on a new page.
//
// makeMarginSectionsDocx: a one-column title section of 6 lines with a
// 1-inch top margin, then a two-column section of `lines` lines with a
// 1.5-inch top margin after a continuous break. Page 1 holds 60 of its lines
// and each later page 68; the saved page starts sit `stale` lines later.
// With `wideTableAfter`, a floating table as wide as both columns follows
// that line: one cell with a 54 pt line for a figure and a caption line
// longer than a column, anchored to the margin (w:tblpPr), as a figure with
// its caption is set in a two-column paper. With `floating: false` the same
// table is in the text's flow.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 10));

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

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

const SAVED = "<w:lastRenderedPageBreak/>";
const PORTRAIT = `<w:pgSz w:w="12240" w:h="15840"/>`;
const LANDSCAPE = `<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>`;

function margins(top, bottom = 1440) {
  return `<w:pgMar w:top="${top}" w:right="1440" w:bottom="${bottom}" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>`;
}

function columns(count) {
  return count > 1 ? `<w:cols w:num="${count}" w:space="720"/>` : `<w:cols w:space="720"/>`;
}

// One line `height` twips tall exactly, with no spacing around it.
function line(text, { saved = false, height = 360, keepNext = false } = {}) {
  return `<w:p><w:pPr>${keepNext ? "<w:keepNext/>" : ""}<w:spacing w:before="0" w:after="0" w:line="${height}" w:lineRule="exact"/></w:pPr>` +
    `<w:r>${saved ? SAVED : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

// Ends a section in an empty paragraph of its own, as Word writes a section
// break typed on an empty line.
function sectionEnd(properties) {
  return `<w:p><w:pPr><w:sectPr>${properties}</w:sectPr></w:pPr></w:p>`;
}

async function pack(body, lastSection) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
<w:sectPr>${lastSection}</w:sectPr>
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

export async function makeFigureSectionDocx({ extra = 2, columnLines = 36, figureSection = "continuous", figurePage = "portrait" } = {}) {
  const page = (size) => `${size}${margins(1440, 1440 + (36 - columnLines) * 360)}`;
  const figureSize = figurePage === "landscape" ? LANDSCAPE : PORTRAIT;
  const body = [];
  for (let index = 1; index <= 2 * columnLines + extra; index += 1) {
    body.push(line(`Alpha line ${index}.`));
  }
  body.push(sectionEnd(`${page(PORTRAIT)}${columns(2)}`));
  body.push(line("Figure block one.", { saved: true, keepNext: true }));
  body.push(line("Figure body one.", { height: 6840 }));
  body.push(line("Figure caption one."));
  body.push(sectionEnd(`<w:type w:val="${figureSection}"/>${page(figureSize)}${columns(1)}`));
  for (let index = 1; index <= 20; index += 1) {
    body.push(line(`Gamma line ${index}.`));
  }
  return pack(body, `<w:type w:val="continuous"/>${page(figureSize)}${columns(2)}`);
}

export const WIDE_CAPTION = "Wide caption one: this line is longer than a column and shorter than both of them.";

// A table 468 pt wide, the width of the text area.
function wideTable(floating) {
  const none = `<w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>`;
  return `<w:tbl><w:tblPr>${floating ? `<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin"/><w:tblOverlap w:val="never"/>` : ""}` +
    `<w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>${none}</w:tblCellMar></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>` +
    `${line("Wide figure one.", { height: 1080 })}${line(WIDE_CAPTION)}</w:tc></w:tr></w:tbl>`;
}

export async function makeMarginSectionsDocx({ lines = 140, stale = 2, wideTableAfter = 0, floating = true } = {}) {
  const body = [];
  for (let index = 1; index <= 6; index += 1) {
    body.push(line(`Title line ${index}.`));
  }
  body.push(sectionEnd(`${PORTRAIT}${margins(1440)}${columns(1)}`));
  for (let index = 1; index <= lines; index += 1) {
    // Word's pages start at lines 61 and 129.
    body.push(line(`Alpha line ${index}.`, { saved: index === 61 + stale || index === 129 + stale }));
    if (index === wideTableAfter) {
      body.push(wideTable(floating));
    }
  }
  return pack(body, `<w:type w:val="continuous"/>${PORTRAIT}${margins(2160)}${columns(2)}`);
}
