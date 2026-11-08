"""GET /dashboard/summary — everything the home page shows, in one response."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.transactions import TransactionItem


class Stat(BaseModel):
    value: Decimal
    previous: Decimal = Field(description="Value at the end of last month")
    change_pct: Decimal | None = Field(description="% vs last month; null when last month was 0")


class Stats(BaseModel):
    bank_total: Stat = Field(description="Active bank accounts")
    card_outstanding: Stat = Field(description="What you owe across active cards")
    owed_to_me: Stat = Field(description="What people owe you (active people, positive balances)")
    net_position: Stat = Field(description="bank_total + owed_to_me − card_outstanding")


class CardDue(BaseModel):
    card_id: uuid.UUID
    card_name: str
    bank_name: str
    last4: str | None
    color: str
    status: Literal["overdue", "duesoon", "partpaid", "paid", "open"]
    amount: Decimal = Field(description="Left to pay on the statement; if it's paid, what you've spent since")
    statement_balance: Decimal
    paid_since_statement: Decimal
    outstanding: Decimal
    due_date: date
    days_left: int = Field(description="Negative when overdue")


class MonthFlow(BaseModel):
    month: date = Field(description="First day of the month")
    inflow: Decimal
    outflow: Decimal


class DaySpend(BaseModel):
    day: date
    amount: Decimal


class WeekSpending(BaseModel):
    days: list[DaySpend] = Field(description="Monday to Sunday of this week")
    total: Decimal
    last_week_total: Decimal
    change_pct: Decimal | None


class CategorySlice(BaseModel):
    category_id: uuid.UUID | None
    name: str
    icon: str
    color: str
    amount: Decimal
    percent: Decimal


class ExpenseBreakdown(BaseModel):
    week: list[CategorySlice]
    month: list[CategorySlice]
    week_total: Decimal
    month_total: Decimal


class DashboardSummary(BaseModel):
    today: date
    hero: CardDue | None = Field(description="The most urgent card bill due within 7 days (or overdue)")
    stats: Stats
    money_insights: list[MonthFlow] = Field(description="Last 12 months, oldest first; transfers & card payments excluded")
    week: WeekSpending = Field(description="Your share of spending (splits excluded, refunds deducted)")
    card_dues: list[CardDue]
    expenses: ExpenseBreakdown
    recent: list[TransactionItem]
