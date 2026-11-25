// Builds, at test time, a document whose pictures keep their fill inside a
// markup-compatibility block, as some older Mac Word files save them: in
// pic:pic, an mc:AlternateContent holds a Choice (Requires="ma") with an
// empty blip and a Fallback with the real one. One picture is in the header
// (with the "ve" prefix those files use) and one in the body (with "mc").
// All text is made up. Returns the .docx bytes.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const MA = "http://schemas.microsoft.com/office/mac/drawingml/2008/main";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));

// A 1 x 1 red PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64");

export const BODY_TEXT = "Alternate picture body paragraph.";
export const HEADER_TEXT = "Alternate picture header.";

function picture(prefix, id) {
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="914400" cy="457200"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="picture${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<${prefix}:AlternateContent xmlns:${prefix}="${MC}"><${prefix}:Choice xmlns:ma="${MA}" Requires="ma">` +
    `<pic:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></pic:blipFill></${prefix}:Choice>` +
    `<${prefix}:Fallback><pic:blipFill><a:blip r:embed="rIdPicture"/><a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill></${prefix}:Fallback></${prefix}:AlternateContent>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing>`;
}

const RELS_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export async function makeAlternatePictureDocx() {
  const zip = new JSZip();
  const add = (name, text) => zip.file(name, text, { date: FIXED_DATE });
  add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`);
  add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${RELS_TYPE}/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  add("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdHeader" Type="${RELS_TYPE}/header" Target="header1.xml"/>
<Relationship Id="rIdPicture" Type="${RELS_TYPE}/image" Target="media/picture.png"/>
</Relationships>`);
  add("word/_rels/header1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdPicture" Type="${RELS_TYPE}/image" Target="media/picture.png"/>
</Relationships>`);
  add("word/header1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}">` +
    `<w:p><w:r>${picture("ve", 1)}</w:r></w:p><w:p><w:r><w:t>${HEADER_TEXT}</w:t></w:r></w:p></w:hdr>`);
  add("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>` +
    `<w:p><w:r><w:t>${BODY_TEXT}</w:t></w:r></w:p><w:p><w:r>${picture("mc", 2)}</w:r></w:p>` +
    `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>` +
    `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" ` +
    `w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  zip.file("word/media/picture.png", PNG, { date: FIXED_DATE });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
