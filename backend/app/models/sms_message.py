"""Bank / UPI / card SMS sent in by the iPhone Shortcut: the inbox of not-yet-approved money.

An SMS is never a Transaction. Approving one *creates* normal transactions (linked back via
transactions.sms_message_id), so nothing here can leak into balances, the dashboard or
reports — those only ever read the transactions table. (≈ a staging table in front of a ledger.)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseEntity, Money, str_enum
from app.models.transaction import TransactionKind


class SmsStatus(StrEnum):
    PENDING = "pending"  # waiting in the inbox
    APPROVED = "approved"  # turned into transaction(s)
    IGNORED = "ignored"  # you said "not mine" / "ignore", or it repeats an earlier SMS
    REJECTED = "rejected"  # the parser decided no money moved (UPI request, due reminder…)


class SmsMessage(BaseEntity):
    __tablename__ = "sms_messages"
    __table_args__ = (
        CheckConstraint("amount IS NULL OR amount > 0", name="amount_positive"),
        CheckConstraint("NOT (account_id IS NOT NULL AND card_id IS NOT NULL)", name="at_most_one_source"),
        Index("ix_sms_messages_status_received_at", "status", "received_at"),  # the inbox, newest first
        Index("ix_sms_messages_upi_ref", "upi_ref"),
    )

    # ---- What arrived (full card numbers are masked before saving) ----
    sender: Mapped[str] = mapped_column(String(50))
    text: Mapped[str] = mapped_column(String(1000))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # sha256 of text + received minute: the same SMS posted twice is stored once.
    text_hash: Mapped[str] = mapped_column(String(64), unique=True)

    status: Mapped[SmsStatus] = mapped_column(
        str_enum(SmsStatus, "sms_status"), default=SmsStatus.PENDING, server_default=SmsStatus.PENDING.value
    )

    # ---- What the parser found (all optional: you can fill in the rest on approve) ----
    parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # NULL = not parsed yet
    amount: Mapped[Money | None]  # always positive; is_debit says which way
    is_debit: Mapped[bool | None]
    suggested_kind: Mapped[TransactionKind | None] = mapped_column(str_enum(TransactionKind, "sms_suggested_kind"))
    merchant: Mapped[str | None] = mapped_column(String(100))  # shop name or UPI ID
    upi_ref: Mapped[str | None] = mapped_column(String(40))
    last4: Mapped[str | None] = mapped_column(String(4))
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bank_accounts.id", ondelete="RESTRICT"))
    card_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("credit_cards.id", ondelete="RESTRICT"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))

    # ---- Flags ----
    needs_review: Mapped[bool] = mapped_column(default=False, server_default="false")
    note: Mapped[str | None] = mapped_column(String(255))  # why it's flagged / rejected, in plain words
    # "Possibly the same money as…" — only ever a flag, never deleted automatically.
    duplicate_of_sms_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sms_messages.id", ondelete="SET NULL"))
    duplicate_of_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL")
    )


class MerchantRule(BaseEntity):
    """"Swiggy → Food": remembered when you approve, used to suggest a category next time."""

    __tablename__ = "merchant_rules"

    merchant_key: Mapped[str] = mapped_column(String(100), unique=True)  # lower-cased, trimmed merchant
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
