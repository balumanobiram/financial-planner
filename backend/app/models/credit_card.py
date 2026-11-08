from enum import StrEnum

from sqlalchemy import CheckConstraint, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import ArchivableMixin, BaseEntity, Money, str_enum


class CardNetwork(StrEnum):
    VISA = "visa"
    MASTERCARD = "mastercard"
    RUPAY = "rupay"
    AMEX = "amex"
    DINERS = "diners"
    OTHER = "other"


class CreditCard(ArchivableMixin, BaseEntity):
    """A credit card. Only the last 4 digits are ever stored — never the full number, CVV or expiry.

    Outstanding amounts and payments arrive with transactions (later task).
    """

    __tablename__ = "credit_cards"
    __table_args__ = (
        CheckConstraint("last4 ~ '^[0-9]{4}$'", name="last4_digits"),
        CheckConstraint("statement_day BETWEEN 1 AND 31", name="statement_day_range"),
        CheckConstraint("payment_due_days BETWEEN 1 AND 60", name="payment_due_days_range"),
        CheckConstraint("color ~ '^#[0-9a-f]{6}$'", name="color_hex"),
        CheckConstraint("credit_limit IS NULL OR credit_limit > 0", name="credit_limit_positive"),
    )

    bank_name: Mapped[str] = mapped_column(String(100))
    card_name: Mapped[str] = mapped_column(String(100))
    network: Mapped[CardNetwork] = mapped_column(str_enum(CardNetwork, "card_network"))
    last4: Mapped[str | None] = mapped_column(String(4))
    credit_limit: Mapped[Money | None]
    # Statement is generated on this day each month (29–31 → last day of shorter months).
    statement_day: Mapped[int] = mapped_column(SmallInteger)
    # Payment due this many days after the statement (commonly 15–20).
    payment_due_days: Mapped[int] = mapped_column(SmallInteger)
    # Card colour as lowercase #rrggbb, to look like the physical card.
    color: Mapped[str] = mapped_column(String(7), default="#1f4fd1", server_default="#1f4fd1")
    # Bank website, used to fetch its logo (shared via bank_logos.domain).
    bank_domain: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
