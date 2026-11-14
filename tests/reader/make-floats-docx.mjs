// Builds, at test time, a two-column paper laid out the way Word saves an IEEE
// paper: a one-column title section whose header holds the page number (a
// right tab, then a PAGE field), a two-column section with no header of its
// own, a VML text box that Word floats across both columns at the top of the
// page (w10:wrap type="topAndBottom", positioned against the margin) and that
// holds a table, and a reference list whose entries are "[n]", a tab, and the
// text at a hanging indent. The title's footnote carries a mark of its own
// (w:customMarkFollows). Word starts page 3 at "Tail para 10", and the file
// records that page start (w:lastRenderedPageBreak) as Word's saved files do.
// After "Tail para 12", a picture 245 pt wide follows a centred tab at 125 pt:
// Word centres it on the stop, on one line of the 251 pt column. "Tail para
// 14" starts at the column's left edge and anchors a figure box Word floats
// to the foot of page 3.
// All text is made up. Returns bytes and a report.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const V = "urn:schemas-microsoft-com:vml";
const O = "urn:schemas-microsoft-com:office:office";
const W10 = "urn:schemas-microsoft-com:office:word";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/>
<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

// Heading1 is small capitals, as IEEE section headings are: a text box
// anchored in one must not take them.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:ind w:firstLine="200"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:spacing w:before="240" w:after="80"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:smallCaps/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Reference"><w:name w:val="Reference"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="400" w:hanging="400"/></w:pPr><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>
<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

// The page number at the right margin: a right tab at the text width (10280
// twips), then a PAGE field, as the IEEE template's header has it. The field
// keeps the result Word saved last, "12"; each page shows its own number.
const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W}"><w:p><w:pPr><w:pStyle w:val="Header"/><w:tabs><w:tab w:val="right" w:pos="10280"/></w:tabs></w:pPr>
<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t>12</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`;

const FOOTNOTES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}">
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:t>\u200b</w:t></w:r>
<w:r><w:t xml:space="preserve"> Affiliation note wren: the authors work at a made-up institute.</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

const WORDS = ("signal channel buffer packet stream latency cache vector kernel tensor " +
  "message router switch memory thread fabric anchor ledger beacon harbor").split(" ");

function words(seed, count) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    out.push(WORDS[(seed * 7 + index * 13) % WORDS.length]);
  }
  return out.join(" ");
}

function paragraph(text, style, pageStart = false) {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const start = pageStart ? "<w:lastRenderedPageBreak/>" : "";
  return `<w:p>${properties}<w:r>${start}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

const PAGE = `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1140" w:right="980" w:bottom="880" w:left="980" w:header="500" w:footer="500" w:gutter="0"/>`;

// A table of four rows in a text box 514 pt wide (the text width), centred on
// the margins at the top margin, with 12 pt below it, as Word writes it. The
// height is the one Word gives the box when it fits it to the text (73.2 pt).
function floatingTable() {
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="2570" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const row = (...cells) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;
  const table = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10280" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="2570"/><w:gridCol w:w="2570"/><w:gridCol w:w="2570"/><w:gridCol w:w="2570"/></w:tblGrid>
${row("Floatbox heron", "Measure", "Value", "Note")}${row("Signal", "latency", "12", "kept")}${row("Channel", "buffer", "34", "kept")}${row("Packet", "stream", "56", "moved")}</w:tbl>`;
  const caption = `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>TABLE I</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="80"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>Made-up measurements of a made-up system.</w:t></w:r></w:p>`;
  const style = "position:absolute;margin-left:0;margin-top:0;width:514pt;height:73.2pt;z-index:251659265;visibility:visible;" +
    "mso-wrap-style:square;mso-wrap-distance-left:0;mso-wrap-distance-top:0;mso-wrap-distance-right:0;mso-wrap-distance-bottom:12pt;" +
    "mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:absolute;mso-position-vertical-relative:margin;v-text-anchor:top";
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>` +
    `<v:shape id="Float 1" o:spid="_x0000_s1026" type="#_x0000_t202" style="${style}" o:allowoverlap="f" filled="f" stroked="f">` +
    `<v:textbox style="mso-fit-shape-to-text:t" inset="0,0,0,0"><w:txbxContent>${caption}${table}</w:txbxContent></v:textbox>` +
    `<w10:wrap type="topAndBottom" anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`;
}

// A figure in a text box with a line around it, which Word floats to the foot
// of the page (mso-position-vertical:bottom against the margin) with 12 pt
// above it. VML's default inset applies.
function floatingFigure() {
  const content = `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Figurebox wren</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>Fig. 1. A made-up figure.</w:t></w:r></w:p>`;
  const style = "position:absolute;margin-left:0;margin-top:0;width:514pt;height:28.65pt;z-index:251659266;visibility:visible;" +
    "mso-wrap-style:square;mso-wrap-distance-left:0;mso-wrap-distance-top:12pt;mso-wrap-distance-right:0;mso-wrap-distance-bottom:0;" +
    "mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:bottom;mso-position-vertical-relative:margin;v-text-anchor:top";
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:pict>` +
    `<v:shape id="Float 2" o:spid="_x0000_s1027" type="#_x0000_t202" style="${style}" o:allowoverlap="f">` +
    `<v:textbox style="mso-fit-shape-to-text:t"><w:txbxContent>${content}</w:txbxContent></v:textbox>` +
    `<w10:wrap type="topAndBottom" anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`;
}

// A 1 by 1 grey PNG.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==", "base64");
const EMU_PER_POINT = 12700;

// A centred stop at 125 pt and a right stop at the column's edge, then a tab
// and a picture 245 pt by 10 pt.
function centredPicture() {
  const cx = 245 * EMU_PER_POINT;
  const cy = 10 * EMU_PER_POINT;
  return `<w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="2500"/><w:tab w:val="right" w:pos="5020"/></w:tabs><w:ind w:firstLine="0"/></w:pPr>` +
    `<w:r><w:tab/></w:r><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function reference(number) {
  return `<w:p><w:pPr><w:pStyle w:val="Reference"/></w:pPr><w:r><w:t>[${number}]</w:t></w:r><w:r><w:tab/>` +
    `<w:t xml:space="preserve">A. Author and B. Writer, "On ${words(number, 6)}," Journal of ${words(number + 3, 3)}, vol. ${number}, pp. ${number * 10}-${number * 10 + 9}, 2020.</w:t></w:r></w:p>`;
}

export async function makeFloatsDocx({ before = 14, after = 20, references = 40 } = {}) {
  const body = [];
  body.push(paragraph("Floating Box Paper Title", "Title"));
  body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/><w:spacing w:after="0"/><w:rPr><w:sz w:val="22"/></w:rPr>` +
    `<w:sectPr><w:headerReference w:type="default" r:id="rId4"/>${PAGE}<w:cols w:space="240"/></w:sectPr></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>A. Author and B. Writer</w:t></w:r>` +
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:sz w:val="22"/></w:rPr><w:footnoteReference w:customMarkFollows="1" w:id="1"/><w:t>\u200b</w:t></w:r></w:p>`);
  body.push(paragraph("I. Introduction", "Heading1"));
  for (let index = 1; index <= before; index += 1) {
    body.push(paragraph(`Lead para ${index}. ${words(index, 70)}.`));
  }
  body.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${floatingTable()}<w:r><w:t>II. Anchor Heading</w:t></w:r></w:p>`);
  for (let index = 1; index <= after; index += 1) {
    if (index === 14) {
      body.push(`<w:p><w:pPr><w:ind w:firstLine="0"/></w:pPr>${floatingFigure()}<w:r><w:t xml:space="preserve">Tail para 14. ${words(index + 40, 70)}.</w:t></w:r></w:p>`);
      continue;
    }
    body.push(paragraph(`Tail para ${index}. ${words(index + 40, 70)}.`, "", index === 10));
    if (index === 12) {
      body.push(centredPicture());
    }
  }
  body.push(paragraph("References", "Heading1"));
  for (let index = 1; index <= references; index += 1) {
    body.push(reference(index));
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:v="${V}" xmlns:o="${O}" xmlns:w10="${W10}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>${body.join("\n")}
<w:sectPr><w:type w:val="continuous"/>${PAGE}<w:cols w:num="2" w:space="240"/></w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS, options);
  zip.file("word/styles.xml", STYLES, options);
  zip.file("word/settings.xml", SETTINGS, options);
  zip.file("word/footnotes.xml", FOOTNOTES, options);
  zip.file("word/header1.xml", HEADER, options);
  zip.file("word/media/image1.png", PIXEL, options);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    bytes,
    references,
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
