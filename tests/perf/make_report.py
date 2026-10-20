"""Generates realistic test reports at test time (standard library only).

    python3 tests/perf/make_report.py OUT_DIR

writes report-3.docx, report-300.docx, report-1000.docx (headings, body
paragraphs, bulleted and numbered lists, a table every few pages, a header and
a footer with a PAGE field, one explicit page break per page) and
images-20mb.docx (40 incompressible PNG pictures, about 20 MB). The output is
deterministic, so a run can be repeated byte for byte. Nothing is committed.
"""

from __future__ import annotations

import random
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from xml.sax.saxutils import escape

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
FIXED_TIME = (2026, 1, 2, 3, 4, 6)

WORDS = (
    "the survey team measured water levels at each station along the river and "
    "recorded the results in the field notes before the morning shift report "
    "shows that flow increased after the storm while sediment readings stayed "
    "within the expected range for the season so the method remains sound and "
    "further sampling is planned for the north bank where the bridge crosses "
    "the current near the old stone meadow"
).split()

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>"""

CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>River survey report</dc:title><dc:creator>LeanDoc tests</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-02T03:04:06Z</dcterms:created>
</cp:coreProperties>"""

STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/>
</w:tblBorders></w:tblPr></w:style>
</w:styles>"""

NUMBERING = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{W_NS}">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"""

HEADER = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="{W_NS}"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>River survey report, internal draft</w:t></w:r></w:p></w:hdr>"""

FOOTER = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="{W_NS}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>
<w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>"""


def sentence(rng: random.Random, low: int = 12, high: int = 24) -> str:
    words = [rng.choice(WORDS) for _ in range(rng.randint(low, high))]
    text = " ".join(words)
    return text[0].upper() + text[1:] + "."


def paragraph(text: str, style: str | None = None, extra: str = "") -> str:
    properties = f'<w:pPr><w:pStyle w:val="{style}"/>{extra}</w:pPr>' if style or extra else ""
    if not style and extra:
        properties = f"<w:pPr>{extra}</w:pPr>"
    return f'<w:p>{properties}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def rich_paragraph(rng: random.Random) -> str:
    runs = []
    for index in range(rng.randint(3, 5)):
        text = sentence(rng) + " "
        props = ""
        if index == 1:
            props = "<w:rPr><w:b/></w:rPr>"
        elif index == 3:
            props = "<w:rPr><w:i/></w:rPr>"
        runs.append(f'<w:r>{props}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>')
    return "<w:p>" + "".join(runs) + "</w:p>"


def table(rng: random.Random, page: int) -> str:
    rows = []
    header = ["Station", "Level (m)", "Flow (m3/s)", "Note"]
    for row in range(5):
        cells = []
        for column in range(4):
            if row == 0:
                text = header[column]
            elif column == 0:
                text = f"S{page:04d}-{row}"
            elif column == 3:
                text = " ".join(rng.choice(WORDS) for _ in range(3))
            else:
                text = f"{rng.uniform(0.5, 9.5):.2f}"
            shade = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tcPr>' if row == 0 else ""
            cells.append(f"<w:tc>{shade}{paragraph(text)}</w:tc>")
        rows.append("<w:tr>" + "".join(cells) + "</w:tr>")
    grid = "".join('<w:gridCol w:w="2250"/>' for _ in range(4))
    return (f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>'
            f"<w:tblGrid>{grid}</w:tblGrid>{''.join(rows)}</w:tbl>")


def build_body(pages: int, seed: int) -> str:
    rng = random.Random(seed)
    parts = [paragraph("River survey report", "Title"),
             rich_paragraph(rng)]
    for page in range(1, pages + 1):
        if page % 5 == 1:
            parts.append(paragraph(f"Part {page // 5 + 1}: survey of reach {page // 5 + 1}", "Heading1"))
        parts.append(paragraph(f"Section {page}. Station readings and notes", "Heading2"))
        parts.append(rich_paragraph(rng))
        parts.append(rich_paragraph(rng))
        if page % 3 == 0:
            for item in range(3):
                parts.append(paragraph(sentence(rng, 6, 12), "ListParagraph",
                                       f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{1 + item % 1 + (page % 2)}"/></w:numPr>'))
        if page % 4 == 0:
            parts.append(table(rng, page))
        parts.append(rich_paragraph(rng))
        if page < pages:
            parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    return "".join(parts)


def section_properties(header: bool = True) -> str:
    refs = ('<w:headerReference w:type="default" r:id="rId10"/>'
            '<w:footerReference w:type="default" r:id="rId11"/>') if header else ""
    return (f'<w:sectPr>{refs}<w:pgSz w:w="12240" w:h="15840"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
            'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')


def document_xml(body: str) -> str:
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}" '
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f"<w:body>{body}{section_properties()}</w:body></w:document>")


def document_rels(images: int = 0) -> str:
    rels = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
        '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
        '<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    ]
    for index in range(images):
        rels.append(f'<Relationship Id="rIdImg{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{index}.png"/>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(rels) + "</Relationships>")


def write_package(path: Path, document: str, rels: str, media: dict[str, bytes] | None = None):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        def add(name: str, data, compress=True):
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
            package.writestr(info, data)
        add("[Content_Types].xml", CONTENT_TYPES)
        add("_rels/.rels", ROOT_RELS)
        add("docProps/core.xml", CORE)
        add("word/document.xml", document)
        add("word/_rels/document.xml.rels", rels)
        add("word/styles.xml", STYLES)
        add("word/numbering.xml", NUMBERING)
        add("word/header1.xml", HEADER)
        add("word/footer1.xml", FOOTER)
        for name, data in (media or {}).items():
            add(name, data, compress=False)


def make_report(path: Path, pages: int) -> Path:
    write_package(path, document_xml(build_body(pages, seed=pages)), document_rels())
    return path


def noise_png(width: int, height: int, seed: int) -> bytes:
    rng = random.Random(seed)
    rows = b"".join(b"\x00" + rng.randbytes(width * 3) for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) +
            chunk(b"IDAT", zlib.compress(rows, 1)) + chunk(b"IEND", b""))


def image_paragraph(index: int, cx: int, cy: int) -> str:
    return (f'<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{index + 1}" name="Picture {index + 1}"/>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic><pic:nvPicPr><pic:cNvPr id="{index + 1}" name="image{index}.png"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="rIdImg{index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')


def make_image_heavy(path: Path, images: int = 40, width: int = 420, height: int = 400) -> Path:
    rng = random.Random(20)
    media = {}
    parts = [paragraph("Photo log", "Title")]
    for index in range(images):
        media[f"word/media/image{index}.png"] = noise_png(width, height, index)
        parts.append(paragraph(f"Photo {index + 1}. {sentence(rng, 6, 10)}", "Heading2"))
        parts.append(image_paragraph(index, 4572000, int(4572000 * height / width)))
        if index % 2 == 1 and index < images - 1:
            parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    write_package(path, document_xml("".join(parts)), document_rels(images), media)
    return path


def make_all(directory: Path) -> dict[str, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    made = {}
    for pages in (3, 300, 1000):
        made[f"report-{pages}"] = make_report(directory / f"report-{pages}.docx", pages)
    made["images-20mb"] = make_image_heavy(directory / "images-20mb.docx")
    return made


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    for name, path in make_all(Path(sys.argv[1])).items():
        print(f"{name}: {path} ({path.stat().st_size / 1048576:.1f} MiB)")
