"""ReportData → A4 PDF bytes, with ReportLab. Pure: no database, nothing written to disk.

Layout uses ReportLab's "platypus" engine: a list of flowables (paragraphs, tables, drawings)
poured into page frames, like HTML into a print stylesheet. Colours mirror the app's design
tokens (frontend/src/index.css). Text is Noto Sans, embedded, because the 14 built-in PDF
fonts have no ₹ glyph.
"""

from datetime import date, datetime
from decimal import Decimal
from functools import cache
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.renderbase import STATE_DEFAULTS
from reportlab.graphics.charts.doughnut import Doughnut
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.core.time import IST
from app.schemas.reports import CardStatement, ReportData
from app.services.inr import format_inr

APP_NAME = "Planner"
FONT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"

# Design tokens (frontend/src/index.css) — blue palette.
NAVY = colors.HexColor("#0c2547")  # --sidebar
PRIMARY = colors.HexColor("#1f4fd1")  # --primary / --chart-1
TEAL = colors.HexColor("#0e9fb8")  # --chart-2
ACCENT = colors.HexColor("#bfe2ff")  # --accent
INK = colors.HexColor("#111111")
MUTED = colors.HexColor("#6b7280")
LINE = colors.HexColor("#e3e9f2")
ZEBRA = colors.HexColor("#f3f6fb")  # --surface-muted
TINT = colors.HexColor("#dde8fd")  # --tint-blue
NEGATIVE = colors.HexColor("#d93a35")
POSITIVE = colors.HexColor("#1b8a5a")
WARN = colors.HexColor("#9a5a06")

STATUS_STYLE: dict[str, tuple[str, colors.Color, colors.Color]] = {
    "paid": ("Paid", PRIMARY, colors.white),
    "paid_late": ("Paid late", colors.HexColor("#fdefc8"), WARN),
    "partpaid": ("Part paid", colors.HexColor("#dbe8fe"), colors.HexColor("#1e40af")),
    "overdue": ("Overdue", colors.HexColor("#fde3e1"), colors.HexColor("#c2413b")),
    "open": ("Not due yet", ZEBRA, MUTED),
    "nothing_due": ("Nothing due", ZEBRA, MUTED),
}
TONE_COLOR = {"bad": NEGATIVE, "warn": WARN, "good": POSITIVE, "info": PRIMARY}

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
BAND_H = 42 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


@cache
def _fonts() -> None:
    """Register Noto Sans once per process (≈ a lazily-initialised singleton)."""
    pdfmetrics.registerFont(TTFont("Noto", FONT_DIR / "NotoSans-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("Noto-Bold", FONT_DIR / "NotoSans-Bold.ttf"))
    pdfmetrics.registerFontFamily("Noto", normal="Noto", bold="Noto-Bold", italic="Noto", boldItalic="Noto-Bold")
    # Charts (reportlab.graphics) start every drawing in this default font; make it Noto too.
    STATE_DEFAULTS["fontName"] = "Noto"


def _style(name: str, size: float = 9, *, bold: bool = False, color: colors.Color = INK, **kw: Any) -> ParagraphStyle:
    return ParagraphStyle(name, fontName="Noto-Bold" if bold else "Noto", fontSize=size, leading=size * 1.35, textColor=color, **kw)


BODY = _style("body")
SMALL = _style("small", 7.5, color=MUTED)
H2 = _style("h2", 12, bold=True, spaceBefore=14, spaceAfter=6)
NUM = _style("num", alignment=TA_RIGHT)
HEAD = _style("head", 7, bold=True, color=MUTED)
HEAD_R = _style("head_r", 7, bold=True, color=MUTED, alignment=TA_RIGHT)


def _ts(commands: list[Any]) -> TableStyle:
    """TableStyle with Noto as the cell font: ReportLab's default is Helvetica, which has no ₹."""
    return TableStyle([("FONTNAME", (0, 0), (-1, -1), "Noto"), *commands])


def _p(text: str, style: ParagraphStyle = BODY) -> Paragraph:
    """Paragraph from PLAIN text: user data (descriptions, names) can contain & or <, which
    Paragraph would read as markup — so it's always escaped (≈ HTML-escaping in a template)."""
    return Paragraph(escape(text), style)


def _money(amount: Decimal, *, decimals: bool = True, signed: bool = False, color: bool = False, bold: bool = False) -> Paragraph:
    tone = (POSITIVE if amount > 0 else NEGATIVE if amount < 0 else INK) if color else INK
    return Paragraph(escape(format_inr(amount, decimals=decimals, signed=signed)), _style("m", bold=bold, color=tone, alignment=TA_RIGHT))


def _d(d: date) -> str:
    return f"{d.day} {d:%b %Y}"


# ---- Building blocks ---------------------------------------------------------------------------


class Pill(Flowable):
    """A rounded status badge (Paid / Overdue …) — table cells can't have their own rounded corners."""

    def __init__(self, text: str, bg: colors.Color, fg: colors.Color) -> None:
        super().__init__()
        self.text, self.bg, self.fg = text, bg, fg
        self.width = pdfmetrics.stringWidth(text, "Noto-Bold", 7) + 8
        self.height = 11

    def wrap(self, *_: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv
        c.setFillColor(self.bg)
        c.roundRect(0, 0, self.width, self.height, 3, stroke=0, fill=1)
        c.setFillColor(self.fg)
        c.setFont("Noto-Bold", 7)
        c.drawCentredString(self.width / 2, 3, self.text)


def _table(header: list[str], rows: list[list[Any]], widths: list[float], right_from: int) -> Table:
    """Zebra-striped table; columns from `right_from` on are right-aligned numbers."""
    head = [_p(h.upper(), HEAD_R if i >= right_from else HEAD) for i, h in enumerate(header)]
    table = Table([head, *rows], colWidths=widths, repeatRows=1)  # header repeats on every page
    table.setStyle(
        _ts([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA]),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ])
    )
    return table


def _section(title: str, *body: Any) -> KeepTogether:
    """Heading kept on the same page as (the start of) its content."""
    return KeepTogether([_p(title, H2), *body])


def _empty(text: str = "Nothing in this period.") -> Paragraph:
    return _p(text, SMALL)


def _stat_boxes(items: list[tuple[str, str, colors.Color]]) -> Table:
    """A row of tinted boxes: label over a big value."""
    gap = 4 * mm
    width = (CONTENT_W - gap * (len(items) - 1)) / len(items)
    cells, widths = [], []
    for i, (label, value, color) in enumerate(items):
        box = Table([[_p(label, SMALL)], [_p(value, _style("v", 13, bold=True, color=color))]], colWidths=[width])
        box.setStyle(_ts([
            ("BACKGROUND", (0, 0), (-1, -1), ZEBRA),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 7),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
        ]))
        cells.append(box)
        widths.append(width)
        if i < len(items) - 1:
            cells.append("")
            widths.append(gap)
    row = Table([cells], colWidths=widths)
    row.setStyle(_ts([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return row


def _compact(value: float) -> str:
    """Axis labels: ₹1.2L, ₹85K, ₹2Cr."""
    for size, suffix in ((1e7, "Cr"), (1e5, "L"), (1e3, "K")):
        if abs(value) >= size:
            return f"₹{value / size:.1f}".rstrip("0").rstrip(".") + suffix
    return f"₹{value:.0f}"


def _trend_chart(report: ReportData) -> Drawing:
    points = report.trend
    d = Drawing(CONTENT_W, 62 * mm)
    chart = VerticalBarChart()
    chart.x, chart.y, chart.width, chart.height = 14 * mm, 8 * mm, CONTENT_W - 16 * mm, 46 * mm
    chart.data = [[float(p.income) for p in points], [float(p.expenses) for p in points]]
    chart.categoryAxis.categoryNames = [f"{p.month:%b}" for p in points]
    chart.categoryAxis.labels.fontName, chart.categoryAxis.labels.fontSize = "Noto", 7
    chart.categoryAxis.labels.fillColor = MUTED
    chart.categoryAxis.strokeColor = LINE
    chart.valueAxis.labels.fontName, chart.valueAxis.labels.fontSize = "Noto", 7
    chart.valueAxis.labels.fillColor = MUTED
    chart.valueAxis.labelTextFormat = _compact
    chart.valueAxis.valueMin = 0
    chart.valueAxis.strokeColor = None
    chart.valueAxis.visibleGrid, chart.valueAxis.gridStrokeColor = True, LINE
    chart.bars[0].fillColor, chart.bars[1].fillColor = PRIMARY, TEAL
    chart.bars.strokeColor = None
    chart.barSpacing, chart.groupSpacing = 1.5, 8
    d.add(chart)
    for i, (name, color) in enumerate((("Income", PRIMARY), ("Expenses", TEAL))):  # legend: 2 series
        x = 14 * mm + i * 26 * mm
        d.add(Rect(x, 58 * mm, 6, 6, fillColor=color, strokeColor=None))
        d.add(String(x + 9, 58 * mm + 0.5, name, fontName="Noto", fontSize=7.5, fillColor=MUTED))
    return d


def _donut(report: ReportData) -> Drawing:
    cats = [c for c in report.expense_categories if c.amount > 0][:8]
    size = 52 * mm
    d = Drawing(size, size)
    pie = Doughnut()
    pie.x = pie.y = 2 * mm
    pie.width = pie.height = size - 4 * mm
    pie.data = [float(c.amount) for c in cats]
    pie.innerRadiusFraction = 0.6
    pie.slices.strokeColor, pie.slices.strokeWidth = colors.white, 1.5  # gap between slices
    for i, c in enumerate(cats):
        pie.slices[i].fillColor = colors.HexColor(c.color)
    d.add(pie)
    d.add(String(size / 2, size / 2 + 1, "Spent", textAnchor="middle", fontName="Noto", fontSize=7, fillColor=MUTED))
    d.add(String(size / 2, size / 2 - 9, format_inr(report.summary.expenses, decimals=False), textAnchor="middle",
                 fontName="Noto-Bold", fontSize=9, fillColor=INK))
    return d


class Swatch(Flowable):
    """A small drawn dot or square. Drawn, not typed: Noto Sans has no ● or ■ glyph,
    so those characters would print as empty boxes."""

    def __init__(self, color: colors.Color, *, round_: bool = False, size: float = 7) -> None:
        super().__init__()
        self.color, self.round, self.size = color, round_, size

    def wrap(self, *_: float) -> tuple[float, float]:
        return self.size, self.size

    def draw(self) -> None:
        self.canv.setFillColor(self.color)
        if self.round:
            self.canv.circle(self.size / 2, self.size / 2, self.size / 2, stroke=0, fill=1)
        else:
            self.canv.roundRect(0, 0, self.size, self.size, 1.5, stroke=0, fill=1)


def _labelled(swatch: Swatch, text: str, width: float) -> Table:
    cell = Table([[swatch, _p(text)]], colWidths=[swatch.size + 5, width - swatch.size - 5])
    cell.setStyle(_ts([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return cell


# ---- Sections ----------------------------------------------------------------------------------


def _summary(r: ReportData) -> list[Any]:
    s = r.summary
    rate = f"{s.savings_rate}%" if s.savings_rate is not None else "—"
    net = r.net_position
    return [
        _stat_boxes([
            ("Income", format_inr(s.income, decimals=False), INK),
            ("Expenses (your share)", format_inr(s.expenses, decimals=False), INK),
            ("Net savings", format_inr(s.net_savings, decimals=False), POSITIVE if s.net_savings >= 0 else NEGATIVE),
            ("Savings rate", rate, INK),
        ]),
        Spacer(1, 3 * mm),
        _stat_boxes([
            ("Net position at the end", format_inr(net.value, decimals=False), INK),
            ("Change", format_inr(net.change, decimals=False, signed=True), POSITIVE if net.change >= 0 else NEGATIVE),
            ("In banks", format_inr(net.banks, decimals=False), INK),
            ("Card outstanding", format_inr(net.card_outstanding, decimals=False), INK),
        ]),
    ]


def _insights(r: ReportData) -> list[Any]:
    if not r.insights:
        return []
    rows = [[_labelled(Swatch(TONE_COLOR[i.tone], round_=True), i.text, CONTENT_W - 16)] for i in r.insights]
    table = Table(rows, colWidths=[CONTENT_W])
    table.setStyle(_ts([
        ("BACKGROUND", (0, 0), (-1, -1), TINT), ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, -1), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return [_section("Insights", table)]


def _accounts(r: ReportData) -> list[Any]:
    rows = [
        [_p(f"{a.name}{' (archived)' if a.is_archived else ''}"), _p(a.bank_name, SMALL), _money(a.opening), _money(a.closing),
         _money(a.change, signed=True, color=True)]
        for a in r.summary.accounts
    ]
    rows.append([_p("Total", _style("t", bold=True)), "", _money(r.summary.banks_opening, bold=True),
                 _money(r.summary.banks_closing, bold=True),
                 _money(r.summary.banks_closing - r.summary.banks_opening, signed=True, color=True, bold=True)])
    w = CONTENT_W
    return [_section("Bank accounts", _table(["Account", "Bank", "Opening", "Closing", "Change"], rows,
                                             [w * 0.24, w * 0.22, w * 0.18, w * 0.18, w * 0.18], 2))]


def _income(r: ReportData) -> list[Any]:
    if not r.income_sources:
        return [_section("Income", _empty("No income recorded in this period."))]
    rows = [[_p(s.label), _money(s.amount), _p(f"{s.percent}%", NUM)] for s in r.income_sources]
    return [_section("Income", _table(["Source", "Amount", "Share"], rows, [CONTENT_W * 0.5, CONTENT_W * 0.3, CONTENT_W * 0.2], 1))]


def _expenses(r: ReportData) -> list[Any]:
    cats = r.expense_categories
    if not cats:
        return [_section("Expenses by category", _empty())]
    vs = "Change"  # compared with r.period.compare_label (said in the line under the heading)
    table_w = CONTENT_W - 56 * mm
    rows = []
    for c in cats:
        change = "new" if c.change_pct is None and c.amount > 0 else "—" if c.change_pct is None else f"{c.change_pct:+}%"
        change_color = NEGATIVE if c.change_pct and c.change_pct > 0 else POSITIVE if c.change_pct and c.change_pct < 0 else MUTED
        rows.append([_labelled(Swatch(colors.HexColor(c.color)), c.name, table_w * 0.42 - 10), _money(c.amount), _p(f"{c.percent}%", NUM), Paragraph(change, _style("c", 8, color=change_color, alignment=TA_RIGHT))])
    table = _table(["Category", "Amount", "Share", vs], rows, [table_w * 0.42, table_w * 0.24, table_w * 0.14, table_w * 0.2], 1)
    layout = Table([[_donut(r), table]], colWidths=[56 * mm, table_w])
    layout.setStyle(_ts([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return [_section("Expenses by category", _p(f"Your share (splits others owe you taken out, refunds deducted). Change is compared with {r.period.compare_label}.", SMALL), Spacer(1, 2 * mm), layout)]


def _top(r: ReportData) -> list[Any]:
    if not r.top_expenses:
        return []
    rows = [[_p(_d(t.occurred_on), SMALL), _p(t.description or "—"), _p(t.category or "—", SMALL), _p(t.source, SMALL), _money(t.amount)]
            for t in r.top_expenses]
    w = CONTENT_W
    title = "Largest expense" if len(rows) == 1 else f"{len(rows)} largest expenses"
    return [_section(title, _table(["Date", "Description", "Category", "Paid with", "Amount"], rows,
                                                             [w * 0.15, w * 0.33, w * 0.17, w * 0.17, w * 0.18], 4))]


def _card_row(s: CardStatement) -> list[Any]:
    label, bg, fg = STATUS_STYLE[s.status]
    name = f"{s.card_name}{f' ••{s.last4}' if s.last4 else ''}"
    return [
        _p(name), _p(_d(s.statement_date), SMALL), _p(_d(s.due_date), SMALL), _money(s.amount), _money(s.paid),
        _p(f"{s.utilization_pct}%" if s.utilization_pct is not None else "—", NUM),
        _money(s.fees) if s.fees else _p("—", NUM), Pill(label, bg, fg),
    ]


def _cards(r: ReportData) -> list[Any]:
    if not r.cards:
        return [_section("Credit cards", _empty("No card statements in this period."))]
    w = CONTENT_W
    table = _table(["Card", "Statement", "Due", "Amount", "Paid", "Used", "Fees", "Status"], [_card_row(s) for s in r.cards],
                   [w * 0.19, w * 0.12, w * 0.12, w * 0.13, w * 0.13, w * 0.07, w * 0.09, w * 0.15], 3)
    table.setStyle(_ts([("ALIGN", (-1, 1), (-1, -1), "RIGHT")]))
    return [_section("Credit cards", table)]


def _people(r: ReportData) -> list[Any]:
    if not r.people:
        return []
    rows = [[_p(x.name), _money(x.owed_at_start), _money(x.new_shares), _money(x.settled), _money(x.pending, bold=x.pending > 0)]
            for x in r.people]
    w = CONTENT_W
    return [_section("People", _table(["Person", "Owed at start", "New shares", "Paid back", "Still pending"], rows,
                                      [w * 0.28, w * 0.18, w * 0.18, w * 0.18, w * 0.18], 1))]


# ---- Pages ------------------------------------------------------------------------------------


def _numbered_canvas(footer_left: str, footer_mid: str) -> type[Canvas]:
    """A canvas that holds every page until the end, so the footer can say "Page 2 of 5"."""

    class NumberedCanvas(Canvas):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            self._pages: list[dict[str, Any]] = []

        def showPage(self) -> None:  # noqa: N802 — ReportLab's API name
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self) -> None:
            total = len(self._pages)
            for number, state in enumerate(self._pages, start=1):
                self.__dict__.update(state)
                self.setFont("Noto", 7)
                self.setFillColor(MUTED)
                self.setStrokeColor(LINE)
                self.line(MARGIN, 12 * mm, PAGE_W - MARGIN, 12 * mm)
                self.drawString(MARGIN, 8 * mm, footer_left)
                self.drawCentredString(PAGE_W / 2, 8 * mm, footer_mid)
                self.drawRightString(PAGE_W - MARGIN, 8 * mm, f"Page {number} of {total}")
                super().showPage()
            super().save()

    return NumberedCanvas


def _title(r: ReportData) -> str:
    return r.period.title


def render_report_pdf(report: ReportData, *, printed_at: datetime) -> bytes:
    """The whole report as PDF bytes, built in memory."""
    _fonts()
    p = report.period
    buffer = BytesIO()

    def first_page(c: Canvas, _doc: Any) -> None:
        c.saveState()
        c.setFillColor(NAVY)
        c.rect(0, PAGE_H - BAND_H, PAGE_W, BAND_H, stroke=0, fill=1)
        c.setFillColor(ACCENT)
        c.rect(0, PAGE_H - BAND_H, PAGE_W, 1.6 * mm, stroke=0, fill=1)  # accent rule under the band
        c.setFont("Noto-Bold", 9)
        c.drawString(MARGIN, PAGE_H - 13 * mm, APP_NAME.upper())
        c.setFillColor(colors.white)
        c.setFont("Noto-Bold", 22)
        c.drawString(MARGIN, PAGE_H - 25 * mm, p.label)
        c.setFont("Noto", 9)
        c.setFillColor(colors.HexColor("#c8d6ea"))
        sub = f"{_title(report)} · {_d(p.start)} – {_d(p.end)}"
        if not p.is_complete:
            sub += " · in progress, figures will change"
        elif report.from_snapshot:
            sub += f" · figures frozen on {_d(report.generated_at.astimezone(IST).date())}"
        c.drawString(MARGIN, PAGE_H - 32 * mm, sub)
        c.restoreState()

    def later_page(c: Canvas, _doc: Any) -> None:
        c.saveState()
        c.setFillColor(NAVY)
        c.rect(0, PAGE_H - 9 * mm, PAGE_W, 9 * mm, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Noto-Bold", 8)
        c.drawString(MARGIN, PAGE_H - 6 * mm, f"{APP_NAME} · {p.label}")
        c.restoreState()

    doc = BaseDocTemplate(
        buffer, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=16 * mm, bottomMargin=18 * mm,
        title=f"{APP_NAME} — {_title(report)} {p.label}", author=APP_NAME,
        initialFontName="Noto",  # each page would otherwise start in Helvetica (no ₹)
    )
    # Frames default to 6pt inner padding; zero it so tables sized to CONTENT_W line up with headings.
    flush = {"leftPadding": 0, "rightPadding": 0, "topPadding": 0, "bottomPadding": 0}
    first = Frame(MARGIN, 18 * mm, CONTENT_W, PAGE_H - BAND_H - 24 * mm, id="first", **flush)
    rest = Frame(MARGIN, 18 * mm, CONTENT_W, PAGE_H - 16 * mm - 18 * mm, id="rest", **flush)
    doc.addPageTemplates([PageTemplate("first", [first], onPage=first_page), PageTemplate("rest", [rest], onPage=later_page)])

    story: list[Any] = [
        NextPageTemplate("rest"),  # every page after the first uses the slim header
        *_summary(report),
        *_insights(report),
        *_accounts(report),
        *_income(report),
        *_expenses(report),
        _section("Income vs expenses", _trend_chart(report)),
        *_top(report),
        *_cards(report),
        *_people(report),
    ]
    generated = printed_at.astimezone(IST)
    hour = generated.strftime("%I").lstrip("0")
    doc.build(story, canvasmaker=_numbered_canvas(
        f"{APP_NAME} · {_title(report)} · {p.label}",
        f"Generated on {_d(generated.date())}, {hour}:{generated:%M} {generated:%p}".replace("AM", "am").replace("PM", "pm") + " IST",
    ))
    return buffer.getvalue()


def pdf_filename(report: ReportData) -> str:
    p = report.period
    if p.kind == "monthly":
        return f"finance-report-{p.start:%Y-%m}.pdf"
    if p.kind == "yearly":
        return f"finance-report-{p.start:%Y}.pdf"
    if p.kind == "financial_year":
        return f"finance-report-FY{p.start:%Y}-{p.end:%y}.pdf"
    if p.kind == "months":
        return f"finance-report-{p.start:%Y-%m}_to_{p.end:%Y-%m}.pdf"
    return f"finance-report-{p.start:%Y-%m-%d}_to_{p.end:%Y-%m-%d}.pdf"
