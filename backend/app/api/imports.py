import uuid

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.api.deps import DbSession, Today
from app.schemas.imports import (
    ColumnMapping,
    CommitRequest,
    CommitResponse,
    ParseRequest,
    ParseResponse,
    PreviewRequest,
    PreviewResponse,
)
from app.schemas.transactions import SourceIn
from app.models import Category
from app.services import imports as service
from app.services.import_template import build_template
from app.services.errors import InvalidInputError

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/preview")
def preview(body: PreviewRequest, db: DbSession) -> PreviewResponse:
    """Step 1: the file's columns and first rows, plus a suggested (and any saved) mapping."""
    return service.preview(db, body)


@router.post("/parse")
def parse(body: ParseRequest, db: DbSession, today: Today) -> ParseResponse:
    """Step 2: every row read with the mapping, flagged as error / possible duplicate. Saves nothing."""
    return service.parse(db, body, today)


@router.post("/commit", status_code=201)
def commit(body: CommitRequest, db: DbSession, today: Today) -> CommitResponse:
    """Step 3: create the rows you kept — all in one database transaction — and remember the mapping."""
    created = service.commit(db, body, today)
    db.commit()
    return CommitResponse(created=created, mapping_saved=body.mapping is not None)


@router.get("/mapping")
def get_mapping(db: DbSession, account_id: uuid.UUID | None = None, card_id: uuid.UUID | None = None) -> ColumnMapping | None:
    """The mapping saved for an account or card (null if none yet)."""
    if (account_id is None) == (card_id is None):
        raise InvalidInputError("Pass exactly one of account_id or card_id")
    return service.saved_mapping(db, SourceIn(account_id=account_id, card_id=card_id))


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/template", response_class=Response, responses={200: {"content": {XLSX: {}}}})
def template(db: DbSession) -> Response:
    """A blank Excel sheet to fill with a month of transactions and upload via preview/parse/commit.
    Its Category column offers your active categories as a dropdown."""
    names = list(db.scalars(select(Category.name).where(Category.is_archived.is_(False)).order_by(Category.sort_order, Category.name)))
    return Response(
        content=build_template(names),
        media_type=XLSX,
        headers={"Content-Disposition": 'attachment; filename="planner-import-template.xlsx"', "Cache-Control": "no-store"},
    )
