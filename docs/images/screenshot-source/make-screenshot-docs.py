#!/usr/bin/env python3
"""Writes the two sample documents used for the README and site screenshots.

  python3 docs/images/screenshot-source/make-screenshot-docs.py

Needs python-docx 1.2. The organisation, people, and figures in the documents
are invented. The output is written next to this script:

- library-renovation-report.docx: a short report with headings, a table, a
  bulleted list, a footnote, and an Arabic summary paragraph.
- review-draft.docx: a draft with a floating text box and tracked changes, so
  that the fidelity bar has something to say.
"""
import copy
import pathlib

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Pt, RGBColor, Cm

HERE = pathlib.Path(__file__).resolve().parent
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
FOOTNOTES_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"


def base_document(title):
    document = Document()
    properties = document.core_properties
    properties.title = title
    properties.author = "Harbour Street Library"
    properties.last_modified_by = "Harbour Street Library"
    properties.comments = ""
    properties.keywords = ""
    properties.revision = 1
    section = document.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.3)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.2)

    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = "Cambria"
    normal.font.size = Pt(10.5)
    # Put the body font in the document defaults too, so styles that are not
    # based on Normal (the list styles) use it as well.
    defaults = styles.element.find(qn("w:docDefaults"))
    r_pr = defaults.find(qn("w:rPrDefault")).find(qn("w:rPr"))
    for old in r_pr.findall(qn("w:rFonts")) + r_pr.findall(qn("w:sz")):
        r_pr.remove(old)
    r_pr.insert(0, parse_xml(f'<w:rFonts {nsdecls("w")} w:ascii="Cambria" w:hAnsi="Cambria" '
                             'w:cs="Arial"/>'))
    r_pr.append(parse_xml(f'<w:sz {nsdecls("w")} w:val="21"/>'))
    normal.paragraph_format.space_after = Pt(7)
    normal.paragraph_format.line_spacing = 1.18
    for name, size, color in (("Title", 24, "1A1917"), ("Heading 1", 15, "1D3557"),
                              ("Heading 2", 12, "1D3557")):
        style = styles[name]
        style.font.name = "Calibri"
        style.font.size = Pt(size)
        style.font.bold = name != "Title"
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(14 if name != "Title" else 0)
        style.paragraph_format.space_after = Pt(6)
    title_style = styles["Title"]
    # Drop the template's bottom border under the title.
    p_pr = title_style.element.get_or_add_pPr()
    for border in p_pr.findall(qn("w:pBdr")):
        p_pr.remove(border)
    return document


def add_footnotes_part(document, notes):
    """Adds word/footnotes.xml with the separator notes and the given notes."""
    body = "".join(
        f'<w:footnote w:id="{index}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>'
        f'<w:r><w:t xml:space="preserve"> {text}</w:t></w:r></w:p></w:footnote>'
        for index, text in notes)
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:footnotes xmlns:w="{W}">'
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" '
        'w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" '
        'w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p>'
        '</w:footnote>' + body + '</w:footnotes>')
    part = Part(PackURI("/word/footnotes.xml"), FOOTNOTES_CT, xml.encode("utf-8"),
                document.part.package)
    document.part.relate_to(part, RT.FOOTNOTES)
    # Name the separator notes in settings, as Word does, so they are not
    # counted when the notes are numbered.
    settings = document.settings.element
    footnote_pr = parse_xml(f'<w:footnotePr {nsdecls("w")}><w:footnote w:id="-1"/>'
                            '<w:footnote w:id="0"/></w:footnotePr>')
    compat = settings.find(qn("w:compat"))
    if compat is not None:
        compat.addprevious(footnote_pr)
    else:
        settings.append(footnote_pr)
    styles = document.styles.element
    styles.append(parse_xml(
        f'<w:style {nsdecls("w")} w:type="paragraph" w:styleId="FootnoteText">'
        '<w:name w:val="footnote text"/><w:basedOn w:val="Normal"/>'
        '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
        '<w:rPr><w:sz w:val="17"/></w:rPr></w:style>'))


def footnote_reference(paragraph, note_id):
    paragraph._p.append(parse_xml(
        f'<w:r {nsdecls("w")}>'
        f'<w:footnoteReference w:id="{note_id}"/></w:r>'))


def shade(cell, fill):
    cell._tc.get_or_add_tcPr().append(parse_xml(
        f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{fill}"/>'))


def report():
    document = base_document("Harbour Street Library renovation report")
    document.add_paragraph("Harbour Street Library", style="Title")
    meta = document.add_paragraph()
    run = meta.add_run("Renovation report to the board  |  September 2026")
    run.font.name = "Calibri"
    run.font.size = Pt(9.5)
    run.font.color.rgb = RGBColor.from_string("5A554C")

    document.add_heading("Summary", level=1)
    p = document.add_paragraph(
        "The reading rooms reopened on 1 September after fourteen weeks of work. "
        "The project finished two days early and 3.1 percent under budget. Visits in "
        "the first month were 18 percent higher than in September last year, and the "
        "new study tables were booked on most weekday afternoons.")
    footnote_reference(p, 1)
    document.add_paragraph(
        "This report sets out what was done, what it cost, and what the board is asked "
        "to approve for the second phase.")

    document.add_heading("What changed", level=1)
    for text in (
            "New lighting in both reading rooms, on daylight sensors.",
            "Forty study places with power, up from twelve.",
            "A step-free entrance from Harbour Street and a lift to the archive.",
            "Shelving for the local history collection, moved out of storage."):
        document.add_paragraph(text, style="List Bullet")

    document.add_heading("Costs", level=1)
    rows = (("Work package", "Budget", "Spent", "Difference"),
            ("Lighting and power", "£48,000", "£45,900", "−£2,100"),
            ("Entrance and lift", "£96,500", "£95,200", "−£1,300"),
            ("Shelving and furniture", "£31,000", "£30,400", "−£600"),
            ("Total", "£175,500", "£171,500", "−£4,000"))
    table = document.add_table(rows=len(rows), cols=4)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    widths = (Cm(6.4), Cm(3.1), Cm(3.1), Cm(3.1))
    for r, values in enumerate(rows):
        for c, value in enumerate(values):
            cell = table.cell(r, c)
            cell.width = widths[c]
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(2)
            paragraph.paragraph_format.space_before = Pt(2)
            if c:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            run = paragraph.add_run(value)
            run.font.name = "Calibri"
            run.font.size = Pt(9.5)
            if r == 0 or r == len(rows) - 1:
                run.bold = True
            if r == 0:
                shade(cell, "E8EEF6")
            elif r == len(rows) - 1:
                shade(cell, "F4F2EE")

    document.add_heading("Next steps", level=1)
    document.add_paragraph(
        "The board is asked to approve the second phase, the children's library and "
        "the garden room, at a budget of £122,000, starting in January 2027.")

    document.add_heading("ملخص بالعربية", level=2)
    arabic = document.add_paragraph(
        "أُعيد افتتاح قاعات القراءة في الأول من سبتمبر بعد أربعة عشر أسبوعًا من العمل. "
        "انتهى المشروع قبل موعده بيومين وبتكلفة أقل من الميزانية.")
    for paragraph in document.paragraphs[-2:]:
        # w:bidi comes first in w:pPr after the style, as the schema orders it.
        p_pr = paragraph._p.get_or_add_pPr()
        p_style = p_pr.find(qn("w:pStyle"))
        bidi = parse_xml(f'<w:bidi {nsdecls("w")}/>')
        if p_style is not None:
            p_style.addnext(bidi)
        else:
            p_pr.insert(0, bidi)
        for r in paragraph.runs:
            r._r.get_or_add_rPr().append(parse_xml(f'<w:rtl {nsdecls("w")}/>'))

    add_footnotes_part(document, [(1, "Door counter totals, 1 to 30 September 2026, "
                                      "compared with the same days in 2025.")])
    document.save(HERE / "library-renovation-report.docx")


TEXT_BOX = (
    '<w:r {ns}><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" '
    'simplePos="0" relativeHeight="251659265" behindDoc="0" locked="0" layoutInCell="1" '
    'allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">'
    '<wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph">'
    '<wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2286000" cy="685800"/>'
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>'
    '<wp:docPr id="10" name="Text Box 10"/><wp:cNvGraphicFramePr/>'
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>'
    '<a:ext cx="2286000" cy="685800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
    '</wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Quote from a visitor survey.</w:t>'
    '</w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>'
    '</wp:anchor></w:drawing></w:r>')
NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"')
AUTHOR = 'w:author="Editor" w:date="2026-09-20T09:00:00Z"'


def review_draft():
    document = base_document("Harbour Street Library newsletter draft")
    document.add_paragraph("Autumn newsletter", style="Title")
    meta = document.add_paragraph()
    run = meta.add_run("Draft for review  |  Harbour Street Library")
    run.font.name = "Calibri"
    run.font.size = Pt(9.5)
    run.font.color.rgb = RGBColor.from_string("5A554C")

    document.add_heading("The reading rooms are open again", level=1)
    p = document.add_paragraph()
    p.add_run("After fourteen weeks of building work, both reading rooms ")
    p._p.append(parse_xml(f'<w:ins {nsdecls("w")} w:id="1" {AUTHOR}><w:r><w:t xml:space="preserve">'
                          'reopened on 1 September. </w:t></w:r></w:ins>'))
    p._p.append(parse_xml(f'<w:del {nsdecls("w")} w:id="2" {AUTHOR}><w:r><w:delText xml:space="preserve">'
                          'will reopen some time in the autumn. </w:delText></w:r></w:del>'))
    p.add_run("There are forty study places with power, new lighting, and a step-free "
              "entrance from Harbour Street.")

    p = document.add_paragraph()
    p._p.append(parse_xml(TEXT_BOX.format(ns=NS)))
    p.add_run("Visitors have noticed. In the first month, 6,212 people came through the "
              "doors, 18 percent more than last September. The study tables are booked on "
              "most weekday afternoons, so please reserve a place at the front desk.")

    document.add_heading("Local history, out of storage", level=1)
    p = document.add_paragraph()
    p.add_run("The local history collection now has its own shelves on the ground floor. ")
    p._p.append(parse_xml(f'<w:ins {nsdecls("w")} w:id="3" {AUTHOR}><w:r><w:t xml:space="preserve">'
                          'Volunteers catalogued 2,400 items over the summer. </w:t></w:r></w:ins>'))
    p.add_run("The archive is reached by the new lift and is open on Tuesdays and Saturdays.")

    document.add_heading("Coming in January", level=1)
    document.add_paragraph(
        "Work on the children's library and the garden room starts in January, if the "
        "board approves the second phase in November. The children's library stays open "
        "during the work, in the reading room on the first floor.")
    for text in ("Story time moves to Saturday mornings at 10:30.",
                 "Homework club keeps its Tuesday and Thursday sessions.",
                 "The garden room is closed until the spring."):
        document.add_paragraph(text, style="List Bullet")
    document.add_heading("Opening hours", level=1)
    document.add_paragraph(
        "Monday to Friday, 9:00 to 19:00. Saturday, 10:00 to 16:00. Closed on Sundays "
        "and public holidays.")
    document.save(HERE / "review-draft.docx")


if __name__ == "__main__":
    report()
    review_draft()
    print("Wrote", HERE / "library-renovation-report.docx", "and", HERE / "review-draft.docx")
