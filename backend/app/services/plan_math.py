"""Plan page figures. Pure functions — no database, easy to test.

  planned      = sum of every line
  left over    = salary − planned            (negative = you've planned more than you earn)
  % of salary  = per group and per line
  saving rate  = (savings + investments) ÷ salary
  50/30/20     = a common rule of thumb: needs ≤ 50%, wants ≤ 30%, savings + investments ≥ 20%
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.models import PlanGroup

ZERO = Decimal("0.00")
GROUP_ORDER = [PlanGroup.NEEDS, PlanGroup.WANTS, PlanGroup.SAVINGS, PlanGroup.INVESTMENTS]
TARGETS = {PlanGroup.NEEDS: Decimal(50), PlanGroup.WANTS: Decimal(30)}  # at most
SAVE_AT_LEAST = Decimal(20)
TOP_ITEMS = 5


@dataclass(frozen=True)
class Line:
    id: uuid.UUID
    name: str
    amount: Decimal
    group: PlanGroup


@dataclass(frozen=True)
class GroupTotal:
    group: PlanGroup
    amount: Decimal
    percent_of_salary: Decimal | None  # None when there's no salary yet
    items: int


@dataclass(frozen=True)
class RuleCheck:
    label: str  # "Needs"
    actual: Decimal | None
    target: Decimal
    at_most: bool  # needs/wants: at most; saving: at least
    ok: bool | None  # None without a salary


@dataclass(frozen=True)
class PlanFigures:
    salary: Decimal
    planned: Decimal
    left_over: Decimal
    left_over_percent: Decimal | None
    saving_rate: Decimal | None
    groups: list[GroupTotal]
    top_items: list[Line]
    rule_50_30_20: list[RuleCheck]


def percent(part: Decimal, whole: Decimal) -> Decimal | None:
    if whole <= 0:
        return None
    return (part * 100 / whole).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def figures(salary: Decimal, lines: Sequence[Line]) -> PlanFigures:
    by_group = {g: [line for line in lines if line.group is g] for g in GROUP_ORDER}
    totals = {g: sum((line.amount for line in group_lines), ZERO) for g, group_lines in by_group.items()}
    planned = sum(totals.values(), ZERO)
    left_over = salary - planned
    saved = totals[PlanGroup.SAVINGS] + totals[PlanGroup.INVESTMENTS]

    def check(label: str, actual: Decimal, target: Decimal, *, at_most: bool) -> RuleCheck:
        pct = percent(actual, salary)
        ok = None if pct is None else (pct <= target if at_most else pct >= target)
        return RuleCheck(label=label, actual=pct, target=target, at_most=at_most, ok=ok)

    return PlanFigures(
        salary=salary,
        planned=planned,
        left_over=left_over,
        left_over_percent=percent(left_over, salary),
        saving_rate=percent(saved, salary),
        groups=[GroupTotal(g, totals[g], percent(totals[g], salary), len(by_group[g])) for g in GROUP_ORDER],
        top_items=sorted(lines, key=lambda line: line.amount, reverse=True)[:TOP_ITEMS],
        rule_50_30_20=[
            check("Needs", totals[PlanGroup.NEEDS], TARGETS[PlanGroup.NEEDS], at_most=True),
            check("Wants", totals[PlanGroup.WANTS], TARGETS[PlanGroup.WANTS], at_most=True),
            check("Savings + investments", saved, SAVE_AT_LEAST, at_most=False),
        ],
    )
