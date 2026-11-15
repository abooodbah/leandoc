"""Writes two synthetic .docx files for the LeanDoc 0.3.0 Store screenshots.

  python docs/images/screenshot-source/make-store-paper-docs.py OUT_DIR

Needs Pillow for the chart picture. Every name, place, figure and sentence
in the documents is invented.

- weather-station-paper.docx: a two-column paper laid out as Word saves an
  IEEE paper: a one-column title with a footnote, a page number in the
  header, numbered small-capital headings, a table that floats at the top of
  page 2 and a figure that floats at the foot of page 2 (VML text boxes
  wrapped top and bottom), and a reference list with hanging indents.
- field-handbook.docx: a handbook whose first page is a contents page with
  dot leaders and right-aligned page numbers.
"""
import io
import sys
import zipfile
import pathlib
from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = (f'xmlns:w="{W}" xmlns:r="{R}" xmlns:v="urn:schemas-microsoft-com:vml" '
      'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def p(text, style=None, extra_ppr="", rpr=""):
    ppr = f'<w:pPr>{f"<w:pStyle w:val=\"{style}\"/>" if style else ""}{extra_ppr}</w:pPr>'
    run_pr = f"<w:rPr>{rpr}</w:rPr>" if rpr else ""
    return f'<w:p>{ppr}<w:r>{run_pr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'


def chart_png():
    img = Image.new("RGB", (1200, 470), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/times.ttf", 30)
        small = ImageFont.truetype("C:/Windows/Fonts/times.ttf", 26)
    except OSError:
        font = small = ImageFont.load_default()
    left, base, top = 120, 390, 80
    d.line([(left, top), (left, base)], fill="black", width=3)
    d.line([(left, base), (1160, base)], fill="black", width=3)
    for i, label in enumerate(["0", "20", "40", "60", "80"]):
        y = base - i * 75
        d.line([(left - 10, y), (left, y)], fill="black", width=2)
        d.text((left - 60, y - 16), label, fill="black", font=small)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"]
    always = [72, 70, 66, 61, 57, 55, 56, 59, 64, 69]
    duty = [31, 29, 26, 22, 19, 18, 18, 21, 24, 28]
    for i, m in enumerate(months):
        x = left + 30 + i * 102
        d.rectangle([x, base - always[i] * 3.75, x + 38, base], fill="#9a9a9a")
        d.rectangle([x + 42, base - duty[i] * 3.75, x + 80, base], fill="#303030")
        d.text((x + 18, base + 12), m, fill="black", font=small)
    d.rectangle([360, 20, 386, 42], fill="#9a9a9a")
    d.text((396, 14), "Radio always on", fill="black", font=font)
    d.rectangle([680, 20, 706, 42], fill="#303030")
    d.text((716, 14), "Duty-cycled radio", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def write_docx(name, document_xml, styles, extra_parts=None, rels_extra="", ct_extra=""):
    parts = extra_parts or {}
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          f'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>{ct_extra}</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                 '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
                 '</Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
                f'{rels_extra}</Relationships>')
    settings = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="{W}"><w:defaultTabStop w:val="720"/>'
                '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>')
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties '
            'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sample document</dc:title><dc:creator>LeanDoc samples</dc:creator></cp:coreProperties>')
    with zipfile.ZipFile(OUT / name, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("docProps/core.xml", core)
        z.writestr("word/document.xml", document_xml)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        z.writestr("word/styles.xml", styles)
        z.writestr("word/settings.xml", settings)
        for k, v in parts.items():
            z.writestr(k, v)


# ---------------------------------------------------------------- the paper
PAPER_STYLES = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="200"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="160"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Authors"><w:name w:val="Authors"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Abstract"><w:name w:val="Abstract"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:spacing w:before="240" w:after="80"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:smallCaps/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:spacing w:before="120" w:after="60"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Reference"><w:name w:val="Reference"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="400" w:hanging="400"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>'''

HEADER = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="{W}"><w:p><w:pPr><w:pStyle w:val="Header"/><w:tabs><w:tab w:val="right" w:pos="10280"/></w:tabs></w:pPr>'
          '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>NORTHFIELD WORKSHOP ON SMALL SENSORS (SAMPLE)</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:tab/></w:r>'
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r>'
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>')

FOOTNOTES = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="{W}">'
             '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
             '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
             '<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>'
             '<w:r><w:t xml:space="preserve"> This is a sample document made for screenshots. The stations, people, and measurements in it are invented.</w:t></w:r></w:p></w:footnote>'
             '<w:footnote w:id="2"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>'
             '<w:r><w:t xml:space="preserve"> A wake-up costs about as much charge as 40 ms of listening, so very short sleeps save nothing.</w:t></w:r></w:p></w:footnote>'
             '</w:footnotes>')

PAGE = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1140" w:right="980" w:bottom="1000" w:left="980" w:header="500" w:footer="500" w:gutter="0"/>'

INTRO = [
    "Small weather stations are often placed where nobody visits for months: on hill farms, along rivers, and on the roofs of rural schools. Each one measures temperature, humidity, wind, and rain, and sends a short report every few minutes over a low-power radio link to a gateway in the nearest village.",
    "In the stations we looked after, the radio used more charge than every sensor together. A station whose radio listened all the time emptied its battery in about five weeks of winter, when the solar panel gives little. Replacing a battery on a hill station takes a day, so a longer life matters more than a faster link.",
    "This paper describes a simple schedule that lets the radio sleep between reports and wake only in agreed slots. It needs no change to the sensors and no new hardware. We tried it on twelve stations for ten months and report the charge used, the reports lost, and the delay added.",
    "Section II describes the stations and the gateway. Section III gives the schedule. Section IV reports what we measured, and Section V lists what we would change.",
]
STATIONS = [
    "Each station has a small solar panel, a 3.6 V battery of 6.8 Ah, a board with a low-power processor, and a radio module that can sleep. The sensors are read every minute and the readings are kept in memory until the next report.",
    "The gateway is mains powered and listens all the time. It forwards the reports over the mobile network to a server, where a volunteer checks them each morning. A station that misses three reports in a row is marked on a map.",
    "The stations sit between 2 and 14 km from their gateway. Six of them are on hills with a clear line to the gateway; the other six are in valleys, where the signal is weaker and a report sometimes has to be sent twice.",
]
BUDGET = [
    "In winter the panel gives between 20 and 60 mAh on a clear day and almost nothing under snow. The sensors and the processor need about 25 mAh a day together, so whatever the radio uses decides whether the battery lasts until spring.",
    "We measured each part of a station on the bench before the trial, with the radio in each of its states. Listening costs almost as much as sending, and a station listens far more often than it sends, so listening is where the charge goes.",
    "A report is about 60 bytes and takes less than half a second to send. With the radio always on, the station spends more than 99 percent of its time listening for messages that are almost never for it.",
]
SLOTS = [
    "A slot must be long enough for one report and one retry. We tried slots of 1, 2, and 4 seconds on the bench. One second was too short for the valley stations, which often need a second attempt, and four seconds left the gateway idle most of the minute.",
    "We chose 2 seconds, which gives 28 free slots after each beacon. The gateway gives a station the same slot each time unless two stations ask for it, so most stations keep their slot for weeks.",
    "The clocks on the stations drift by up to 2 seconds a day in the cold. Waking for one beacon in five keeps every station well inside its slot, and the gateway widens a slot by half a second for a station that has missed its last beacon.",
    "A station that joins the network, or comes back after a battery change, listens until it hears a beacon and then asks for a slot in the first free one. In the trial this took less than two minutes for every station, and no station had to ask twice.",
]
SCHEDULE = [
    "The gateway sends a short beacon every 60 seconds with the time and a list of free slots. A station that hears the beacon picks a slot, sends its report in that slot, and goes back to sleep until just before the next beacon it needs.",
    "A station does not need every beacon. It wakes for one beacon in five to keep its clock right, and for the beacon before its own slot. If it misses a beacon, it listens for up to two minutes and then tries again an hour later.",
    "Reports that fail are kept and sent with the next report, so a lost slot delays the readings but does not lose them. A station that has kept more than 24 reports sends them in the next free slots, one per slot.",
    "The schedule changes only the radio software. The sensors, the gateway hardware, and the server are the same as before.",
]
RESULTS = [
    "Table I gives the charge used by the radio on an average day in each season, with the radio always on and with the schedule. Fig. 1 shows the share of each month's charge that went to the radio.",
    "With the schedule, the radio used between 31 and 18 percent of the station's charge, against 72 to 55 percent before. In winter the hill stations kept their batteries above half charge for the whole season; with the radio always on, four of them had stopped by the end of January.",
    "Fewer than one report in two hundred was lost for good, and those were all from one valley station during a storm. The median delay from a reading to the server grew from 40 seconds to 3 minutes, which the volunteers said made no difference to them.",
    "The valley stations used about 20 percent more charge than the hill stations, mostly for sending reports twice. A better antenna on those six stations would help more than any change to the schedule.",
]
LIMITS = [
    "The schedule assumes that the gateway is always on. A gateway that loses power for a day leaves the stations listening for beacons every hour, which costs more than the old way for that day.",
    "We did not test more than twelve stations on one gateway. With the slot length we used, one gateway could serve about forty stations before reports start to wait for a free slot.",
    "Next winter we plan to let a station skip its report when nothing has changed, and to send the full readings only once an hour on calm days.",
]
REFS = [
    "A. Lindqvist and P. Moreau, \u201cKeeping small stations alive through winter,\u201d Sample Journal of Field Instruments, vol. 4, no. 2, pp. 11\u201319, 2024.",
    "R. Osei, \u201cSlotted listening for low-power radios,\u201d in Sample Workshop on Quiet Networks, 2023, pp. 40\u201347.",
    "J. Tanaka, M. Ruiz, and K. Hall, \u201cSolar budgets for remote sensors,\u201d Sample Letters on Energy, vol. 9, pp. 101\u2013108, 2022.",
    "S. Novak, \u201cWhy batteries fail in the cold,\u201d Sample Review of Small Systems, vol. 2, pp. 5\u201314, 2021.",
    "L. Brandt and C. Ade, \u201cBeacon timing on long rural links,\u201d Sample Transactions on Links, vol. 12, no. 7, pp. 233\u2013241, 2025.",
    "D. Farah, \u201cA field guide to station upkeep,\u201d Sample Press, 2020.",
    "E. Kowalski and T. Ng, \u201cStore and forward for weather reports,\u201d in Sample Meeting on Rural Data, 2024, pp. 88\u201395.",
    "H. Iqbal, \u201cMeasuring the charge of a sleeping radio,\u201d Sample Notes on Measurement, vol. 3, pp. 1\u20136, 2023.",
]


def heading(text, label=None):
    return p(text, "Heading1")


def floating_table():
    cell = lambda t, w=2570, b=False: (f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>'
                                       f'<w:r><w:rPr>{"<w:b/>" if b else ""}<w:sz w:val="16"/></w:rPr><w:t>{esc(t)}</w:t></w:r></w:p></w:tc>')
    rows = [("Season", "Radio always on (mAh/day)", "With the schedule (mAh/day)", "Saved", True),
            ("Winter", "118", "46", "61%", False), ("Spring", "104", "37", "64%", False),
            ("Summer", "96", "33", "66%", False), ("Autumn", "109", "41", "62%", False)]
    trs = "".join(f"<w:tr>{cell(a, b=h)}{cell(b_, b=h)}{cell(c, b=h)}{cell(d, b=h)}</w:tr>" for a, b_, c, d, h in rows)
    table = (f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10280" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>'
             f'<w:tblGrid><w:gridCol w:w="2570"/><w:gridCol w:w="2570"/><w:gridCol w:w="2570"/><w:gridCol w:w="2570"/></w:tblGrid>{trs}</w:tbl>')
    caption = ('<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:smallCaps/><w:sz w:val="16"/></w:rPr><w:t>Table I</w:t></w:r></w:p>'
               '<w:p><w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="80"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:smallCaps/><w:sz w:val="16"/></w:rPr><w:t>Charge used by the radio on an average day (sample data)</w:t></w:r></w:p>')
    style = ("position:absolute;margin-left:0;margin-top:0;width:514pt;height:90pt;z-index:251659265;visibility:visible;"
             "mso-wrap-style:square;mso-wrap-distance-left:0;mso-wrap-distance-top:0;mso-wrap-distance-right:0;mso-wrap-distance-bottom:12pt;"
             "mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:absolute;mso-position-vertical-relative:margin;v-text-anchor:top")
    return ('<w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>'
            f'<v:shape id="Table box" o:spid="_x0000_s1026" type="#_x0000_t202" style="{style}" o:allowoverlap="f" filled="f" stroked="f">'
            f'<v:textbox style="mso-fit-shape-to-text:t" inset="0,0,0,0"><w:txbxContent>{caption}{table}<w:p/></w:txbxContent></v:textbox>'
            '<w10:wrap type="topAndBottom" anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>')


def floating_figure():
    cx, cy = int(480 * 12700), int(188 * 12700)
    pic = (f'<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
           '<wp:docPr id="1" name="Chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
           '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr>'
           '<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
           f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
           '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')
    caption = ('<w:p><w:pPr><w:ind w:firstLine="0"/><w:spacing w:before="60"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr>'
               '<w:t xml:space="preserve">Fig. 1. Share of each month\u2019s charge used by the radio, in percent, averaged over the twelve stations (sample data).</w:t></w:r></w:p>')
    style = ("position:absolute;margin-left:0;margin-top:0;width:514pt;height:210pt;z-index:251659266;visibility:visible;"
             "mso-wrap-style:square;mso-wrap-distance-left:0;mso-wrap-distance-top:12pt;mso-wrap-distance-right:0;mso-wrap-distance-bottom:0;"
             "mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:bottom;mso-position-vertical-relative:margin;v-text-anchor:top")
    return ('<w:r><w:rPr><w:noProof/></w:rPr><w:pict>'
            f'<v:shape id="Figure box" o:spid="_x0000_s1027" type="#_x0000_t202" style="{style}" o:allowoverlap="f" filled="f" stroked="f">'
            f'<v:textbox style="mso-fit-shape-to-text:t" inset="0,0,0,0"><w:txbxContent>{pic}{caption}</w:txbxContent></v:textbox>'
            '<w10:wrap type="topAndBottom" anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>')


def paper():
    body = []
    body.append(p("Letting the Radio Sleep: A Simple Schedule for Small Weather Stations", "Title"))
    body.append('<w:p><w:pPr><w:pStyle w:val="Authors"/>'
                f'<w:sectPr><w:headerReference w:type="default" r:id="rId4"/>{PAGE}<w:cols w:space="240"/></w:sectPr></w:pPr>'
                '<w:r><w:t>Mira Okafor and Lukas Brandt, Northfield Station Volunteers (sample)</w:t></w:r>'
                '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>')
    body.append('<w:p><w:pPr><w:pStyle w:val="Abstract"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Abstract</w:t></w:r>'
                '<w:r><w:t xml:space="preserve">: Small weather stations in remote places spend most of their battery on the radio. We describe a schedule that lets the radio sleep between reports and wake only in agreed slots. On twelve stations over ten months it cut the radio\u2019s share of the charge from about two thirds to about one quarter, lost fewer than one report in two hundred, and added a median delay of under three minutes.</w:t></w:r></w:p>')
    body.append(heading("I. Introduction"))
    body += [p(t) for t in INTRO]
    body.append(heading("II. The Stations"))
    body += [p(t) for t in STATIONS]
    body.append(p("A. Power budget", "Heading2"))
    body += [p(t) for t in BUDGET]
    body.append(heading("III. The Schedule"))
    body.append(p(SCHEDULE[0]))
    body.append(f'<w:p><w:r><w:t xml:space="preserve">{esc(SCHEDULE[1])}</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r></w:p>')
    body += [p(t) for t in SCHEDULE[2:]]
    body.append(p("B. Choosing the slot length", "Heading2"))
    body += [p(t) for t in SLOTS]
    body.append(f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>{floating_table()}<w:r><w:t>IV. What We Measured</w:t></w:r></w:p>')
    body.append(p(RESULTS[0]))
    body.append(f'<w:p>{floating_figure()}<w:r><w:t xml:space="preserve">{esc(RESULTS[1])}</w:t></w:r></w:p>')
    body += [p(t) for t in RESULTS[2:]]
    body.append(heading("V. Limits and Next Steps"))
    body += [p(t) for t in LIMITS]
    body.append(heading("References"))
    for i, ref in enumerate(REFS, 1):
        body.append(f'<w:p><w:pPr><w:pStyle w:val="Reference"/></w:pPr><w:r><w:t>[{i}]</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">{esc(ref)}</w:t></w:r></w:p>')
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{"".join(body)}'
           f'<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:type w:val="continuous"/>{PAGE}<w:cols w:num="2" w:space="240"/></w:sectPr></w:body></w:document>')
    rels = ('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
            '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
            '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/>')
    ct = ('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>')
    write_docx("weather-station-paper.docx", doc, PAPER_STYLES,
               {"word/footnotes.xml": FOOTNOTES, "word/header1.xml": HEADER, "word/media/chart.png": chart_png()}, rels, ct)


# ------------------------------------------------------------- the handbook
HB_STYLES = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="1F3864"/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="480"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="2F5496"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:before="120" w:after="60"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="220"/></w:pPr></w:style>
</w:styles>'''

CHAPTERS = [
    ("1. Before you go", [("1.1 What to take", 2), ("1.2 Telling the gateway you are coming", 2), ("1.3 Weather and access", 2)]),
    ("2. Checking a station", [("2.1 The ten-minute check", 3), ("2.2 Reading the status light", 3), ("2.3 Cleaning the rain gauge", 3)]),
    ("3. Batteries and solar panels", [("3.1 Measuring the battery", 4), ("3.2 Changing a battery safely", 4), ("3.3 Panels in winter", 4)]),
    ("4. The radio", [("4.1 How the schedule works", 5), ("4.2 When a station goes quiet", 5), ("4.3 Moving the antenna", 5)]),
    ("5. Records", [("5.1 The visit log", 6), ("5.2 Photographs", 6), ("5.3 Sending the log", 6)]),
]
CHAPTER_PAGES = [2, 3, 4, 5, 6]

TEXT = {
    "1.1 What to take": "A charged spare battery, the small tool roll, a clean cloth, a bottle of water for the rain gauge, the visit log, and a phone with the station map. In winter, take gloves that let you use the screwdriver.",
    "1.2 Telling the gateway you are coming": "Send a message to the duty volunteer the evening before. They mark the station as being visited, so the reports you cause while testing do not raise an alarm.",
    "1.3 Weather and access": "Do not climb to a roof station in wind above 40 km/h or on ice. Some farm tracks close after heavy rain; the map shows which ones and who to ask.",
}


def handbook():
    body = [p("Station Volunteer Handbook", "Title"), p("Northfield sample network \u2022 Edition 3 \u2022 A sample document with invented content", "Subtitle"),
            p("Contents", "TOCHeading")]
    for (chap, subs), page in zip(CHAPTERS, CHAPTER_PAGES):
        body.append(f'<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t xml:space="preserve">{esc(chap)}</w:t></w:r><w:r><w:tab/><w:t>{page}</w:t></w:r></w:p>')
        for sub, sp in subs:
            body.append(f'<w:p><w:pPr><w:pStyle w:val="TOC2"/></w:pPr><w:r><w:t xml:space="preserve">{esc(sub)}</w:t></w:r><w:r><w:tab/><w:t>{sp}</w:t></w:r></w:p>')
    body.append(f'<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t xml:space="preserve">Appendix: Station list</w:t></w:r><w:r><w:tab/><w:t>7</w:t></w:r></w:p>')
    for chap, subs in CHAPTERS:
        body.append(p(chap, "Heading1"))
        body.append(p("This chapter is part of a sample handbook. Its text is invented and only shows how LeanDoc lays out headings, paragraphs, and a contents page."))
        for sub, _ in subs:
            body.append(p(sub, "Heading2"))
            body.append(p(TEXT.get(sub, "Follow the steps in order and write each result in the visit log. If anything looks different from the photographs in the station folder, take a picture and note the time.")))
    body.append(p("Appendix: Station list", "Heading1"))
    body.append(p("Twelve sample stations, numbered N01 to N12, with their gateway and the nearest place to park."))
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{"".join(body)}'
           '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>')
    write_docx("field-handbook.docx", doc, HB_STYLES)


paper()
handbook()
print("written to", OUT)
