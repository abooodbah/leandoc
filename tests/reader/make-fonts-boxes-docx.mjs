// Builds, at test time, one US Letter page (1-inch margins, a 468 pt column)
// in Word 2010's defaults: 11 pt Calibri, 10 pt after each paragraph, lines
// at 1.15. The document defaults set no run size, as in files whose Normal
// style sets it. Each part holds a setting that Word lays out differently
// from docx-preview:
//
// - "mono": a paragraph of 50 characters of 10 pt Consolas. Consolas
//   advances 1126/2048 em per character (5.5 pt at 10 pt), whatever font
//   draws it when Consolas is missing.
// - "picture": a paragraph that holds only an inline picture, 90 pt tall.
// - "empty": a code listing, Consolas 8 pt at single spacing, with an empty
//   paragraph between its lines whose mark is 8 pt Consolas.
// - "box": a VML text box wrapped square (w10:wrap type="square") that is
//   as wide as the column, 10 pt below the top of its anchor paragraph and
//   150 pt tall, then a paragraph of text.
// - "complex": a right-to-left run of Arabic in a style whose complex-script
//   font is Traditional Arabic at 15 pt (w:rFonts/@w:cs, w:szCs), and a
//   left-to-right run after it in the style's 11 pt Times New Roman.
//
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
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 10));
const EMU_PER_POINT = 12700;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Times New Roman"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ArabicBody"><w:name w:val="Arabic Body"/><w:basedOn w:val="Normal"/>
<w:pPr><w:bidi/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Traditional Arabic"/><w:sz w:val="22"/><w:szCs w:val="30"/></w:rPr></w:style>
</w:styles>`;

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/>
<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>`;

const SECTION = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>`;

// A 1 by 1 grey PNG.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==", "base64");

export const MONO_TEXT = "0123456789".repeat(5);
export const ARABIC_TEXT = "\u0646\u0635 \u062a\u062c\u0631\u064a\u0628\u064a";
export const LATIN_TEXT = "Latin lynx";

const CONSOLAS = (size) => `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
const CODE_LINE = `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>`;

function text(value) {
  return `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
}

function codeLine(value) {
  return `<w:p><w:pPr>${CODE_LINE}<w:rPr>${CONSOLAS(16)}</w:rPr></w:pPr><w:r><w:rPr>${CONSOLAS(16)}</w:rPr><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;
}

const PARTS = {
  mono: () => [
    `<w:p><w:r><w:rPr>${CONSOLAS(20)}</w:rPr><w:t>${MONO_TEXT}</w:t></w:r></w:p>`
  ],
  picture: () => {
    const cx = 120 * EMU_PER_POINT;
    const cy = 90 * EMU_PER_POINT;
    return [
      `<w:p>${text("Before the picture.")}</w:p>`,
      `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
        `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      `<w:p>${text("After the picture.")}</w:p>`
    ];
  },
  empty: () => [
    codeLine("&lt;listing first=\"line\"&gt;"),
    `<w:p><w:pPr>${CODE_LINE}<w:rPr>${CONSOLAS(16)}</w:rPr></w:pPr></w:p>`,
    codeLine("&lt;/listing&gt;")
  ],
  box: () => [
    `<w:p><w:r><w:pict><v:shape id="Box1" o:spid="_x0000_s1026" type="#_x0000_t202" ` +
      `style="position:absolute;left:0;text-align:left;margin-left:0;margin-top:10pt;width:468pt;height:150pt;z-index:251659264;` +
      `mso-wrap-style:square;mso-position-horizontal:absolute;mso-position-horizontal-relative:text;` +
      `mso-position-vertical:absolute;mso-position-vertical-relative:text" stroked="f">` +
      `<v:textbox><w:txbxContent><w:p>${text("Calendar box heron.")}</w:p></w:txbxContent></v:textbox>` +
      `<w10:wrap type="square"/></v:shape></w:pict></w:r></w:p>`,
    `<w:p>${text("After the box lynx.")}</w:p>`
  ],
  complex: () => [
    `<w:p><w:pPr><w:pStyle w:val="ArabicBody"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${ARABIC_TEXT}</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> ${LATIN_TEXT}</w:t></w:r></w:p>`
  ]
};

async function pack(documentXml) {
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS, options);
  zip.file("word/styles.xml", STYLES, options);
  zip.file("word/settings.xml", SETTINGS, options);
  zip.file("word/media/image1.png", PIXEL, options);
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

// `part` is one of the keys of PARTS.
export async function makeFontsBoxesDocx(part) {
  const body = PARTS[part]();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:v="${V}" xmlns:o="${O}" xmlns:w10="${W10}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>${body.join("\n")}
${SECTION}
</w:body></w:document>`;
  const bytes = await pack(documentXml);
  return { bytes, report: report(bytes) };
}
