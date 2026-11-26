// Builds, at test time, a document with a chart LeanDoc does not draw, as the
// hosts receive it before the core sanitizes it: an inline chart drawing 432
// by 252 pt (wp:extent) whose c:chart names a chart part, between two
// paragraphs, and a drawing whose a:graphic holds only an mc:AlternateContent
// with a chart in its Choice and no Fallback. The core keeps each drawing's
// frame and removes the charts. All text is made up. Returns the .docx bytes.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const FIXED_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 12));
const EMU_PER_POINT = 12700;

export const BEFORE_TEXT = "Before the chart heron.";
export const AFTER_TEXT = "After the chart lynx.";
export const LAST_TEXT = "After the second chart otter.";
export const FRAME_POINTS = { width: 432, height: 252 };

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>
</Relationships>`;

const CHART = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}"><c:chart/></c:chartSpace>`;

function paragraph(text) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function drawing(graphic, id) {
  const cx = FRAME_POINTS.width * EMU_PER_POINT;
  const cy = FRAME_POINTS.height * EMU_PER_POINT;
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Chart ${id}"/>${graphic}</wp:inline></w:drawing></w:r></w:p>`;
}

const CHART_DATA = `<a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rIdChart"/></a:graphicData>`;

export async function makeChartFrameDocx() {
  const body = [
    paragraph(BEFORE_TEXT),
    drawing(`<a:graphic>${CHART_DATA}</a:graphic>`, 1),
    paragraph(AFTER_TEXT),
    drawing(`<a:graphic><mc:AlternateContent><mc:Choice Requires="c">${CHART_DATA}</mc:Choice></mc:AlternateContent></a:graphic>`, 2),
    paragraph(LAST_TEXT)
  ];
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:mc="${MC}"><w:body>${body.join("\n")}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  const options = { date: FIXED_DATE };
  zip.file("[Content_Types].xml", CONTENT_TYPES, options);
  zip.file("_rels/.rels", ROOT_RELS, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS, options);
  zip.file("word/charts/chart1.xml", CHART, options);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
