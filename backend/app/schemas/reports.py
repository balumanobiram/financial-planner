"""ReportData: one model behind both the in-app report and the PDF.

Money is Decimal (serialised as strings); percentages are Decimal with 1 decimal place.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

REPORT_SCHEMA_VERSION = 2  # bump when ReportData's shape changes; older snapshots are rebuilt (2: period wording fields)

PeriodKind = Literal["monthly", "months", "financial_year", "yearly", "range"]


class Period(BaseModel):
    kind: PeriodKind
    start: date
    end: date  # inclusive
    label: str = Field(description='e.g. "October 2026", "Apr – Sep 2026", "FY 2025–26", "2026", "1 Oct – 15 Oct 2026"')
    title: str = Field(description='"Monthly report", "Financial year report", …')
    compare_label: str = Field(description='What it is compared with: "last month", "the previous 6 months", …')
    span_label: str = Field(description='"this month", "this financial year", "over these 6 months", …')
    previous_start: date = Field(description="The comparison period (same length, just before)")
    previous_end: date
    is_complete: bool = Field(description="False while the period is still running (numbers will change)")


class AccountLine(BaseModel):
    account_id: uuid.UUID
    name: str
    bank_name: str
    opening: Decimal
    closing: Decimal
    change: Decimal
    is_archived: bool


class Summary(BaseModel):
    accounts: list[AccountLine]
    banks_opening: Decimal
    banks_closing: Decimal
    income: Decimal
    expenses: Decimal = Field(description="Your share of spending: splits excluded, refunds deducted")
    net_savings: Decimal
    savings_rate: Decimal | None = Field(description="net_savings ÷ income × 100; null without income")


class IncomeSource(BaseModel):
    source: Literal["salary", "people", "other"]
    label: str
    amount: Decimal
    percent: Decimal


class CategoryLine(BaseModel):
    category_id: uuid.UUID | None
    name: str
    color: str
    icon: str
    amount: Decimal
    percent: Decimal
    previous: Decimal
    change_pct: Decimal | None


class LargeExpense(BaseModel):
    transaction_id: uuid.UUID
    occurred_on: date
    description: str | None
    category: str | None
    source: str
    amount: Decimal = Field(description="Full amount paid (positive)")


StatementStatus = Literal["paid", "paid_late", "partpaid", "overdue", "open", "nothing_due"]


class CardStatement(BaseModel):
    card_id: uuid.UUID
    card_name: str
    bank_name: str
    last4: str | None
    color: str
    statement_date: date
    due_date: date
    amount: Decimal = Field(description="What the statement asked for (balance at the end of the statement day)")
    paid: Decimal = Field(description="Paid after the statement, up to the next one (or today)")
    paid_by_due: Decimal
    status: StatementStatus
    utilization_pct: Decimal | None
    fees: Decimal = Field(description="Interest / fees charged in the period (matched by description)")


class PersonLine(BaseModel):
    person_id: uuid.UUID
    name: str
    owed_at_start: Decimal
    new_shares: Decimal
    settled: Decimal
    pending: Decimal = Field(description="Still owed at the end of the period")


class NetPosition(BaseModel):
    banks: Decimal
    owed_to_me: Decimal
    card_outstanding: Decimal
    value: Decimal
    previous_value: Decimal = Field(description="Net position at the end of the previous period")
    change: Decimal


class TrendPoint(BaseModel):
    month: date
    income: Decimal
    expenses: Decimal


class Insight(BaseModel):
    tone: Literal["good", "info", "warn", "bad"]
    text: str


class ReportData(BaseModel):
    schema_version: int = REPORT_SCHEMA_VERSION
    period: Period
    generated_at: datetime
    from_snapshot: bool = False
    summary: Summary
    income_sources: list[IncomeSource]
    expense_categories: list[CategoryLine]
    top_expenses: list[LargeExpense]
    cards: list[CardStatement]
    people: list[PersonLine]
    net_position: NetPosition
    trend: list[TrendPoint] = Field(description="Monthly income vs expenses for the chart")
    insights: list[Insight]
