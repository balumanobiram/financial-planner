"""Inbox actions: list, approve (→ real transactions), ignore, restore, bulk approve.

Approving calls the same create functions as Quick add and People, so the usual rules apply
(active account, shares ≤ amount, settlement ≤ what they owe…). Every created row gets
sms_message_id. If the money lands in a finished month whose report was frozen, that report
is rebuilt straight away, so it includes the newly approved money.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.time import IST
from app.models import BankAccount, Category, CreditCard, MerchantRule, MonthlySnapshot, SmsMessage, SmsStatus, Transaction
from app.schemas.inbox import (
    ApproveCardPayment,
    ApproveIn,
    ApproveRepayment,
    ApproveSimple,
    ApproveTransfer,
    BulkApproveResult,
    SmsItem,
)
from app.schemas.people import PaymentIn
from app.schemas.transactions import CategoryRef, SimpleCreate, SourceIn, SourceRef
from app.services import people as people_service
from app.services import reports as reports_service
from app.services import transactions as txn_service
from app.services.errors import ConflictError, InvalidInputError, NotFoundError
from app.services.sms_inbox import merchant_key, process_unparsed


# ---- Reading -------------------------------------------------------------------------------


def list_inbox(session: Session, status: SmsStatus, limit: int = 100) -> list[SmsMessage]:
    process_unparsed(session)  # anything the background task never reached
    return list(
        session.scalars(
            select(SmsMessage)
            .where(SmsMessage.status == status)
            .order_by(SmsMessage.received_at.desc(), SmsMessage.created_at.desc())
            .limit(limit)
        )
    )


def summary(session: Session) -> tuple[int, datetime | None]:
    pending, last = session.execute(
        select(
            func.count().filter(SmsMessage.status == SmsStatus.PENDING),
            func.max(SmsMessage.received_at),
        )
    ).one()
    return pending, last


def can_quick_approve(sms: SmsMessage) -> bool:
    return (
        sms.status is SmsStatus.PENDING
        and sms.parsed_at is not None
        and not sms.needs_review
        and sms.amount is not None
        and sms.is_debit is not None
        and (sms.account_id is not None or sms.card_id is not None)
        and sms.suggested_kind is not None
        and sms.suggested_kind.value in ("expense", "income")
        and sms.duplicate_of_sms_id is None
        and sms.duplicate_of_transaction_id is None
    )


def to_items(session: Session, rows: list[SmsMessage]) -> list[SmsItem]:
    """Names for the matched account/card/category, fetched in three small queries (no N+1)."""
    account_ids = {r.account_id for r in rows if r.account_id}
    card_ids = {r.card_id for r in rows if r.card_id}
    category_ids = {r.category_id for r in rows if r.category_id}
    accounts = {a.id: a for a in session.scalars(select(BankAccount).where(BankAccount.id.in_(account_ids)))} if account_ids else {}
    cards = {c.id: c for c in session.scalars(select(CreditCard).where(CreditCard.id.in_(card_ids)))} if card_ids else {}
    categories = {c.id: c for c in session.scalars(select(Category).where(Category.id.in_(category_ids)))} if category_ids else {}

    def source(r: SmsMessage) -> SourceRef | None:
        if r.account_id and (a := accounts.get(r.account_id)):
            return SourceRef(kind="account", id=a.id, name=f"{a.bank_name} · {a.nickname}")
        if r.card_id and (c := cards.get(r.card_id)):
            return SourceRef(kind="card", id=c.id, name=f"{c.bank_name} · {c.card_name}")
        return None

    def category(r: SmsMessage) -> CategoryRef | None:
        c = categories.get(r.category_id) if r.category_id else None
        return CategoryRef(id=c.id, name=c.name, icon=c.icon, color=c.color) if c else None

    return [
        SmsItem(
            id=r.id,
            sender=r.sender,
            text=r.text,
            received_at=r.received_at,
            status=r.status.value,
            parsed=r.parsed_at is not None,
            amount=r.amount,
            direction=None if r.is_debit is None else ("debit" if r.is_debit else "credit"),
            suggested_kind=r.suggested_kind.value if r.suggested_kind else None,
            merchant=r.merchant,
            upi_ref=r.upi_ref,
            last4=r.last4,
            occurred_at=r.occurred_at,
            source=source(r),
            category=category(r),
            needs_review=r.needs_review,
            note=r.note,
            duplicate_of_sms_id=r.duplicate_of_sms_id,
            duplicate_of_transaction_id=r.duplicate_of_transaction_id,
            can_quick_approve=can_quick_approve(r),
        )
        for r in rows
    ]


# ---- Changing ------------------------------------------------------------------------------


def get_sms(session: Session, sms_id: uuid.UUID) -> SmsMessage:
    sms = session.get(SmsMessage, sms_id)
    if sms is None:
        raise NotFoundError(f"SMS {sms_id} not found")
    return sms


def _require_pending(sms: SmsMessage) -> None:
    if sms.status is not SmsStatus.PENDING:
        raise ConflictError(f"This SMS is already {sms.status.value}")


def ignore(session: Session, sms: SmsMessage) -> None:
    _require_pending(sms)
    sms.status = SmsStatus.IGNORED
    session.flush()


def restore(session: Session, sms: SmsMessage) -> None:
    """Back to the inbox from Ignored / Rejected (e.g. the parser rejected a real payment)."""
    if sms.status not in (SmsStatus.IGNORED, SmsStatus.REJECTED):
        raise ConflictError("Only ignored or rejected SMS can go back to the inbox")
    sms.status = SmsStatus.PENDING
    session.flush()


def approve(session: Session, sms: SmsMessage, body: ApproveIn, today: date, now: datetime) -> list[Transaction]:
    _require_pending(sms)
    rows = _create(session, body, today)
    when = _exact_time(sms, body.occurred_on)
    for row in rows:
        row.sms_message_id = sms.id
        if when is not None:
            row.occurred_at = when  # keep the SMS's real time rather than midnight
    sms.status = SmsStatus.APPROVED
    if isinstance(body, ApproveSimple) and not body.parts and body.category_id:
        learn_merchant(session, sms.merchant, body.category_id)
    session.flush()
    _rebuild_frozen_reports(session, rows, today, now)
    return rows


def bulk_approve(session: Session, ids: list[uuid.UUID], today: date, now: datetime) -> BulkApproveResult:
    """Approve the unflagged ones with their suggested details; skip anything else."""
    approved = skipped = 0
    for sms_id in ids:
        sms = session.get(SmsMessage, sms_id)
        if sms is None or not can_quick_approve(sms):
            skipped += 1
            continue
        assert sms.amount is not None and sms.suggested_kind is not None
        body = ApproveSimple.model_validate(
            {
                "as": sms.suggested_kind.value,
                "source": {"account_id": sms.account_id} if sms.account_id else {"card_id": sms.card_id},
                "direction": "debit" if sms.is_debit else "credit",
                "amount": sms.amount,
                "occurred_on": sms.occurred_at.astimezone(IST).date() if sms.occurred_at else None,
                "description": sms.merchant,
                "category_id": sms.category_id,
            }
        )
        try:
            with session.begin_nested():  # a SAVEPOINT: one bad row is rolled back without undoing the others
                approve(session, sms, body, today, now)
            approved += 1
        except (InvalidInputError, ConflictError, NotFoundError):
            skipped += 1
    return BulkApproveResult(approved=approved, skipped=skipped)


def learn_merchant(session: Session, merchant: str | None, category_id: uuid.UUID) -> None:
    """Remember merchant → category so the next SMS from there is pre-filled."""
    key = merchant_key(merchant)
    if key is None:
        return
    stmt = insert(MerchantRule).values(id=uuid.uuid4(), merchant_key=key, category_id=category_id)
    session.execute(
        stmt.on_conflict_do_update(
            index_elements=[MerchantRule.merchant_key], set_={"category_id": stmt.excluded.category_id, "updated_at": func.now()}
        )
    )


def _create(session: Session, body: ApproveIn, today: date) -> list[Transaction]:
    common = {"amount": body.amount, "occurred_on": body.occurred_on, "today": today, "description": body.description, "tags": body.tags}
    if isinstance(body, ApproveCardPayment):
        return list(txn_service.create_card_payment(session, from_account_id=body.from_account_id, card_id=body.card_id, **common))
    if isinstance(body, ApproveTransfer):
        return list(txn_service.create_transfer(session, from_account_id=body.from_account_id, to_account_id=body.to_account_id, **common))
    if isinstance(body, ApproveRepayment):
        person = people_service.get_person(session, body.person_id)
        payment = PaymentIn(account_id=body.account_id, amount=body.amount, occurred_on=body.occurred_on, description=body.description)
        return [people_service.record_settlement(session, person, payment, today)]

    assert isinstance(body, ApproveSimple)
    parts = body.parts or [None]
    rows = []
    for part in parts:
        create = SimpleCreate(
            type=body.as_,
            source=SourceIn.model_validate(body.source.model_dump()),
            direction=body.direction,
            amount=part.amount if part else body.amount,
            occurred_on=body.occurred_on,
            description=body.description,
            tags=body.tags,
            category_id=part.category_id if part else body.category_id,
            person_id=body.person_id,
            shares=body.shares,
        )
        rows.append(txn_service.create_simple(session, create, today))
    return rows


def _exact_time(sms: SmsMessage, occurred_on: date | None) -> datetime | None:
    """The SMS's own timestamp, if you kept its date (otherwise the date you picked, at midnight)."""
    if sms.occurred_at is None:
        return None
    sms_day = sms.occurred_at.astimezone(IST).date()
    return sms.occurred_at if occurred_on in (None, sms_day) else None


def _rebuild_frozen_reports(session: Session, rows: list[Transaction], today: date, now: datetime) -> None:
    months = {r.occurred_at.astimezone(IST).date().replace(day=1) for r in rows}
    frozen = set(session.scalars(select(MonthlySnapshot.month).where(MonthlySnapshot.month.in_(months))))
    for month in sorted(frozen):
        reports_service.monthly_report(session, month, today, now, regenerate=True)

