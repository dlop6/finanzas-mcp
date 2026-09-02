from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    NextPageTemplate,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "final-report.md"
OUTPUT = ROOT / "output" / "pdf" / "finance-mcp-final-report.pdf"
TEMP = ROOT / "tmp" / "pdfs" / "un-58"
NAVY = colors.HexColor("#17365D")
INK = colors.HexColor("#20242A")
LIGHT_BLUE = colors.HexColor("#EAF1F8")
GRID = colors.HexColor("#A7B4C2")


@dataclass
class ParsedDocument:
    metadata: dict[str, str]
    body: list[str]


def parse_source(path: Path) -> ParsedDocument:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        raise ValueError("Markdown metadata block is required")
    _, meta_block, body = raw.split("---\n", 2)
    metadata: dict[str, str] = {}
    for line in meta_block.splitlines():
        if not line.strip():
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip('"')
    required = {
        "title", "subtitle", "author", "student_id", "institution", "faculty",
        "department", "course", "section", "date", "pdf_filename",
    }
    missing = required - metadata.keys()
    if missing:
        raise ValueError(f"Missing metadata: {', '.join(sorted(missing))}")
    return ParsedDocument(metadata, body.splitlines())


def inline(text: str) -> str:
    text = escape(text)
    text = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"\*([^*]+)\*", r"<i>\1</i>", text)
    text = re.sub(
        r"(https?://[^\s<.,]+(?:\.[^\s<.,]+)*)",
        r'<link href="\1" color="#17365D">\1</link>',
        text,
    )
    return text


class ReportDocument(BaseDocTemplate):
    def __init__(self, filename: str, metadata: dict[str, str]):
        self.metadata = metadata
        self._heading_index = 0
        portrait = letter
        horizontal = landscape(letter)
        portrait_frame = Frame(20 * mm, 18 * mm, portrait[0] - 40 * mm, portrait[1] - 34 * mm, id="portrait")
        landscape_frame = Frame(20 * mm, 18 * mm, horizontal[0] - 40 * mm, horizontal[1] - 34 * mm, id="landscape")
        super().__init__(filename, pagesize=portrait, rightMargin=20 * mm, leftMargin=20 * mm, topMargin=18 * mm, bottomMargin=16 * mm)
        self.addPageTemplates([
            __import__("reportlab.platypus", fromlist=["PageTemplate"]).PageTemplate(id="cover", frames=[portrait_frame], onPage=self.cover_page),
            __import__("reportlab.platypus", fromlist=["PageTemplate"]).PageTemplate(id="portrait", frames=[portrait_frame], onPage=self.regular_page),
            __import__("reportlab.platypus", fromlist=["PageTemplate"]).PageTemplate(id="landscape", pagesize=horizontal, frames=[landscape_frame], onPage=self.regular_page),
        ])

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and hasattr(flowable, "_toc_level"):
            text = flowable.getPlainText()
            self.notify("TOCEntry", (flowable._toc_level, text, self.page - 1))

    def cover_page(self, canvas, doc):
        canvas.setTitle(self.metadata["title"])
        canvas.setAuthor(self.metadata["author"])
        canvas.setSubject(self.metadata["subtitle"])

    def regular_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(NAVY)
        canvas.setLineWidth(0.6)
        width, height = canvas._pagesize
        canvas.line(20 * mm, height - 12 * mm, width - 20 * mm, height - 12 * mm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(INK)
        canvas.drawString(20 * mm, height - 9 * mm, "Proyecto 1 - Finance MCP")
        canvas.drawRightString(width - 20 * mm, height - 9 * mm, self.metadata["course"])
        canvas.drawCentredString(width / 2, 9 * mm, str(canvas.getPageNumber() - 1))
        canvas.restoreState()


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("Title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=27, leading=32, alignment=TA_CENTER, textColor=INK, spaceAfter=12),
        "subtitle": ParagraphStyle("Subtitle", parent=base["Normal"], fontName="Helvetica", fontSize=15, leading=20, alignment=TA_CENTER, textColor=NAVY, spaceAfter=28),
        "h1": ParagraphStyle("H1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY, spaceBefore=7, spaceAfter=8, keepWithNext=True),
        "h2": ParagraphStyle("H2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=NAVY, spaceBefore=7, spaceAfter=5, keepWithNext=True),
        "body": ParagraphStyle("Body", parent=base["BodyText"], fontName="Helvetica", fontSize=10.5, leading=14, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7),
        "list": ParagraphStyle("List", parent=base["BodyText"], fontName="Helvetica", fontSize=10.2, leading=13, textColor=INK, leftIndent=14, firstLineIndent=-9, spaceAfter=3),
        "code": ParagraphStyle("Code", parent=base["Code"], fontName="Courier", fontSize=8.3, leading=10.5, textColor=INK, backColor=colors.HexColor("#F3F6F8"), borderColor=GRID, borderWidth=0.4, borderPadding=6, spaceBefore=4, spaceAfter=8),
        "caption": ParagraphStyle("Caption", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8.5, leading=10.5, alignment=TA_CENTER, textColor=INK, spaceBefore=5),
        "toc": ParagraphStyle("TOC", parent=base["Normal"], fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK),
        "toc1": ParagraphStyle("TOC1", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10.5, leading=15, textColor=INK, leftIndent=0, firstLineIndent=0),
        "toc2": ParagraphStyle("TOC2", parent=base["Normal"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK, leftIndent=12, firstLineIndent=0),
    }


def table_from_lines(lines: list[str], st) -> Table:
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append([Paragraph(inline(cell), ParagraphStyle("Cell", parent=st["body"], fontSize=7.2, leading=9.1, spaceAfter=0, alignment=TA_JUSTIFY)) for cell in cells])
    widths = None
    if rows:
        available = letter[0] - 40 * mm
        cols = len(rows[0])
        weights = [1] * cols
        if cols == 4:
            weights = [1.45, 0.88, 1.55, 1.25]
        elif cols == 6:
            weights = [0.9, 0.55, 1.7, 0.45, 1.7, 0.55]
        total = sum(weights)
        widths = [available * weight / total for weight in weights]
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.2),
        ("LEADING", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.35, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BLUE]),
    ]))
    return table


def figure_story(path_text: str, title: str, source: str, st):
    path = ROOT / path_text
    if not path.is_file():
        raise FileNotFoundError(f"Diagram not found: {path_text}")
    page_w, page_h = landscape(letter)
    available_w, available_h = page_w - 40 * mm, page_h - 66 * mm
    width, height = ImageReader(str(path)).getSize()
    scale = min(available_w / width, available_h / height)
    image = Image(str(path), width=width * scale, height=height * scale)
    image.hAlign = "CENTER"
    return [Paragraph(inline(title), st["h1"]), Spacer(1, 4 * mm), image, Paragraph(inline(source), st["caption"])]


def body_story(parsed: ParsedDocument, st):
    story = []
    lines = parsed.body
    index = 0
    in_code = False
    code_lines: list[str] = []
    figure_count = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("```"):
            if in_code:
                story.append(Paragraph(escape("\n".join(code_lines)).replace("\n", "<br/>"), st["code"]))
                code_lines = []
                in_code = False
            else:
                in_code = True
            index += 1
            continue
        if in_code:
            code_lines.append(line)
            index += 1
            continue
        if line.strip() == "<!-- pagebreak -->":
            story.extend([PageBreak(), NextPageTemplate("portrait")])
            index += 1
            continue
        match = re.fullmatch(r"<!-- landscape-figure: (.+?) \| (.+?) \| (.+?) -->", line.strip())
        if match:
            path, title, source = match.groups()
            figure_count += 1
            story.extend([NextPageTemplate("landscape"), PageBreak()])
            story.extend(figure_story(path, title, source, st))
            story.extend([NextPageTemplate("portrait"), PageBreak()])
            index += 1
            continue
        if not line.strip():
            index += 1
            continue
        if line.startswith("# "):
            paragraph = Paragraph(inline(line[2:]), st["h1"])
            paragraph._toc_level = 0
            story.append(paragraph)
            index += 1
            continue
        if line.startswith("## "):
            paragraph = Paragraph(inline(line[3:]), st["h2"])
            paragraph._toc_level = 1
            story.append(paragraph)
            index += 1
            continue
        if line.startswith("|"):
            table_lines = []
            while index < len(lines) and lines[index].startswith("|"):
                table_lines.append(lines[index])
                index += 1
            story.append(table_from_lines(table_lines, st))
            story.append(Spacer(1, 4 * mm))
            continue
        if re.match(r"^(?:\d+\. |[-*] )", line):
            bullet = re.sub(r"^(?:\d+\. |[-*] )", "", line)
            story.append(Paragraph("• " + inline(bullet), st["list"]))
            index += 1
            continue
        paragraph_lines = [line]
        index += 1
        while index < len(lines) and lines[index].strip() and not lines[index].startswith(("#", "|", "```", "<!--", "- ", "* ")) and not re.match(r"^\d+\. ", lines[index]):
            paragraph_lines.append(lines[index])
            index += 1
        story.append(Paragraph(inline(" ".join(paragraph_lines)), st["body"]))
    if figure_count != 2:
        raise ValueError("Exactly two landscape figures are required")
    return story


def cover_story(metadata: dict[str, str], st):
    details = [metadata["institution"], metadata["faculty"], metadata["department"], metadata["course"], f"Sección {metadata['section']}"]
    parts = [Spacer(1, 34 * mm)]
    parts += [Paragraph(escape(value), ParagraphStyle("CoverDetail", parent=st["body"], alignment=TA_CENTER, fontSize=11, leading=16, spaceAfter=0)) for value in details]
    parts += [Spacer(1, 37 * mm), Paragraph(escape(metadata["title"]), st["title"]), Paragraph(escape(metadata["subtitle"]), st["subtitle"]), Spacer(1, 30 * mm)]
    for value in [metadata["author"], f"Carné {metadata['student_id']}", metadata["date"]]:
        parts.append(Paragraph(escape(value), ParagraphStyle("CoverBottom", parent=st["body"], alignment=TA_CENTER, fontSize=11, leading=16, spaceAfter=0)))
    return parts


def toc_story(st):
    toc = TableOfContents()
    toc.levelStyles = [st["toc1"], st["toc2"]]
    toc.dotsMinLevel = 0
    return [Paragraph("Índice", st["h1"]), Spacer(1, 3 * mm), toc]


def generate():
    parsed = parse_source(SOURCE)
    if parsed.metadata["pdf_filename"] != OUTPUT.name:
        raise ValueError("The PDF filename metadata does not match the required output")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    TEMP.mkdir(parents=True, exist_ok=True)
    st = styles()
    doc = ReportDocument(str(OUTPUT), parsed.metadata)
    story = []
    story.extend(cover_story(parsed.metadata, st))
    story.extend([NextPageTemplate("portrait"), PageBreak()])
    story.extend(toc_story(st))
    story.append(PageBreak())
    story.extend(body_story(parsed, st))
    doc.multiBuild(story)
    if not OUTPUT.is_file() or OUTPUT.stat().st_size == 0:
        raise RuntimeError("PDF generation did not produce an output file")
    print(f"Generated {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        generate()
    except Exception as error:
        print(f"Report generation failed: {error}", file=sys.stderr)
        raise
