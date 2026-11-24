"""The Plan page: your salary and where it should go. A planning sheet only — it never reads or
changes accounts, transactions or reports, and nothing else in the app reads it."""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, SmallInteger, String, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseEntity, Money, str_enum


class PlanGroup(StrEnum):
    NEEDS = "needs"  # rent, groceries, EMI, bills
    WANTS = "wants"  # eating out, shopping, fun
    SAVINGS = "savings"
    INVESTMENTS = "investments"


class BudgetPlan(BaseEntity):
    """There is exactly one plan (`singleton` is always true and unique)."""

    __tablename__ = "budget_plans"
    __table_args__ = (
        CheckConstraint("singleton", name="only_one"),
        CheckConstraint("salary >= 0", name="salary_not_negative"),
    )

    singleton: Mapped[bool] = mapped_column(default=True, server_default=true(), unique=True)
    salary: Mapped[Money] = mapped_column(default=Decimal("0.00"), server_default="0")
    notes: Mapped[str | None] = mapped_column(String(1000))

    items: Mapped[list[BudgetPlanItem]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="BudgetPlanItem.sort_order", passive_deletes=True
    )


class BudgetPlanItem(BaseEntity):
    """One line: "Rent ₹18,000 (needs)"."""

    __tablename__ = "budget_plan_items"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budget_plans.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Money]
    group: Mapped[PlanGroup] = mapped_column(str_enum(PlanGroup, "plan_group"))
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")

    plan: Mapped[BudgetPlan] = relationship(back_populates="items")
