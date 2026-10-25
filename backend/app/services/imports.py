"""Statement import: preview → parse (with duplicate check) → commit.

The uploaded file is decoded and parsed in memory on every call (preview and parse each
receive it again) — nothing is stored, so there is no upload to clean up or leak.
Only the column mapping is saved, per account / card.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import IST, start_of_day_ist
from app.models import Category, ImportMapping, Transaction, TransactionKind
from app.schemas.imports import (
    DATE_FORMATS,
    ColumnMapping,
    CommitRequest,
    DuplicateRef,
    ParsedRow,
    ParseRequest,
    ParseResponse,
    ParseSummary,
    PreviewRequest,
    PreviewResponse,
)
from app.schemas.transactions import SourceIn
from app.services import statement_parser as parser
from app.services.categories import usable_category
from app.services.duplicates import Candidate, Existing, find_duplicates
from app.services.transactions import active_account, active_card, entry_time

IMPORT_TAG = "imported"  # lets you find (or bulk-review) everything that came from a file
SAMPLE_ROWS = 15


def _check_source(session: Session, source: SourceIn) -> None:
    if source.account_id is not None:
        active_account(session, source.account_id)
    else:
        assert source.card_id is not None
        active_card(session, source.card_id)


def saved_mapping(session: Session, source: SourceIn) -> ColumnMapping | None:
    row = _mapping_row(session, source)
    if row is None:
        return None
    try:
        return ColumnMapping.model_validate(row.mapping)
    except ValueError:
        return None  # saved by an older version with a different shape: just don't offer it


def _mapping_row(session: Session, source: SourceIn) -> ImportMapping | None:
    column = ImportMapping.account_id if source.account_id else ImportMapping.card_id
    return session.scalar(select(ImportMapping).where(column == (source.account_id or source.card_id)))


def preview(session: Session, req: PreviewRequest) -> PreviewResponse:
    _check_source(session, req.source)
    grid = parser.read_grid(req.file.filename, parser.decode_upload(req.file))
    saved = saved_mapping(session, req.source)
    if req.header_row is not None:
        header_row = req.header_row
    elif saved is not None and saved.header_row < len(grid):
        header_row = saved.header_row
    else:
        header_row = parser.detect_header_row(grid)
    columns = parser.column_names(grid, header_row)
    body = [row for row in grid[header_row + 1 :] if any(row)]
    return PreviewResponse(
        filename=req.file.filename,
        header_row=header_row,
        columns=columns,
        sample_rows=[row[: len(columns)] for row in body[:SAMPLE_ROWS]],
        total_rows=len(body),
        saved_mapping=saved,
        suggested_mapping=parser.suggest_mapping(columns, header_row, is_card=req.source.card_id is not None),
        date_formats=DATE_FORMATS,
    )


def _existing(session: Session, source: SourceIn, first: date, last: date) -> list[Existing]:
    column = Transaction.account_id if source.account_id else Transaction.card_id
    rows = session.scalars(
        select(Transaction).where(
            column == (source.account_id or source.card_id),
            Transaction.occurred_at >= start_of_day_ist(first),
            Transaction.occurred_at < start_of_day_ist(last + timedelta(days=1)),
        )
    )
    return [Existing(t.id, t.occurred_at.astimezone(IST).date(), t.amount, t.description, t.kind.value) for t in rows]


def parse(session: Session, req: ParseRequest, today: date) -> ParseResponse:
    _check_source(session, req.source)
    grid = parser.read_grid(req.file.filename, parser.decode_upload(req.file))
    lines = parser.parse_rows(grid, req.mapping, today)

    good = [line for line in lines if line.error is None and line.occurred_on and line.amount]
    dupes: dict[int, Existing] = {}
    if good:
        first = min(line.occurred_on for line in good if line.occurred_on)
        last = max(line.occurred_on for line in good if line.occurred_on)
        candidates = [Candidate(line.row_number, line.occurred_on, line.amount, line.description) for line in good]  # type: ignore[arg-type]
        dupes = find_duplicates(candidates, _existing(session, req.source, first, last))

    rows = [
        ParsedRow(
            row_number=line.row_number,
            occurred_on=line.occurred_on,
            description=line.description,
            amount=line.amount,
            error=line.error,
            duplicate=(
                DuplicateRef(transaction_id=d.id, description=d.description, type=d.kind)
                if (d := dupes.get(line.row_number))
                else None
            ),
        )
        for line in lines
    ]
    amounts = [line.amount for line in good if line.amount is not None]
    dates = [line.occurred_on for line in good if line.occurred_on is not None]
    return ParseResponse(
        rows=rows,
        summary=ParseSummary(
            rows=len(rows),
            importable=len(good) - len(dupes),
            duplicates=len(dupes),
            errors=len(lines) - len(good),
            date_from=min(dates, default=None),
            date_to=max(dates, default=None),
            money_in=sum((a for a in amounts if a > 0), Decimal("0.00")),
            money_out=sum((-a for a in amounts if a < 0), Decimal("0.00")),
        ),
    )


def commit(session: Session, req: CommitRequest, today: date) -> int:
    """Insert the reviewed rows — all of them or none (the route commits once).

    Money out → expense. Money in → income on a bank account; on a card it's a credit
    (refund / cashback / bill payment), stored as an expense credited back.
    """
    is_card = req.source.card_id is not None
    account = active_account(session, req.source.account_id) if req.source.account_id else None
    card = active_card(session, req.source.card_id) if req.source.card_id else None

    categories: dict[uuid.UUID, Category] = {}
    txns: list[Transaction] = []
    with session.no_autoflush:
        for row in req.rows:
            txn = Transaction(
                kind=TransactionKind.EXPENSE if row.amount < 0 or is_card else TransactionKind.INCOME,
                amount=row.amount,
                occurred_at=entry_time(row.occurred_on, today),
                description=row.description,
                tags=[IMPORT_TAG],
                account=account,
                card=card,
            )
            if row.category_id is not None:
                if row.category_id not in categories:
                    categories[row.category_id] = usable_category(session, row.category_id)
                txn.category = categories[row.category_id]
            txns.append(txn)
    # One flush: SQLAlchemy batches the INSERTs (insertmanyvalues), so 500 rows ≈ a few round trips, not 500.
    session.add_all(txns)
    session.flush()

    if req.mapping is not None:
        save_mapping(session, req.source, req.mapping)
    return len(txns)


def save_mapping(session: Session, source: SourceIn, mapping: ColumnMapping) -> None:
    data = mapping.model_dump(mode="json")
    row = _mapping_row(session, source)
    if row is None:
        session.add(ImportMapping(account_id=source.account_id, card_id=source.card_id, mapping=data))
    else:
        row.mapping = data  # reassigning the whole dict marks the JSONB column as changed
    session.flush()

