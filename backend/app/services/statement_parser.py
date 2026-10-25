"""Reading bank / card statement files into rows — pure functions, no database.

Pipeline: bytes → grid (list of rows of text) → find the heading row → apply a
ColumnMapping → ParsedLine(date, description, signed amount | error).

Everything happens in memory (BytesIO); nothing is written to disk.
"""

import base64
import binascii
import csv
import io
import re
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.schemas.imports import DATE_FORMATS, MAX_FILE_BYTES, ColumnMapping, ImportFile
from app.services.errors import InvalidInputError

MAX_ROWS = 20_000
MAX_XLSX_UNZIPPED = 100 * 1024 * 1024  # a 5 MB xlsx that inflates past this is a zip bomb
HEADER_SCAN_ROWS = 30
CENT = Decimal("0.01")

Grid = list[list[str]]


# ---- Bytes → grid ------------------------------------------------------------------------


def decode_upload(file: ImportFile) -> bytes:
    try:
        data = base64.b64decode(file.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidInputError("The file couldn't be read (bad base64)") from exc
    if not data:
        raise InvalidInputError("The file is empty")
    if len(data) > MAX_FILE_BYTES:
        raise InvalidInputError("The file is larger than 5 MB")
    return data


def read_grid(filename: str, data: bytes) -> Grid:
    """Every cell as stripped text; blank cells are "". Ragged rows are padded to the same width."""
    import pandas as pd  # imported here: pandas takes ~0.5 s to load, only imports need it

    if filename.lower().endswith(".xlsx"):
        _check_xlsx(data)
        try:
            # dtype=str: keep "0012" and "25/10/2026" exactly as written, no guessing.
            frame = pd.read_excel(io.BytesIO(data), sheet_name=0, header=None, dtype=str, engine="openpyxl")
        except Exception as exc:  # openpyxl raises many different types for corrupt files
            raise InvalidInputError("This doesn't look like a valid .xlsx file") from exc
    else:
        # The csv module copes with the junk lines banks put above the table (pandas.read_csv
        # rejects rows wider than the first one).
        frame = pd.DataFrame(_csv_rows(_decode_text(data)), dtype=str)
    if len(frame) > MAX_ROWS:
        raise InvalidInputError(f"The file has more than {MAX_ROWS:,} rows")
    frame = frame.fillna("").astype(str)
    return [[_clean_cell(v) for v in row] for row in frame.itertuples(index=False, name=None)]


def _check_xlsx(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(info.file_size for info in archive.infolist()) > MAX_XLSX_UNZIPPED:
                raise InvalidInputError("This .xlsx expands to an unreasonable size")
    except zipfile.BadZipFile as exc:
        raise InvalidInputError("This doesn't look like a valid .xlsx file (old .xls? Save it as .xlsx or .csv)") from exc


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):  # cp1252: what Excel on Windows saves "CSV" as
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")  # never fails


def _csv_rows(text: str) -> Grid:
    sample = text[:20_000]
    try:
        dialect: type[csv.Dialect] | csv.Dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows:
        raise InvalidInputError("The file is empty")
    width = max(len(row) for row in rows)
    return [row + [""] * (width - len(row)) for row in rows]  # square up ragged rows


def _clean_cell(value: str) -> str:
    text = value.replace(" ", " ").strip()  # non-breaking spaces are common in bank exports
    return "" if text.lower() in ("nan", "none", "<na>") else text


# ---- Heading row and columns ---------------------------------------------------------------

_HEADER_WORDS = re.compile(
    r"\b(date|narration|description|particulars|details|remarks|amount|debit|credit|withdrawal|deposit|"
    r"balance|dr|cr|transaction|txn|value|chq|cheque|ref)\b",
    re.IGNORECASE,
)


def detect_header_row(grid: Grid) -> int:
    """The first row (in the top 30) that reads most like column headings; 0 if none does."""
    best, best_score = 0, 1
    for i, row in enumerate(grid[:HEADER_SCAN_ROWS]):
        score = sum(1 for cell in row if cell and len(cell) <= 40 and _HEADER_WORDS.search(cell))
        if score > best_score:
            best, best_score = i, score
    return best


def column_names(grid: Grid, header_row: int) -> list[str]:
    """Heading texts, made unique; blank headings become "Column 3" etc."""
    if header_row >= len(grid):
        raise InvalidInputError(f"Row {header_row + 1} doesn't exist — the file has {len(grid)} rows")
    names: list[str] = []
    for i, cell in enumerate(grid[header_row]):
        name = (cell or f"Column {i + 1}")[:100]
        candidate, n = name, 2
        while candidate in names:
            candidate, n = f"{name} ({n})", n + 1
        names.append(candidate)
    return names


def _find(columns: list[str], *patterns: str, exclude: str | None = None) -> str | None:
    for pattern in patterns:  # earlier patterns win
        for col in columns:
            low = col.lower()
            if re.search(pattern, low) and not (exclude and re.search(exclude, low)):
                return col
    return None


def suggest_mapping(columns: list[str], header_row: int, *, is_card: bool) -> ColumnMapping | None:
    """Best guess from the headings, or None if there's no date or amount column to guess."""
    date_col = _find(columns, r"^(txn|tran|transaction)\.? ?date", r"^date$", r"\bdate\b", exclude=r"value")
    date_col = date_col or _find(columns, r"\bdate\b")
    desc = _find(columns, r"narration", r"description", r"particulars", r"details", r"remarks", r"merchant")
    debit = _find(columns, r"withdraw", r"^debit", r"\bdebit amount", r"^dr\.?( amount)?$", exclude=r"credit")
    credit = _find(columns, r"deposit", r"^credit", r"\bcredit amount", r"^cr\.?( amount)?$", exclude=r"debit")
    amount = _find(columns, r"^amount", r"amount", r"^amt", exclude=r"balance")
    drcr = _find(columns, r"^(dr|cr) ?/ ?(cr|dr)$", r"^debit ?/ ?credit$", r"^(txn |transaction )?type$")
    if not date_col:
        return None
    common = {"header_row": header_row, "date_column": date_col, "description_columns": [desc or date_col]}
    if debit and credit and debit != credit:
        return ColumnMapping(**common, amount_mode="split", debit_column=debit, credit_column=credit)
    if amount:
        return ColumnMapping(
            **common,
            amount_mode="single",
            amount_column=amount,
            drcr_column=drcr,
            sign="positive_is_debit" if is_card else "negative_is_debit",
        )
    return None


# ---- Cell parsing --------------------------------------------------------------------------

_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$")  # also Excel's "2026-10-25 00:00:00"
_TRAILING_TIME = re.compile(r"[ T,]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?$")
AUTO_FORMATS = [f for f in DATE_FORMATS if f not in ("auto", "%m/%d/%Y")]  # day-first only


def parse_date(text: str, fmt: str = "auto") -> date | None:
    text = text.strip()
    if not text:
        return None
    iso = _ISO_DATE.match(text)
    if iso:
        try:
            return date(int(iso[1]), int(iso[2]), int(iso[3]))
        except ValueError:
            return None
    text = _TRAILING_TIME.sub("", text)
    for f in AUTO_FORMATS if fmt == "auto" else [fmt]:
        try:
            return datetime.strptime(text, f).date()
        except ValueError:
            continue
    return None


_CURRENCY = re.compile(r"(?i)(₹|\binr\b|\brs\.?)")
_DRCR_SUFFIX = re.compile(r"(?i)\s*(?<![a-z])(dr|cr)\.?$")  # not \b: "500.00CR" has no word boundary before C
_NUMBER = re.compile(r"^[+-]?\d+(\.\d+)?$")


def parse_amount(text: str) -> tuple[Decimal | None, str | None]:
    """"₹1,23,456.50 Dr" → (123456.50, "dr"); "(250.00)" → (-250.00, None); "" / "-" → (None, None).
    Raises ValueError for text that isn't an amount."""
    text = text.strip()
    hint = None
    suffix = _DRCR_SUFFIX.search(text)
    if suffix:
        hint = suffix[1].lower()
        text = text[: suffix.start()]
    text = _CURRENCY.sub("", text).replace(",", "").replace(" ", "")
    if text in ("", "-", "--"):
        return None, hint
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    if not _NUMBER.match(text):
        raise ValueError(f"{text!r} isn't an amount")
    try:
        value = Decimal(text).quantize(CENT, rounding=ROUND_HALF_UP)  # Excel float noise: 1234.4999999 → 1234.50
    except InvalidOperation as exc:
        raise ValueError(f"{text!r} isn't an amount") from exc
    if abs(value) >= Decimal("1e12"):
        raise ValueError("Amount is too large")
    return (-value if negative else value), hint


def _indicator(text: str) -> str | None:
    """A Dr/Cr column's value → "dr" / "cr" / None."""
    low = text.strip().lower()
    if re.match(r"^(dr|debit|withdrawal|d)\b", low):
        return "dr"
    if re.match(r"^(cr|credit|deposit|c)\b", low):
        return "cr"
    return None


# ---- Grid → rows ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedLine:
    row_number: int  # 1-based, as a spreadsheet shows it
    occurred_on: date | None
    description: str | None
    amount: Decimal | None  # signed: negative = money out
    error: str | None


def parse_rows(grid: Grid, mapping: ColumnMapping, today: date) -> list[ParsedLine]:
    """Apply the mapping to every row below the headings. Blank rows are dropped; anything
    else that isn't a transaction (opening balance, totals…) comes back with an `error`."""
    columns = column_names(grid, mapping.header_row)
    wanted = [mapping.date_column, *mapping.description_columns, mapping.amount_column, mapping.drcr_column,
              mapping.debit_column, mapping.credit_column]
    missing = sorted({c for c in wanted if c and c not in columns})
    if missing:
        raise InvalidInputError(f"Column(s) not in this file: {', '.join(missing)}")
    index = {name: i for i, name in enumerate(columns)}

    def cell(row: list[str], column: str | None) -> str:
        if column is None:
            return ""
        i = index[column]
        return row[i] if i < len(row) else ""

    lines: list[ParsedLine] = []
    for offset, row in enumerate(grid[mapping.header_row + 1 :]):
        if not any(row):
            continue
        row_number = mapping.header_row + offset + 2
        description = " ".join(" ".join(cell(row, c) for c in mapping.description_columns).split())[:255] or None
        occurred_on = parse_date(cell(row, mapping.date_column), mapping.date_format)
        amount, error = None, None
        try:
            amount = _row_amount(row, cell, mapping)
        except ValueError as exc:
            error = str(exc)
        if occurred_on is None:
            error = "No date — not a transaction line (heading, balance or total?)"
        elif occurred_on > today:
            error = "Date is in the future"
        elif error is None and amount is None:
            error = "No amount"
        lines.append(ParsedLine(row_number, occurred_on, description, amount, error))
    return lines


def _row_amount(row: list[str], cell: Callable[[list[str], str | None], str], mapping: ColumnMapping) -> Decimal | None:
    if mapping.amount_mode == "split":
        debit, _ = parse_amount(cell(row, mapping.debit_column))
        credit, _ = parse_amount(cell(row, mapping.credit_column))
        debit = debit if debit else None  # 0.00 in the unused column means "empty"
        credit = credit if credit else None
        if debit and credit:
            raise ValueError("Both debit and credit are filled in")
        if debit:
            return -abs(debit)
        return abs(credit) if credit else None

    value, hint = parse_amount(cell(row, mapping.amount_column))
    if not value:
        return None
    indicator = _indicator(cell(row, mapping.drcr_column)) if mapping.drcr_column else None
    indicator = indicator or hint
    if indicator:  # an explicit Dr/Cr beats the sign
        return -abs(value) if indicator == "dr" else abs(value)
    return value if mapping.sign == "negative_is_debit" else -value
