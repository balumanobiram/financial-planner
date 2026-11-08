"""Request/response models for transactions.

Amounts in requests are always POSITIVE; the type (and optional direction) decides the sign.
Responses carry the signed `amount` plus a derived `direction` ("debit" = money out).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.common import BlankToNone, MoneyAmount
from app.schemas.people import ShareIn

PositiveMoney = Annotated[MoneyAmount, Field(gt=0)]
Description = Annotated[Annotated[str, Field(max_length=255)] | None, BlankToNone]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=30)]


def _dedupe(tags: list[str]) -> list[str]:
    return list(dict.fromkeys(tags))  # keep first-seen order


Tags = Annotated[list[Tag], Field(max_length=10), AfterValidator(_dedupe)]
Direction = Literal["debit", "credit"]


class _Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class SourceIn(_Input):
    account_id: uuid.UUID | None = None
    card_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> Self:
        if (self.account_id is None) == (self.card_id is None):
            raise ValueError("Pick exactly one of account_id or card_id")
        return self


class _CreateCommon(_Input):
    amount: PositiveMoney
    occurred_on: date | None = Field(default=None, description="Defaults to today (IST)")
    description: Description = None
    tags: Tags = Field(default_factory=list)


class SimpleCreate(_CreateCommon):
    """An expense or income on one bank account or card."""

    type: Literal["expense", "income"]
    source: SourceIn
    direction: Direction | None = Field(default=None, description="Override the usual sign, e.g. a refund is an expense credited back")
    category_id: uuid.UUID | None = None
    person_id: uuid.UUID | None = Field(default=None, description="Who the money came from / was for")
    shares: list[ShareIn] = Field(default_factory=list, max_length=20, description="Split: who owes you part of this")

    @property
    def is_debit(self) -> bool:
        return (self.direction or ("debit" if self.type == "expense" else "credit")) == "debit"

    @model_validator(mode="after")
    def _shares_only_on_money_out(self) -> Self:
        if self.shares and not self.is_debit:
            raise ValueError("Only money you spent can be split")
        if len({s.person_id for s in self.shares}) != len(self.shares):
            raise ValueError("Each person can appear only once in a split")
        return self


class TransferCreate(_CreateCommon):
    type: Literal["transfer"]
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID


class CardPaymentCreate(_CreateCommon):
    type: Literal["card_payment"]
    from_account_id: uuid.UUID
    card_id: uuid.UUID


# Pydantic picks the right shape from "type" (≈ Jackson @JsonTypeInfo / @JsonSubTypes).
TransactionCreate = Annotated[SimpleCreate | TransferCreate | CardPaymentCreate, Field(discriminator="type")]


class TransactionUpdate(_Input):
    """PATCH: only fields you send change. Send `null` to clear description/category."""

    amount: PositiveMoney | None = None
    direction: Direction | None = None
    occurred_on: date | None = None
    description: Description = None
    tags: Tags | None = None
    category_id: uuid.UUID | None = None
    source: SourceIn | None = None
    shares: list[ShareIn] | None = Field(default=None, max_length=20, description="Replaces the whole split")

    @model_validator(mode="after")
    def _unique_people(self) -> Self:
        if self.shares and len({s.person_id for s in self.shares}) != len(self.shares):
            raise ValueError("Each person can appear only once in a split")
        return self


# ---- Responses ---------------------------------------------------------------------------


class SourceRef(BaseModel):
    kind: Literal["account", "card"]
    id: uuid.UUID
    name: str


class CategoryRef(BaseModel):
    id: uuid.UUID
    name: str
    icon: str
    color: str


class PersonRef(BaseModel):
    id: uuid.UUID
    name: str


class ShareRead(BaseModel):
    person_id: uuid.UUID
    person_name: str
    amount: Decimal


class TransactionItem(BaseModel):
    id: uuid.UUID
    type: str
    direction: Direction
    amount: Decimal = Field(description="Signed: negative = money out")
    occurred_at: datetime
    description: str | None
    tags: list[str]
    source: SourceRef
    counterpart: SourceRef | None = Field(description="Other side of a transfer / card payment")
    category: CategoryRef | None
    person: PersonRef | None
    shares: list[ShareRead]
    link_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class TransactionSummary(BaseModel):
    """Over the whole filtered set (not just this page); transfers & card payments excluded."""

    count: int
    money_in: Decimal
    money_out: Decimal


class TransactionPage(BaseModel):
    items: list[TransactionItem]
    next_cursor: str | None = Field(description="Pass as ?cursor= to get the next page; null at the end")
    summary: TransactionSummary | None = Field(description="Only on the first page")


class CreatedTransactions(BaseModel):
    items: list[TransactionItem] = Field(description="One row, or both halves of a transfer / card payment")
