"""SMS inbox: store what the iPhone sends (fast), then parse, match and flag it (in the background).

/ingest must answer quickly (Render free tier, a phone waiting), so the request only does the
cheap things: drop OTPs, mask card numbers, skip exact repeats, insert. Everything else runs
after the response. Nothing here writes transactions — approving does (see the inbox service).
SMS text is never logged.
"""

import hashlib
import logging
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.time import IST, start_of_day_ist, today_ist
from app.models import BankAccount, CreditCard, MerchantRule, SmsMessage, SmsStatus, Transaction, TransactionKind
from app.services import sms_parser
from app.services.sms_parser import Direction, ParsedSms

log = logging.getLogger(__name__)

DUPLICATE_WINDOW = timedelta(minutes=10)
SessionFactory = Callable[[], AbstractContextManager[Session]]


def text_hash(text: str, received_at: datetime) -> str:
    """Same text in the same minute = the same SMS (the Shortcut fired twice)."""
    minute = received_at.astimezone(IST).strftime("%Y-%m-%dT%H:%M")
    return hashlib.sha256(f"{minute}|{text}".encode()).hexdigest()


def store(session: Session, *, text: str, sender: str, received_at: datetime) -> uuid.UUID | None:
    """Save a raw SMS. None when nothing was stored (an OTP, or an exact repeat)."""
    if sms_parser.is_otp(text):
        return None
    masked = sms_parser.mask_card_numbers(text)
    return session.scalar(
        insert(SmsMessage)
        .values(id=uuid.uuid4(), sender=sender, text=masked, received_at=received_at, text_hash=text_hash(masked, received_at))
        .on_conflict_do_nothing(index_elements=[SmsMessage.text_hash])
        .returning(SmsMessage.id)
    )


def merchant_key(merchant: str | None) -> str | None:
    return " ".join(merchant.lower().split())[:100] if merchant else None


# ---- Background processing ---------------------------------------------------------------


def process_safely(session_factory: SessionFactory, sms_id: uuid.UUID) -> None:
    """Background-task entry point: one failure must not crash the worker or log SMS text."""
    try:
        with session_factory() as session:
            process(session, sms_id)
            session.commit()
    except Exception as exc:  # noqa: BLE001 — anything; the SMS stays unparsed and is retried later
        log.warning("Parsing SMS %s failed: %s", sms_id, type(exc).__name__)


def process_unparsed(session: Session, limit: int = 50) -> int:
    """Parse anything the background task never got to (e.g. Render restarted mid-way)."""
    ids = list(
        session.scalars(select(SmsMessage.id).where(SmsMessage.parsed_at.is_(None)).order_by(SmsMessage.received_at).limit(limit))
    )
    for sms_id in ids:
        process(session, sms_id)
    return len(ids)


def process(session: Session, sms_id: uuid.UUID) -> None:
    sms = session.get(SmsMessage, sms_id)
    if sms is None or sms.parsed_at is not None:
        return
    parsed = sms_parser.parse(sms.text, sms.sender)
    sms.parsed_at = datetime.now(UTC)

    if parsed.rejected_reason:
        sms.status, sms.note = SmsStatus.REJECTED, parsed.rejected_reason
        session.flush()
        return

    on_date = sms_parser.plausible_date(parsed.on_date, today_ist(sms.received_at))
    parsed = _match_source(session, sms, parsed)
    sms.amount = parsed.amount
    sms.is_debit = None if parsed.direction is None else parsed.direction is Direction.DEBIT
    sms.merchant = parsed.merchant
    sms.upi_ref = parsed.upi_ref
    sms.last4 = parsed.last4
    # Same day as received → keep the exact time; another day → noon IST that day.
    received_day = sms.received_at.astimezone(IST).date()
    sms.occurred_at = sms.received_at if on_date in (None, received_day) else start_of_day_ist(on_date) + timedelta(hours=12)
    sms.suggested_kind = _kind(parsed, card=sms.card_id is not None)
    sms.category_id = _suggest_category(session, parsed.merchant)

    if _is_upi_repeat(session, sms):
        sms.status, sms.note = SmsStatus.IGNORED, "Repeat of an earlier SMS (same UPI reference)"
    else:
        reasons = list(parsed.unsure or [])
        reasons += _flag_possible_duplicate(session, sms)
        sms.needs_review = bool(reasons)
        sms.note = "; ".join(reasons) or None
    session.flush()


def _match_source(session: Session, sms: SmsMessage, parsed: ParsedSms) -> ParsedSms:
    """Last 4 digits → one of your (active) accounts or cards. Ambiguous or unknown → review."""
    if parsed.last4 is None:
        return sms_parser.with_unsure(parsed, "No account or card number in the SMS")
    accounts = list(session.scalars(select(BankAccount.id).where(BankAccount.last4 == parsed.last4, BankAccount.is_archived.is_(False))))
    cards = list(session.scalars(select(CreditCard.id).where(CreditCard.last4 == parsed.last4, CreditCard.is_archived.is_(False))))
    if len(accounts) + len(cards) == 1:
        sms.account_id = accounts[0] if accounts else None
        sms.card_id = cards[0] if cards else None
        return parsed
    if not accounts and not cards:
        return sms_parser.with_unsure(parsed, f"No account or card ending {parsed.last4}")
    return sms_parser.with_unsure(parsed, f"More than one account/card ends {parsed.last4}")


def _kind(parsed: ParsedSms, *, card: bool) -> TransactionKind | None:
    if parsed.is_card_payment:
        return TransactionKind.CARD_PAYMENT
    if parsed.direction is Direction.DEBIT:
        return TransactionKind.EXPENSE
    if parsed.direction is Direction.CREDIT:
        # Money onto a credit card that isn't a bill payment is a refund: still an "expense" row (+).
        return TransactionKind.EXPENSE if card else TransactionKind.INCOME
    return None


def _suggest_category(session: Session, merchant: str | None) -> uuid.UUID | None:
    key = merchant_key(merchant)
    if key is None:
        return None
    return session.scalar(select(MerchantRule.category_id).where(MerchantRule.merchant_key == key))


def _is_upi_repeat(session: Session, sms: SmsMessage) -> bool:
    if sms.upi_ref is None:
        return False
    return (
        session.scalar(
            select(func.count())
            .select_from(SmsMessage)
            .where(SmsMessage.upi_ref == sms.upi_ref, SmsMessage.id != sms.id, SmsMessage.status != SmsStatus.REJECTED)
        )
        > 0
    )


def _flag_possible_duplicate(session: Session, sms: SmsMessage) -> list[str]:
    """Same amount, within ±10 minutes, same last 4 (or same account/card). Only ever a flag."""
    if sms.amount is None or sms.occurred_at is None:
        return []
    low, high = sms.occurred_at - DUPLICATE_WINDOW, sms.occurred_at + DUPLICATE_WINDOW
    reasons: list[str] = []
    if sms.last4:
        other = session.scalar(
            select(SmsMessage.id)
            .where(
                SmsMessage.id != sms.id,
                SmsMessage.amount == sms.amount,
                SmsMessage.last4 == sms.last4,
                SmsMessage.occurred_at.between(low, high),
                SmsMessage.status.in_([SmsStatus.PENDING, SmsStatus.APPROVED]),
            )
            .limit(1)
        )
        if other:
            sms.duplicate_of_sms_id = other
            reasons.append("Possible duplicate of another SMS")
    if sms.account_id or sms.card_id:
        source = Transaction.account_id == sms.account_id if sms.account_id else Transaction.card_id == sms.card_id
        txn = session.scalar(
            select(Transaction.id)
            .where(source, func.abs(Transaction.amount) == sms.amount, Transaction.occurred_at.between(low, high))
            .limit(1)
        )
        if txn:
            sms.duplicate_of_transaction_id = txn
            reasons.append("Possible duplicate of a transaction you already have")
    return reasons
