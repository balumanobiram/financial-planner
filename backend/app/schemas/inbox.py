"""SMS inbox: list items and the "approve as…" requests.

Approving reuses the normal create rules (the same as Quick add / People), so an approved SMS
is exactly like a transaction you typed in — plus a link back to the SMS.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, model_validator

from app.schemas.people import ShareIn
from app.schemas.transactions import CategoryRef, Description, PositiveMoney, SourceIn, SourceRef, Tags, _Input


class SmsItem(BaseModel):
    id: uuid.UUID
    sender: str
    text: str
    received_at: datetime
    status: Literal["pending", "approved", "ignored", "rejected"]
    parsed: bool
    amount: Decimal | None
    direction: Literal["debit", "credit"] | None
    suggested_kind: str | None
    merchant: str | None
    upi_ref: str | None
    last4: str | None
    occurred_at: datetime | None
    source: SourceRef | None
    category: CategoryRef | None
    needs_review: bool
    note: str | None
    duplicate_of_sms_id: uuid.UUID | None
    duplicate_of_transaction_id: uuid.UUID | None
    can_quick_approve: bool = Field(description="Unflagged, with amount, direction and account/card: safe for bulk approve")


class InboxPage(BaseModel):
    items: list[SmsItem]
    pending_count: int
    last_received_at: datetime | None = Field(description="Newest SMS of any status; the UI warns when it's > 3 days old")


class InboxSummary(BaseModel):
    pending_count: int
    last_received_at: datetime | None


class CategoryPart(_Input):
    category_id: uuid.UUID | None = None
    amount: PositiveMoney


class _ApproveCommon(_Input):
    amount: PositiveMoney
    occurred_on: date | None = None
    description: Description = None
    tags: Tags = Field(default_factory=list)


class ApproveSimple(_ApproveCommon):
    """Expense or income. `parts` splits it across categories (one transaction per part);
    `shares` splits it with people (who owe you part of it) — one or the other."""

    as_: Literal["expense", "income"] = Field(alias="as")
    source: SourceIn
    direction: Literal["debit", "credit"] | None = None
    category_id: uuid.UUID | None = None
    parts: list[CategoryPart] = Field(default_factory=list, max_length=10)
    person_id: uuid.UUID | None = Field(default=None, description="Who it was from / for (e.g. paying someone back)")
    shares: list[ShareIn] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _parts_add_up(self) -> Self:
        if self.parts:
            if self.shares:
                raise ValueError("Split across categories or with people — not both at once")
            if len(self.parts) < 2:
                raise ValueError("Splitting across categories needs at least two parts")
            total = sum((p.amount for p in self.parts), Decimal(0))
            if total != self.amount:
                raise ValueError(f"The parts add up to {total}, not {self.amount}")
        return self


class ApproveCardPayment(_ApproveCommon):
    as_: Literal["card_payment"] = Field(alias="as")
    from_account_id: uuid.UUID
    card_id: uuid.UUID


class ApproveTransfer(_ApproveCommon):
    as_: Literal["transfer"] = Field(alias="as")
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID


class ApproveRepayment(_ApproveCommon):
    """Money in from a friend that pays back (part of) what they owe you."""

    as_: Literal["repayment"] = Field(alias="as")
    person_id: uuid.UUID
    account_id: uuid.UUID


ApproveIn = Annotated[ApproveSimple | ApproveCardPayment | ApproveTransfer | ApproveRepayment, Field(discriminator="as_")]


class BulkApproveIn(_Input):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class BulkApproveResult(BaseModel):
    approved: int
    skipped: int = Field(description="Flagged, already handled, or missing details — approve those one by one")
