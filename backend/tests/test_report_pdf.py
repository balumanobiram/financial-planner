"""PDF rendering. The pure tests build a ReportData by hand (no database) and read the PDF back
with pypdf: text extraction only finds "₹" if the embedded font really maps that glyph."""

import io
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.schemas.reports import (
    AccountLine,
    CardStatement,
    CategoryLine,
    IncomeSource,
    Insight,
    LargeExpense,
    NetPosition,
    PersonLine,
    ReportData,
    Summary,
    TrendPoint,
)
from app.services.report_math import monthly_period, range_period, yearly_period
from app.services.report_pdf import pdf_filename, render_report_pdf
from tests.test_reports_api import api, world  # noqa: F401 — reuse the October fixtures

D = Decimal
TODAY = date(2026, 11, 15)
PRINTED = datetime(2026, 11, 15, 17, 5, tzinfo=UTC)  # 10:35 pm IST


def sample(**over: Any) -> ReportData:
    data: dict[str, Any] = {
        "period": monthly_period(date(2026, 10, 1), TODAY),
        "generated_at": PRINTED,
        "summary": Summary(
            accounts=[AccountLine(account_id=uuid.uuid4(), name="Salary", bank_name="HDFC Bank", opening=D("180000"),
                                  closing=D("246500"), change=D("66500"), is_archived=False)],
            banks_opening=D("180000"), banks_closing=D("246500"), income=D("91000"), expenses=D("20136"),
            net_savings=D("70864"), savings_rate=D("77.9"),
        ),
        "income_sources": [IncomeSource(source="salary", label="Salary", amount=D("91000"), percent=D("100.0"))],
        "expense_categories": [
            CategoryLine(category_id=None, name="Rent", color="#7c3aed", icon="House", amount=D("18000"), percent=D("89.4"), previous=D("0"), change_pct=None),
            CategoryLine(category_id=None, name="Food", color="#ea580c", icon="UtensilsCrossed", amount=D("1900"), percent=D("9.4"), previous=D("2000"), change_pct=D("-5.0")),
        ],
        "top_expenses": [LargeExpense(transaction_id=uuid.uuid4(), occurred_on=date(2026, 10, 15), description="Tea & <snacks>",
                                      category="Food", source="Salary", amount=D("123456.50"))],
        "cards": [CardStatement(card_id=uuid.uuid4(), card_name="Regalia", bank_name="HDFC Bank", last4="4321", color="#111111",
                                statement_date=date(2026, 10, 12), due_date=date(2026, 11, 1), amount=D("5236"), paid=D("5236"),
                                paid_by_due=D("2000"), status="paid_late", utilization_pct=D("5.2"), fees=D("236"))],
        "people": [PersonLine(person_id=uuid.uuid4(), name="Ravi", owed_at_start=D("0"), new_shares=D("1000"), settled=D("400"), pending=D("600"))],
        "net_position": NetPosition(banks=D("271500"), owed_to_me=D("600"), card_outstanding=D("3236"), value=D("268864"),
                                    previous_value=D("178000"), change=D("90864")),
        "trend": [TrendPoint(month=date(2026, m, 1), income=D(80000 + m * 1000), expenses=D(20000)) for m in range(5, 11)],
        "insights": [Insight(tone="warn", text="1 card bill paid late"), Insight(tone="good", text="You saved 77.9% of your income")],
    }
    data.update(over)
    return ReportData(**data)


def read(pdf: bytes) -> tuple[PdfReader, str]:
    reader = PdfReader(io.BytesIO(pdf))
    return reader, "\n".join(page.extract_text() for page in reader.pages)


def test_renders_a_valid_pdf_with_rupee_text() -> None:
    pdf = render_report_pdf(sample(), printed_at=PRINTED)
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
    reader, text = read(pdf)
    assert "October 2026" in text
    # ₹ survives the round trip — the glyph is in the embedded font and mapped back to U+20B9.
    for amount in ("₹91,000", "₹1,23,456.50", "₹2,68,864", "+₹90,864"):
        assert amount in text, amount
    assert "Tea & <snacks>" in text  # user text escaped, not swallowed as markup
    assert "Paid late" in text and "1 card bill paid late" in text
    assert f"Page 1 of {len(reader.pages)}" in text
    assert "Generated on 15 Nov 2026, 10:35 pm IST" in text


def test_embeds_noto_sans() -> None:
    reader, _ = read(render_report_pdf(sample(), printed_at=PRINTED))
    fonts = {str(f.get_object()["/BaseFont"]) for page in reader.pages for f in page["/Resources"]["/Font"].values()}
    assert any("NotoSans" in name for name in fonts), fonts
    assert not any("Helvetica" in name for name in fonts), "a built-in font (no ₹ glyph) slipped in"


def test_empty_period_still_renders() -> None:
    empty = sample(
        summary=Summary(accounts=[], banks_opening=D(0), banks_closing=D(0), income=D(0), expenses=D(0), net_savings=D(0), savings_rate=None),
        income_sources=[], expense_categories=[], top_expenses=[], cards=[], people=[], insights=[],
        net_position=NetPosition(banks=D(0), owed_to_me=D(0), card_outstanding=D(0), value=D(0), previous_value=D(0), change=D(0)),
        trend=[TrendPoint(month=date(2026, 10, 1), income=D(0), expenses=D(0))],
    )
    _, text = read(render_report_pdf(empty, printed_at=PRINTED))
    assert "No income recorded in this period." in text and "No card statements in this period." in text


def test_long_report_flows_onto_more_pages() -> None:
    many = [LargeExpense(transaction_id=uuid.uuid4(), occurred_on=date(2026, 10, 1), description=f"Item {i}", category=None,
                         source="Card", amount=D(1000 + i)) for i in range(60)]
    reader, text = read(render_report_pdf(sample(top_expenses=many), printed_at=PRINTED))
    assert len(reader.pages) >= 3
    assert text.count("DESCRIPTION") >= 2  # the table header repeats on the next page


@pytest.mark.parametrize(
    ("period", "name"),
    [
        (monthly_period(date(2026, 10, 1), TODAY), "finance-report-2026-10.pdf"),
        (yearly_period(2025, TODAY), "finance-report-2025.pdf"),
        (range_period(date(2026, 10, 1), date(2026, 10, 15), TODAY), "finance-report-2026-10-01_to_2026-10-15.pdf"),
    ],
)
def test_filenames(period: Any, name: str) -> None:
    assert pdf_filename(sample(period=period)) == name


# ---- Endpoints (Neon dev, rolled back) ------------------------------------------------------------


def test_monthly_pdf_endpoint(api: TestClient, world: dict[str, Any]) -> None:  # noqa: F811
    response = api.get("/reports/monthly/pdf", params={"month": "2026-10"})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == 'attachment; filename="finance-report-2026-10.pdf"'
    assert response.headers["cache-control"] == "no-store"
    _, text = read(response.content)
    assert "October 2026" in text and "₹91,000" in text and "Ravi" in text


def test_range_and_yearly_pdf_endpoints(api: TestClient, world: dict[str, Any]) -> None:  # noqa: F811
    r = api.get("/reports/range/pdf", params={"from": "2026-10-01", "to": "2026-10-15"})
    y = api.get("/reports/yearly/pdf", params={"year": 2026})
    assert (r.status_code, y.status_code) == (200, 200)
    assert 'finance-report-2026-10-01_to_2026-10-15.pdf' in r.headers["content-disposition"]
    assert "in progress" in read(y.content)[1]  # 2026 isn't over yet
    assert api.get("/reports/monthly/pdf", params={"month": "2026-12"}).status_code == 422
