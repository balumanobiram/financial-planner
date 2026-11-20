"""SMS inbox (behind login): review what the iPhone sent, then approve, ignore or restore."""

import uuid

from fastapi import APIRouter

from app.api.deps import DbSession, Now, Today
from app.models import SmsStatus
from app.schemas.inbox import ApproveIn, BulkApproveIn, BulkApproveResult, InboxPage, InboxSummary, SmsItem
from app.schemas.transactions import CreatedTransactions, TransactionItem
from app.services import sms_review as service
from app.services import transaction_queries as queries

router = APIRouter(prefix="/inbox", tags=["inbox"])


@router.get("")
def list_inbox(db: DbSession, status: SmsStatus = SmsStatus.PENDING) -> InboxPage:
    """Newest first. Also parses anything the background task missed."""
    rows = service.list_inbox(db, status)
    db.commit()  # keep what process_unparsed just parsed
    pending, last = service.summary(db)
    return InboxPage(items=service.to_items(db, rows), pending_count=pending, last_received_at=last)


@router.get("/summary")
def inbox_summary(db: DbSession) -> InboxSummary:
    """Cheap: the nav badge and the "no SMS for 3 days" banner."""
    pending, last = service.summary(db)
    return InboxSummary(pending_count=pending, last_received_at=last)


@router.post("/bulk-approve")
def bulk_approve(body: BulkApproveIn, db: DbSession, today: Today, now: Now) -> BulkApproveResult:
    result = service.bulk_approve(db, body.ids, today, now)
    db.commit()
    return result


@router.post("/{sms_id}/approve")
def approve(sms_id: uuid.UUID, body: ApproveIn, db: DbSession, today: Today, now: Now) -> CreatedTransactions:
    rows = service.approve(db, service.get_sms(db, sms_id), body, today, now)
    db.commit()
    return CreatedTransactions(items=[TransactionItem.model_validate(i) for i in queries.load_items(db, [r.id for r in rows])])


@router.post("/{sms_id}/ignore")
def ignore(sms_id: uuid.UUID, db: DbSession) -> SmsItem:
    sms = service.get_sms(db, sms_id)
    service.ignore(db, sms)
    db.commit()
    return service.to_items(db, [sms])[0]


@router.post("/{sms_id}/restore")
def restore(sms_id: uuid.UUID, db: DbSession) -> SmsItem:
    sms = service.get_sms(db, sms_id)
    service.restore(db, sms)
    db.commit()
    return service.to_items(db, [sms])[0]
