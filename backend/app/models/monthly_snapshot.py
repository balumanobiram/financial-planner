from datetime import date
from typing import Any

from sqlalchemy import CheckConstraint, SmallInteger
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseEntity


class MonthlySnapshot(BaseEntity):
    """A finished month's report, frozen the first time it's viewed.

    Editing an old transaction later doesn't silently change last year's report;
    "Regenerate" rebuilds it on purpose. The whole ReportData is stored (balances,
    totals, statements, insights), so the report and PDF come straight from it.
    """

    __tablename__ = "monthly_snapshots"
    __table_args__ = (CheckConstraint("extract(day from month) = 1", name="month_is_first_day"),)

    month: Mapped[date] = mapped_column(unique=True)  # first day of the month
    schema_version: Mapped[int] = mapped_column(SmallInteger)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
