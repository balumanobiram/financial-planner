"""Plan page: salary + planned lines, and the figures worked out from them."""

import uuid
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field

from app.models import PlanGroup
from app.schemas.common import BlankToNone, MoneyAmount
from app.schemas.transactions import PositiveMoney, _Input

Name = Annotated[str, Field(min_length=1, max_length=100)]
Notes = Annotated[Annotated[str, Field(max_length=1000)] | None, BlankToNone]


class PlanUpdate(_Input):
    salary: Annotated[MoneyAmount, Field(ge=0)] | None = None
    notes: Notes = None


class PlanItemCreate(_Input):
    name: Name
    amount: PositiveMoney
    group: PlanGroup


class PlanItemUpdate(_Input):
    name: Name | None = None
    amount: PositiveMoney | None = None
    group: PlanGroup | None = None


class PlanItemRead(BaseModel):
    id: uuid.UUID
    name: str
    amount: Decimal
    group: PlanGroup
    percent_of_salary: Decimal | None


class GroupTotalRead(BaseModel):
    group: PlanGroup
    amount: Decimal
    percent_of_salary: Decimal | None
    items: int


class RuleCheckRead(BaseModel):
    label: str
    actual: Decimal | None = Field(description="% of salary; null without a salary")
    target: Decimal
    at_most: bool
    ok: bool | None


class PlanRead(BaseModel):
    salary: Decimal
    notes: str | None
    items: list[PlanItemRead]
    planned: Decimal
    left_over: Decimal = Field(description="salary − planned; negative = planned more than you earn")
    left_over_percent: Decimal | None
    saving_rate: Decimal | None = Field(description="(savings + investments) ÷ salary, %")
    groups: list[GroupTotalRead]
    top_items: list[PlanItemRead]
    rule_50_30_20: list[RuleCheckRead]
