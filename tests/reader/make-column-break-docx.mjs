// Builds, at test time, a one-column document with a column break
// (w:br w:type="column") at the start of a heading, after a few lines of
// text, and a two-column section after it whose first column ends with a
// column break. Returns bytes and a report.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 11));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const PAGE = `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>`;

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

export async function makeColumnBreakDocx() {
  const body = [
    paragraph("Opening line one."),
    paragraph("Opening line two."),
    `<w:p><w:r><w:br w:type="column"/></w:r><w:r><w:t>Heading after the column break</w:t></w:r></w:p>`,
    paragraph("Text after the heading."),
    `<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/>${PAGE}<w:cols w:space="720"/></w:sectPr></w:pPr></w:p>`,
    paragraph("Left column text."),
    `<w:p><w:r><w:br w:type="column"/></w:r><w:r><w:t>Right column text.</w:t></w:r></w:p>`
  ];
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body.join("\n")}
<w:sectPr><w:type w:val="continuous"/>${PAGE}<w:cols w:num="2" w:space="720"/></w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
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
