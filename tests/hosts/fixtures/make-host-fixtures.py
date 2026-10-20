#!/usr/bin/env python3
"""Writes the small, deterministic documents the host smoke tests open.

The files are committed. Run this again only when the fixtures must change:

    python3 tests/hosts/fixtures/make-host-fixtures.py
"""

from __future__ import annotations

import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXED_TIME = (2000, 1, 1, 0, 0, 0)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>
"""

PACKAGE_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>
"""

DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>
"""

CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>{title}</dc:title>
</cp:coreProperties>
"""


def document_xml(heading: str, paragraphs: list[str]) -> str:
    body = [
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
        f"<w:r><w:t>{heading}</w:t></w:r></w:p>"
    ]
    for text in paragraphs:
        body.append(f'<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>" + "".join(body) +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        "</w:body></w:document>\n"
    )


def write_docx(path: Path, title: str, heading: str, paragraphs: list[str]) -> None:
    parts = [
        ("[Content_Types].xml", CONTENT_TYPES),
        ("_rels/.rels", PACKAGE_RELS),
        ("word/document.xml", document_xml(heading, paragraphs)),
        ("word/_rels/document.xml.rels", DOCUMENT_RELS),
        ("word/styles.xml", STYLES),
        ("docProps/core.xml", CORE.format(title=title)),
    ]
    with zipfile.ZipFile(path, "w") as archive:
        for name, text in parts:
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, text.encode("utf-8"))


def main() -> None:
    write_docx(
        HERE / "smoke.docx",
        "LeanDoc host smoke test",
        "LeanDoc host smoke test",
        [
            "This document checks that a native host can read a file, hand the "
            "package to the reader, and receive the rendered message.",
            "It has one heading and two paragraphs.",
        ],
    )
    write_docx(
        HERE / "second.docx",
        "Second tab",
        "Second tab",
        ["A second document for tab and single-instance checks."],
    )
    (HERE / "plain.rtf").write_bytes(
        b"{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0 LeanDoc fallback check.\\par}\n"
    )
    print("Wrote smoke.docx, second.docx, and plain.rtf")


if __name__ == "__main__":
    main()
