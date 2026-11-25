// Builds a document whose first page ends in a bordered table row whose text fits
// the text area except for the space after its last paragraph. Every line is
// exactly 18 pt (24 px), so a US Letter page with 1-inch margins holds 36.
// Lines 1 to 32 and a one-line row fill 793 px, and the next row holds three
// lines, the second with 20 pt of space after it: the second line ends 22 px
// above the foot of the page and its space after reaches past it, and the
// third line does not fit. A last row follows.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 10));

function line(text, after = 0) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}" w:line="360" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

export async function makeTableEdgeDocx() {
  const body = [];
  for (let index = 1; index <= 32; index += 1) {
    body.push(line(`Line ${index}.`));
  }
  const border = (side) => `<w:${side} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`;
  const cell = (text, after) => `<w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${line(text, after)}</w:tc>`;
  const edge = `<w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${line("Edge one.")}${line("Edge two.", 400)}${line("Edge three.")}</w:tc>`;
  body.push(`<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>` +
    `<w:tr>${cell("Top row.", 0)}</w:tr><w:tr>${edge}</w:tr><w:tr>${cell("Next row.", 0)}</w:tr></w:tbl>`);
  body.push(line("After table."));
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body.join("\n")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`, options);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`, options);
  zip.file("word/document.xml", documentXml, options);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    bytes,
    report: { ok: true, errorCode: "", errorMessage: "", kind: "docx", sourceBytes: bytes.length, features: [], outline: [], properties: { title: "", creator: "", rightToLeft: false } }
  };
}
