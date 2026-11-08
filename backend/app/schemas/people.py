"""Request/response models for people, shared expenses and settlements."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import BlankToNone, MoneyAmount

Name = Annotated[str, Field(min_length=1, max_length=100)]
Relation = Annotated[Annotated[str, Field(max_length=50)] | None, BlankToNone]
Notes = Annotated[Annotated[str, Field(max_length=2000)] | None, BlankToNone]
Description = Annotated[Annotated[str, Field(max_length=255)] | None, BlankToNone]
PositiveMoney = Annotated[MoneyAmount, Field(gt=0)]


class _Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


# ---- People ------------------------------------------------------------------


class PersonCreate(_Input):
    name: Name
    relation: Relation = None
    notes: Notes = None


class PersonUpdate(_Input):
    name: Name | None = None
    relation: Relation = None
    notes: Notes = None

    @model_validator(mode="after")
    def _name_not_null(self) -> Self:
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class PersonTotalsRead(BaseModel):
    shared_total: Decimal = Field(description="Everything they've been marked as owing")
    settled_total: Decimal = Field(description="Everything they've paid back")
    outstanding: Decimal = Field(description="shared − settled; > 0 means they owe you")
    received_total: Decimal = Field(description="Money they sent that wasn't repayment (income)")


class PersonRead(BaseModel):
    id: uuid.UUID
    name: str
    relation: str | None
    notes: str | None
    is_archived: bool
    totals: PersonTotalsRead
    created_at: datetime
    updated_at: datetime


class PeopleList(BaseModel):
    items: list[PersonRead] = Field(description="Active people (most owed first), then archived")
    total_outstanding: Decimal = Field(description="What all active people owe you, combined")


# ---- Money flows ---------------------------------------------------------------


class PaymentIn(_Input):
    """Money from a person arriving in one of your bank accounts (income or settlement)."""

    account_id: uuid.UUID
    amount: PositiveMoney
    occurred_on: date | None = Field(default=None, description="Defaults to today (IST)")
    description: Description = None


class ShareIn(_Input):
    person_id: uuid.UUID
    amount: PositiveMoney
    note: Description = None


class SharedExpenseIn(_Input):
    """Something you paid for (by card or from a bank account) that others owe you part of."""

    account_id: uuid.UUID | None = None
    card_id: uuid.UUID | None = None
    amount: PositiveMoney = Field(description="Total you spent")
    occurred_on: date | None = Field(default=None, description="Defaults to today (IST)")
    description: Description = None
    shares: list[ShareIn] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def _exactly_one_source(self) -> Self:
        if (self.account_id is None) == (self.card_id is None):
            raise ValueError("Pay with exactly one of account_id or card_id")
        if len({s.person_id for s in self.shares}) != len(self.shares):
            raise ValueError("Each person can appear only once in a split")
        return self


class TransactionRead(BaseModel):
    id: uuid.UUID
    kind: str
    amount: Decimal
    occurred_at: datetime
    description: str | None
    account_id: uuid.UUID | None
    card_id: uuid.UUID | None
    person_id: uuid.UUID | None


# ---- History -------------------------------------------------------------------


class HistoryType(StrEnum):
    SHARED_EXPENSE = "shared_expense"
    SETTLEMENT = "settlement"
    INCOME = "income"


class SourceRead(BaseModel):
    kind: Literal["account", "card"]
    id: uuid.UUID
    name: str = Field(description="e.g. 'HDFC Bank · Salary' or 'HDFC Bank · Regalia'")


class HistoryEntry(BaseModel):
    type: HistoryType
    transaction_id: uuid.UUID = Field(description="Delete this transaction to undo the entry")
    occurred_at: datetime
    description: str | None
    amount: Decimal = Field(description="Their share (shared expense) or what they paid (settlement/income)")
    source: SourceRead
    # shared expenses only
    total_spent: Decimal | None = None
    status: Literal["paid", "partpaid", "open"] | None = None
    remaining: Decimal | None = None


class PersonDetail(PersonRead):
    history: list[HistoryEntry] = Field(description="Newest first")
