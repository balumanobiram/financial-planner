"""Statement parsing: pure functions, no database (fast)."""

import base64
import io
import zipfile
from datetime import date, datetime
from decimal import Decimal

import pytest
from openpyxl import Workbook

from app.schemas.imports import ColumnMapping, ImportFile
from app.services import statement_parser as sp
from app.services.errors import InvalidInputError

TODAY = date(2026, 10, 25)

# Shaped like a real Indian bank export: junk lines above the table, split debit/credit columns,
# an opening-balance line and a totals footer.
BANK_CSV = """HDFC BANK Ltd.,,,,,
Statement of account,,,
Account No: XXXX4321
,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
,OPENING BALANCE,,,,,"1,00,000.00"
01/10/26,UPI-SWIGGY-swiggy@icici-4729,000123,01/10/26,450.00,,"99,550.00"
02/10/26,NEFT CR-ACME CORP-SALARY OCT,000124,02/10/26,,"85,000.00","1,84,550.00"

03/10/26,ATM WDL-MG ROAD,000125,03/10/26,"2,000.00",0.00,"1,82,550.00"
,Total,,,"2,450.00","85,000.00",
"""


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def grid_of(text: str) -> sp.Grid:
    return sp.read_grid("statement.csv", text.encode())


def split_mapping(**over: object) -> ColumnMapping:
    base: dict[str, object] = {
        "header_row": 4, "date_column": "Date", "description_columns": ["Narration"], "amount_mode": "split",
        "debit_column": "Withdrawal Amt.", "credit_column": "Deposit Amt.",
    }
    return ColumnMapping(**{**base, **over})


# ---- Cells ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1,23,456.50", (Decimal("123456.50"), None)),
        ("₹ 450", (Decimal("450.00"), None)),
        ("Rs. 99.9", (Decimal("99.90"), None)),
        ("-250", (Decimal("-250.00"), None)),
        ("(250.00)", (Decimal("-250.00"), None)),
        ("1,200.00 Dr", (Decimal("1200.00"), "dr")),
        ("500.00CR", (Decimal("500.00"), "cr")),
        ("1234.4999999999", (Decimal("1234.50"), None)),  # Excel float noise
        ("", (None, None)),
        ("-", (None, None)),
    ],
)
def test_parse_amount(text: str, expected: tuple[Decimal | None, str | None]) -> None:
    assert sp.parse_amount(text) == expected


@pytest.mark.parametrize("text", ["abc", "12.3.4", "1e5", "Total"])
def test_parse_amount_rejects_text(text: str) -> None:
    with pytest.raises(ValueError):
        sp.parse_amount(text)


@pytest.mark.parametrize(
    ("text", "fmt", "expected"),
    [
        ("25/10/2026", "auto", date(2026, 10, 25)),
        ("05/06/26", "auto", date(2026, 6, 5)),  # day first
        ("25-Oct-2026", "auto", date(2026, 10, 25)),
        ("25 oct 26", "auto", date(2026, 10, 25)),
        ("25.10.2026", "auto", date(2026, 10, 25)),
        ("2026-10-25 00:00:00", "auto", date(2026, 10, 25)),  # Excel date cell read as text
        ("25/10/2026 14:32", "auto", date(2026, 10, 25)),
        ("10/25/2026", "%m/%d/%Y", date(2026, 10, 25)),
        ("10/25/2026", "auto", None),  # no month 25 day-first
        ("05/06/2026", "%d/%m/%Y", date(2026, 6, 5)),
        ("OPENING BALANCE", "auto", None),
        ("", "auto", None),
    ],
)
def test_parse_date(text: str, fmt: str, expected: date | None) -> None:
    assert sp.parse_date(text, fmt) == expected


# ---- Files → grid -----------------------------------------------------------------------------


def test_csv_with_junk_lines_is_padded_to_a_grid() -> None:
    grid = grid_of(BANK_CSV)
    assert len({len(row) for row in grid}) == 1  # ragged rows squared up
    assert grid[0][0] == "HDFC BANK Ltd."
    assert grid[4][:2] == ["Date", "Narration"]


def test_semicolon_csv_and_windows_encoding() -> None:
    text = "Datum;Beschreibung;Betrag\n25/10/2026;Café ☕;-4,50\n".replace("☕", "")
    grid = sp.read_grid("x.csv", text.encode("cp1252"))
    assert grid[1][:2] == ["25/10/2026", "Café"]


def test_xlsx_in_memory_with_real_date_and_number_cells() -> None:
    wb = Workbook()
    ws = wb.active
    ws.append(["Card statement"])
    ws.append([])
    ws.append(["Transaction Date", "Details", "Amount", "Dr/Cr"])
    ws.append([datetime(2026, 10, 24), "AMAZON", 1299.5, "Dr"])
    ws.append([datetime(2026, 10, 24), "REFUND AMAZON", 299, "Cr"])
    buf = io.BytesIO()
    wb.save(buf)

    grid = sp.read_grid("card.xlsx", buf.getvalue())
    header = sp.detect_header_row(grid)
    mapping = sp.suggest_mapping(sp.column_names(grid, header), header, is_card=True)
    assert header == 2
    assert mapping is not None and mapping.amount_mode == "single" and mapping.drcr_column == "Dr/Cr"
    lines = sp.parse_rows(grid, mapping, TODAY)
    assert [(line.occurred_on, line.amount) for line in lines] == [
        (date(2026, 10, 24), Decimal("-1299.50")),
        (date(2026, 10, 24), Decimal("299.00")),
    ]


def test_xlsx_zip_bomb_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sp, "MAX_XLSX_UNZIPPED", 1000)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("xl/worksheets/sheet1.xml", b"0" * 5000)  # compresses to almost nothing
    with pytest.raises(InvalidInputError, match="unreasonable"):
        sp.read_grid("bomb.xlsx", buf.getvalue())


def test_not_really_xlsx() -> None:
    with pytest.raises(InvalidInputError, match="valid .xlsx"):
        sp.read_grid("old.xlsx", b"\xd0\xcf\x11\xe0 legacy xls")


def test_decode_upload() -> None:
    assert sp.decode_upload(ImportFile(filename="a.csv", content_base64=b64(b"x,y"))) == b"x,y"
    with pytest.raises(InvalidInputError, match="base64"):
        sp.decode_upload(ImportFile(filename="a.csv", content_base64="not base64!"))


def test_filename_must_be_csv_or_xlsx() -> None:
    with pytest.raises(ValueError):
        ImportFile(filename="statement.pdf", content_base64="eA==")


# ---- Headings and suggestions -----------------------------------------------------------------


def test_detects_heading_row_and_suggests_split_mapping() -> None:
    grid = grid_of(BANK_CSV)
    header = sp.detect_header_row(grid)
    assert header == 4
    assert sp.suggest_mapping(sp.column_names(grid, header), header, is_card=False) == split_mapping()


def test_column_names_are_unique_and_never_blank() -> None:
    assert sp.column_names([["Date", "", "Amount", "Amount"]], 0) == ["Date", "Column 2", "Amount", "Amount (2)"]


def test_suggest_single_amount_column_sign_depends_on_source() -> None:
    cols = ["Txn Date", "Value Date", "Description", "Amount", "Balance"]
    bank = sp.suggest_mapping(cols, 0, is_card=False)
    card = sp.suggest_mapping(cols, 0, is_card=True)
    assert bank is not None and card is not None
    assert (bank.date_column, bank.amount_column, bank.description_columns) == ("Txn Date", "Amount", ["Description"])
    assert (bank.sign, card.sign) == ("negative_is_debit", "positive_is_debit")


def test_no_suggestion_without_a_date_column() -> None:
    assert sp.suggest_mapping(["Foo", "Amount"], 0, is_card=False) is None


# ---- Rows -------------------------------------------------------------------------------------


def test_parse_rows_split_columns() -> None:
    lines = sp.parse_rows(grid_of(BANK_CSV), split_mapping(), TODAY)
    ok = [(line.row_number, line.occurred_on, line.description, line.amount) for line in lines if line.error is None]
    assert ok == [
        (7, date(2026, 10, 1), "UPI-SWIGGY-swiggy@icici-4729", Decimal("-450.00")),
        (8, date(2026, 10, 2), "NEFT CR-ACME CORP-SALARY OCT", Decimal("85000.00")),
        (10, date(2026, 10, 3), "ATM WDL-MG ROAD", Decimal("-2000.00")),  # row 9 blank → dropped; 0.00 credit = empty
    ]
    errors = {line.row_number: line.error for line in lines if line.error}
    assert set(errors) == {6, 11}  # opening balance and totals lines
    assert all("No date" in e for e in errors.values())


def test_single_amount_signs_and_indicators() -> None:
    grid = [
        ["Date", "Desc", "Amount", "Type"],
        ["01/10/2026", "a", "-100", ""],
        ["01/10/2026", "b", "200", ""],
        ["01/10/2026", "c", "300", "DR"],
        ["01/10/2026", "d", "400 Cr", ""],
    ]
    base = {"header_row": 0, "date_column": "Date", "description_columns": ["Desc"], "amount_mode": "single", "amount_column": "Amount"}
    bank = sp.parse_rows(grid, ColumnMapping(**base), TODAY)
    card = sp.parse_rows(grid, ColumnMapping(**base, sign="positive_is_debit", drcr_column="Type"), TODAY)
    assert [line.amount for line in bank] == [Decimal("-100.00"), Decimal("200.00"), Decimal("300.00"), Decimal("400.00")]
    # card: positives are spends; an explicit DR / Cr beats the sign
    assert [line.amount for line in card] == [Decimal("100.00"), Decimal("-200.00"), Decimal("-300.00"), Decimal("400.00")]


def test_row_errors() -> None:
    grid = [
        ["Date", "Desc", "Out", "In"],
        ["26/10/2026", "tomorrow", "10", ""],
        ["01/10/2026", "both", "10", "20"],
        ["01/10/2026", "neither", "", ""],
        ["01/10/2026", "junk", "abc", ""],
    ]
    mapping = ColumnMapping(header_row=0, date_column="Date", description_columns=["Desc"], amount_mode="split", debit_column="Out", credit_column="In")
    assert [line.error for line in sp.parse_rows(grid, mapping, TODAY)] == [
        "Date is in the future",
        "Both debit and credit are filled in",
        "No amount",
        "'abc' isn't an amount",
    ]


def test_description_from_several_columns() -> None:
    grid = [["Date", "Merchant", "City", "Amt"], ["01/10/2026", "SWIGGY", " Bengaluru ", "10"]]
    mapping = ColumnMapping(header_row=0, date_column="Date", description_columns=["Merchant", "City"], amount_mode="single", amount_column="Amt")
    assert sp.parse_rows(grid, mapping, TODAY)[0].description == "SWIGGY Bengaluru"


def test_missing_columns_are_named() -> None:
    with pytest.raises(InvalidInputError, match="Withdrawal Amt."):
        sp.parse_rows([["Date", "Narration", "Deposit Amt."]], split_mapping(header_row=0), TODAY)


def test_mapping_needs_the_columns_for_its_mode() -> None:
    with pytest.raises(ValueError, match="amount column"):
        ColumnMapping(header_row=0, date_column="Date", description_columns=["D"], amount_mode="single")
    with pytest.raises(ValueError, match="both"):
        ColumnMapping(header_row=0, date_column="Date", description_columns=["D"], amount_mode="split", debit_column="Out")
    with pytest.raises(ValueError, match="date format"):
        ColumnMapping(header_row=0, date_column="Date", description_columns=["D"], amount_mode="single", amount_column="A", date_format="%Q")
