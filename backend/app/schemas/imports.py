"""Request/response models for statement import (preview → parse → commit).

The file travels as base64 inside JSON rather than multipart: Starlette spools multipart
uploads over 1 MB to a temp file on disk, and uploaded statements must never touch disk.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import BlankToNone, MoneyAmount
from app.schemas.transactions import Description, SourceIn

MAX_FILE_BYTES = 5 * 1024 * 1024
# base64 makes 3 bytes into 4 characters.
MAX_BASE64_CHARS = (MAX_FILE_BYTES + 2) // 3 * 4

# Date formats offered in the mapping UI; "auto" tries them all, day-first (Indian statements).
DATE_FORMATS: dict[str, str] = {
    "auto": "Detect automatically",
    "%d/%m/%Y": "25/10/2026",
    "%d/%m/%y": "25/10/26",
    "%d-%m-%Y": "25-10-2026",
    "%d-%m-%y": "25-10-26",
    "%d.%m.%Y": "25.10.2026",
    "%d-%b-%Y": "25-Oct-2026",
    "%d-%b-%y": "25-Oct-26",
    "%d %b %Y": "25 Oct 2026",
    "%d %b %y": "25 Oct 26",
    "%Y-%m-%d": "2026-10-25",
    "%m/%d/%Y": "10/25/2026 (US)",
}

ColumnName = Annotated[str, Field(min_length=1, max_length=100)]
OptionalColumn = Annotated[ColumnName | None, BlankToNone]


class _Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class ImportFile(_Input):
    filename: Annotated[str, Field(min_length=1, max_length=255, pattern=r"(?i)\.(csv|xlsx)$")]
    content_base64: Annotated[str, Field(min_length=1, max_length=MAX_BASE64_CHARS)]


class ColumnMapping(_Input):
    """Which column means what. Columns are referred to by their header text."""

    header_row: int = Field(ge=0, le=50, description="0-based row holding the column headings")
    date_column: ColumnName
    date_format: str = "auto"
    description_columns: list[ColumnName] = Field(min_length=1, max_length=3, description="Joined with a space")
    amount_mode: Literal["single", "split"]
    # single: one amount column (+ how its sign works, or a Dr/Cr column)
    amount_column: OptionalColumn = None
    sign: Literal["negative_is_debit", "positive_is_debit"] = Field(
        default="negative_is_debit",
        description="Bank statements usually show money out as negative; card statements often show spends as positive",
    )
    drcr_column: OptionalColumn = Field(default=None, description="Optional column saying Dr/Cr (or Debit/Credit); overrides the sign")
    # split: separate withdrawal / deposit columns
    debit_column: OptionalColumn = None
    credit_column: OptionalColumn = None

    @model_validator(mode="after")
    def _columns_for_mode(self) -> Self:
        if self.date_format not in DATE_FORMATS:
            raise ValueError(f"Unknown date format {self.date_format!r}")
        if self.amount_mode == "single" and not self.amount_column:
            raise ValueError("Pick the amount column")
        if self.amount_mode == "split" and not (self.debit_column and self.credit_column):
            raise ValueError("Pick both the debit (money out) and credit (money in) columns")
        return self


class PreviewRequest(_Input):
    file: ImportFile
    source: SourceIn
    header_row: int | None = Field(default=None, ge=0, le=50, description="Override the detected heading row")


class PreviewResponse(BaseModel):
    filename: str
    header_row: int
    columns: list[str]
    sample_rows: list[list[str]] = Field(description="First rows under the headings, as text")
    total_rows: int
    saved_mapping: ColumnMapping | None = Field(description="What you used last time for this account / card")
    suggested_mapping: ColumnMapping | None = Field(description="Guessed from the headings")
    date_formats: dict[str, str]


class ParseRequest(_Input):
    file: ImportFile
    source: SourceIn
    mapping: ColumnMapping


class DuplicateRef(BaseModel):
    transaction_id: uuid.UUID
    description: str | None
    type: str


class ParsedRow(BaseModel):
    row_number: int = Field(description="1-based line in the file, as a spreadsheet shows it")
    occurred_on: date | None
    description: str | None
    amount: Decimal | None = Field(description="Signed: negative = money out")
    error: str | None = Field(description="Why this row can't be imported (e.g. a totals line)")
    duplicate: DuplicateRef | None = Field(description="An existing transaction this looks like")


class ParseSummary(BaseModel):
    rows: int
    importable: int
    duplicates: int
    errors: int
    date_from: date | None
    date_to: date | None
    money_in: Decimal
    money_out: Decimal


class ParseResponse(BaseModel):
    rows: list[ParsedRow]
    summary: ParseSummary


class CommitRow(_Input):
    occurred_on: date
    description: Description = None
    amount: MoneyAmount = Field(description="Signed, as returned by parse")
    category_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _nonzero(self) -> Self:
        if self.amount == 0:
            raise ValueError("Amount can't be zero")
        return self


class CommitRequest(_Input):
    source: SourceIn
    mapping: ColumnMapping | None = Field(default=None, description="Saved for next time if given")
    rows: list[CommitRow] = Field(min_length=1, max_length=2000)


class CommitResponse(BaseModel):
    created: int
    mapping_saved: bool
