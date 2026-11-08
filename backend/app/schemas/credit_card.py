"""Request/response models for credit cards."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.models import CardNetwork
from app.schemas.common import BankDomain, BlankToNone, MoneyAmount

Name = Annotated[str, Field(min_length=1, max_length=100)]
Last4 = Annotated[Annotated[str, Field(pattern=r"^\d{4}$")] | None, BlankToNone]
Notes = Annotated[Annotated[str, Field(max_length=2000)] | None, BlankToNone]
StatementDay = Annotated[int, Field(ge=1, le=31, description="Day of month the statement is generated")]
DueDays = Annotated[int, Field(ge=1, le=60, description="Days after the statement that payment is due")]
CreditLimit = Annotated[MoneyAmount, Field(gt=0)]


def _lower_hex(value: str) -> str:
    return value.lower()


Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$"), AfterValidator(_lower_hex)]


class _Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class CreditCardCreate(_Input):
    bank_name: Name
    card_name: Name
    network: CardNetwork
    last4: Last4 = None
    credit_limit: CreditLimit | None = None
    statement_day: StatementDay
    payment_due_days: DueDays
    color: Color = "#1f4fd1"
    bank_domain: BankDomain = Field(default=None, description="Bank website for the logo; guessed from bank_name if empty")
    notes: Notes = None


class CreditCardUpdate(_Input):
    """PATCH body: only the fields you send are changed."""

    bank_name: Name | None = None
    card_name: Name | None = None
    network: CardNetwork | None = None
    last4: Last4 = None
    credit_limit: CreditLimit | None = None
    statement_day: StatementDay | None = None
    payment_due_days: DueDays | None = None
    color: Color | None = None
    bank_domain: BankDomain = None
    notes: Notes = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> Self:
        for name in ("bank_name", "card_name", "network", "statement_day", "payment_due_days", "color"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class BillingRead(BaseModel):
    last_statement_date: date
    last_due_date: date
    next_statement_date: date
    next_due_date: date
    pay_by: date
    days_until_pay_by: int


class CreditCardRead(BaseModel):
    id: uuid.UUID
    bank_name: str
    card_name: str
    network: CardNetwork
    last4: str | None
    credit_limit: Decimal | None
    statement_day: int
    payment_due_days: int
    color: str
    bank_domain: str | None
    notes: str | None
    is_archived: bool
    logo_data_url: str | None = Field(description="Bank icon as a data: URL, or null → show a monogram")
    outstanding: Decimal = Field(description="What you owe on the card now: spends − payments − refunds")
    available_credit: Decimal | None = Field(description="credit_limit − outstanding (null if no limit set)")
    billing: BillingRead
    created_at: datetime
    updated_at: datetime


class CreditCardList(BaseModel):
    items: list[CreditCardRead] = Field(description="Active cards sorted by pay-by date, then archived")
