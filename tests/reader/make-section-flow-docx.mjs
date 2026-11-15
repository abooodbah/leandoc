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
// section on a landscape page, which Word also starts on a new page. With
// `figurePicture`, the figure's block is 72 pt shorter and a picture that
// many points wide, anchored as below, follows it.
//
// makeMarginSectionsDocx: a one-column title section of 6 lines with a
// 1-inch top margin, then a two-column section of `lines` lines with a
// 1.5-inch top margin after a continuous break. Page 1 holds 60 of its lines
// and each later page 68; the saved page starts sit `stale` lines later.
// With `wideTableAfter`, a floating table as wide as both columns follows
// that line: one cell with a 54 pt line for a figure and a caption line
// longer than a column, anchored to the margin (w:tblpPr), as a figure with
// its caption is set in a two-column paper. With `floating: false` the same
// table is in the text's flow. With `picture`, a line that anchors a picture
// `width` pt wide and 54 pt tall follows line `after` (wp:anchor). The
// picture is aligned to the left margin, or to the right one with
// `align: "right"`, and text wraps square around it; with
// `wrap: "topAndBottom"` text stays above and below it, and with
// `wrap: "none"` it lies over the text. With `wrap: "inline"` the picture is
// in the text's flow, the only thing in its paragraph (wp:inline). With
// `dropCapAfter`, a word dropped over three lines follows that line
// (w:framePr w:dropCap="drop"), set at 65 pt, which makes it wider than a
// column, and then the line it is dropped into. A column is 216 pt wide and
// the gap between the two 36 pt.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 10));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
const PNG_TYPE = `<Default Extension="png" ContentType="image/png"/>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
const PICTURE_REL = `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>`;
// A 1 by 1 grey PNG.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==", "base64");
const EMU_PER_POINT = 12700;

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

// With `picture`, the package also holds the PNG a picture shows.
async function pack(body, lastSection, picture = false) {
  const drawing = picture ? ` xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"` : "";
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"${drawing}><w:body>${body.join("\n")}
<w:sectPr>${lastSection}</w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", picture ? CONTENT_TYPES.replace("<Override", `${PNG_TYPE}<Override`) : CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", picture ? DOCUMENT_RELS.replace("</Relationships>", `${PICTURE_REL}</Relationships>`) : DOCUMENT_RELS, options);
  zip.file("word/styles.xml", STYLES, options);
  if (picture) {
    zip.file("word/media/image1.png", PIXEL, options);
  }
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

export const PICTURE_ANCHOR = "Picture anchor.";

// A line that anchors a picture 54 pt tall at its own top or, with
// `wrap: "inline"`, a paragraph that holds the picture as its only line.
function picture(width, align = "left", wrap = "square") {
  const cx = width * EMU_PER_POINT;
  const cy = 54 * EMU_PER_POINT;
  const graphic = `<wp:docPr id="1" name="Picture 1"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${PIC}">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic>`;
  if (wrap === "inline") {
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:effectExtent l="0" t="0" r="0" b="0"/>${graphic}</wp:inline></w:drawing></w:r></w:p>`;
  }
  const wrapping = wrap === "topAndBottom" ? "<wp:wrapTopAndBottom/>" : wrap === "none" ? "<wp:wrapNone/>" : `<wp:wrapSquare wrapText="bothSides"/>`;
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/></w:pPr><w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>${align}</wp:align></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrapping}${graphic}` +
    `</wp:anchor></w:drawing></w:r><w:r><w:t xml:space="preserve">${PICTURE_ANCHOR}</w:t></w:r></w:p>`;
}

export async function makeFigureSectionDocx({ extra = 2, columnLines = 36, figureSection = "continuous", figurePage = "portrait", figurePicture = 0 } = {}) {
  const page = (size) => `${size}${margins(1440, 1440 + (36 - columnLines) * 360)}`;
  const figureSize = figurePage === "landscape" ? LANDSCAPE : PORTRAIT;
  const body = [];
  for (let index = 1; index <= 2 * columnLines + extra; index += 1) {
    body.push(line(`Alpha line ${index}.`));
  }
  body.push(sectionEnd(`${page(PORTRAIT)}${columns(2)}`));
  body.push(line("Figure block one.", { saved: true, keepNext: true }));
  body.push(line("Figure body one.", { height: figurePicture ? 5400 : 6840 }));
  if (figurePicture) {
    body.push(picture(figurePicture));
  }
  body.push(line("Figure caption one."));
  body.push(sectionEnd(`<w:type w:val="${figureSection}"/>${page(figureSize)}${columns(1)}`));
  for (let index = 1; index <= 20; index += 1) {
    body.push(line(`Gamma line ${index}.`));
  }
  return pack(body, `<w:type w:val="continuous"/>${page(figureSize)}${columns(2)}`, Boolean(figurePicture));
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

export const DROPPED_WORD = "Unbreakable";

function droppedWord() {
  return `<w:p><w:pPr><w:keepNext/><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/>` +
    `<w:spacing w:before="0" w:after="0" w:line="1080" w:lineRule="exact"/><w:textAlignment w:val="baseline"/></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="130"/></w:rPr><w:t>${DROPPED_WORD}</w:t></w:r></w:p>` + line("Dropped line.");
}

export async function makeMarginSectionsDocx({ lines = 140, stale = 2, wideTableAfter = 0, floating = true, picture: wide = null, dropCapAfter = 0 } = {}) {
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
    if (wide && index === wide.after) {
      body.push(picture(wide.width, wide.align, wide.wrap));
    }
    if (index === dropCapAfter) {
      body.push(droppedWord());
    }
  }
  return pack(body, `<w:type w:val="continuous"/>${PORTRAIT}${margins(2160)}${columns(2)}`, Boolean(wide));
}
