"""Request/response models for bank accounts (≈ DTOs with Bean Validation annotations)."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import AccountType
from app.schemas.common import BlankToNone, MoneyAmount

Name = Annotated[str, Field(min_length=1, max_length=100)]
# Constraints sit on the inner `str` so they are skipped once a blank value has become None.
Last4 = Annotated[Annotated[str, Field(pattern=r"^\d{4}$")] | None, BlankToNone]
Notes = Annotated[Annotated[str, Field(max_length=2000)] | None, BlankToNone]


class _Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class BankAccountCreate(_Input):
    bank_name: Name
    nickname: Name
    account_type: AccountType
    last4: Last4 = None
    opening_balance: MoneyAmount = Decimal("0.00")
    opening_date: date
    notes: Notes = None


class BankAccountUpdate(_Input):
    """PATCH body: only the fields you send are changed."""

    bank_name: Name | None = None
    nickname: Name | None = None
    account_type: AccountType | None = None
    last4: Last4 = None
    opening_balance: MoneyAmount | None = None
    opening_date: date | None = None
    notes: Notes = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> Self:
        for name in ("bank_name", "nickname", "account_type", "opening_balance", "opening_date"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class BankAccountRead(BaseModel):
    id: uuid.UUID
    bank_name: str
    nickname: str
    account_type: AccountType
    last4: str | None
    opening_balance: Decimal
    opening_date: date
    notes: str | None
    is_archived: bool
    current_balance: Decimal
    created_at: datetime
    updated_at: datetime


class BankAccountList(BaseModel):
    items: list[BankAccountRead]
    total_balance: Decimal = Field(description="Sum of current balances of non-archived accounts")


class ReconcileRequest(BaseModel):
    actual_balance: MoneyAmount = Field(description="Balance shown in your bank app right now")


class AdjustmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    amount: Decimal
    occurred_at: datetime
    description: str | None


class ReconcileResponse(BaseModel):
    account: BankAccountRead
    adjustment: AdjustmentRead | None = Field(description="None when the balance already matched")
