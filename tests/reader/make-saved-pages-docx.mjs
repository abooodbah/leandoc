// Builds, at test time, documents laid out like one Word saved: each page after
// the first starts with the w:lastRenderedPageBreak marker Word writes where it
// started a page when it last laid the document out. Returns bytes and a report.
//
// makeSavedPagesDocx: `pages` saved pages of `lines` one-line paragraphs, each
// line exactly 18 pt (24 px) tall, so 36 lines fill a US Letter page with
// 1-inch margins in any font. With more than 36 lines a saved page runs past
// its page, as a document does whose text sets a little longer in LeanDoc
// than in Word. One paragraph crosses the start of the page after `split`,
// and an explicit page break ends the page before `pageBreak`.
//
// makeWordMetricsDocx: one page of the settings that set text taller than
// Word in a long survey: runs in the majorBidi theme font, references whose
// runs and paragraph mark are smaller than their style, empty paragraphs
// whose marks are 1 pt and 16 pt, paragraphs with w:contextualSpacing, and a fixed table.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 8));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

// The defaults of Word 365's blank document, as in the survey: 11 pt Aptos,
// spacing after 160 twips at 259/240 lines. "Ref" is a 12 pt style whose
// paragraphs set 10 pt runs; "ListParagraph" sets contextual spacing itself.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Ref"><w:name w:val="Ref"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="0" w:after="200" w:line="240" w:lineRule="auto"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="200"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>
<w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

// Office's 2023 theme fonts: the complex-script typefaces are empty, and the
// script lists name the font for Arabic.
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="156082"/></a:accent1>
<a:accent2><a:srgbClr val="E97132"/></a:accent2><a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4>
<a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6><a:hlink><a:srgbClr val="467886"/></a:hlink>
<a:folHlink><a:srgbClr val="96607D"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Arab" typeface="Times New Roman"/><a:font script="Hebr" typeface="Times New Roman"/></a:majorFont>
<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Arab" typeface="Arial"/><a:font script="Hebr" typeface="Arial"/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/><w:themeFontLang w:val="en-US" w:bidi="ar-SA"/>
<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const SECTION = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

// One line exactly 18 pt tall, with no spacing around it.
const LINE = `<w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/></w:pPr>`;
const SAVED = "<w:lastRenderedPageBreak/>";

export function lineText(page, line) {
  return `Page ${page}, line ${line}.`;
}

function run(text, { saved = false } = {}) {
  return `<w:r>${saved ? SAVED : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

async function pack(documentXml) {
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS, options);
  zip.file("word/styles.xml", STYLES, options);
  zip.file("word/settings.xml", SETTINGS, options);
  zip.file("word/theme/theme1.xml", THEME, options);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function report(bytes) {
  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    kind: "docx",
    sourceBytes: bytes.length,
    features: [],
    outline: [],
    properties: { title: "", creator: "", rightToLeft: false }
  };
}

function wrap(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join("\n")}
${SECTION}
</w:body></w:document>`;
}

export async function makeSavedPagesDocx({ pages = 10, lines = 38, split = 0, pageBreak = 0 } = {}) {
  const body = [];
  for (let page = 1; page <= pages; page += 1) {
    // Word saves a page start after an explicit page break too.
    const saved = page > 1;
    for (let line = 1; line <= lines; line += 1) {
      if (page === split && line === lines - 1) {
        // The last two lines of this page and the first two of the next are
        // one paragraph, which Word broke between pages.
        body.push(`<w:p>${LINE}${run(lineText(page, line))}<w:r><w:br/></w:r>${run(lineText(page, line + 1))}` +
          `<w:r><w:br/></w:r>${run(lineText(page + 1, 1), { saved: true })}<w:r><w:br/></w:r>${run(lineText(page + 1, 2))}</w:p>`);
        break;
      }
      if (page === split + 1 && split > 0 && line <= 2) {
        continue;
      }
      body.push(`<w:p>${LINE}${run(lineText(page, line), { saved: saved && line === 1 })}</w:p>`);
    }
    if (page + 1 === pageBreak) {
      body.push(`<w:p>${LINE}<w:r><w:br w:type="page"/></w:r></w:p>`);
    }
  }
  const bytes = await pack(wrap(body));
  return { bytes, pages, lines, report: report(bytes) };
}

export async function makeWordMetricsDocx() {
  const major = `<w:rFonts w:asciiTheme="majorBidi" w:hAnsiTheme="majorBidi" w:cstheme="majorBidi"/>`;
  const small = `<w:sz w:val="20"/><w:szCs w:val="20"/>`;
  const smallRun = (text) => `<w:r><w:rPr>${small}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const reference = (text, extra = "") => `<w:p><w:pPr><w:pStyle w:val="Ref"/>${extra}<w:rPr>${small}</w:rPr></w:pPr>${smallRun(text)}</w:p>`;
  const contextual = "<w:contextualSpacing/>";
  const cell = (width, text) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(text)}</w:p></w:tc>`;
  const body = [
    `<w:p><w:r><w:rPr>${major}</w:rPr><w:t xml:space="preserve">Theme font marker heron.</w:t></w:r></w:p>`,
    // Three lines in one paragraph of 10 pt text, in a 12 pt style.
    `<w:p><w:pPr><w:pStyle w:val="Ref"/><w:rPr>${small}</w:rPr></w:pPr>${smallRun("Reference marker one.")}<w:r><w:rPr>${small}</w:rPr><w:br/></w:r>` +
      `${smallRun("Reference marker two.")}<w:r><w:rPr>${small}</w:rPr><w:br/></w:r>${smallRun("Reference marker three.")}</w:p>`,
    `<w:p><w:pPr><w:spacing w:after="0"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`,
    `<w:p><w:pPr><w:rPr><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:pPr></w:p>`,
    reference("Contextual one.", contextual),
    reference("Contextual two.", contextual),
    reference("Contextual three.", contextual),
    `<w:p>${run("After the contextual references.")}</w:p>`,
    `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>${run("List item one.")}</w:p>`,
    `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>${run("List item two.")}</w:p>`,
    `<w:p>${run("After the list.")}</w:p>`,
    `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:insideV w:val="single" w:sz="4" w:color="000000"/></w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="1000"/><w:gridCol w:w="4360"/></w:tblGrid>` +
      `<w:tr>${cell(4000, "Fixed")}${cell(1000, "Supercalifragilisticexpialidocious")}${cell(4360, "Table")}</w:tr></w:tbl>`,
    `<w:p>${run("Closing marker lynx.")}</w:p>`
  ];
  const bytes = await pack(wrap(body));
  return { bytes, report: report(bytes) };
}
