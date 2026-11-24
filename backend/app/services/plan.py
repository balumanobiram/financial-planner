"""Plan page storage: one plan row (created on first use) and its lines."""

import uuid
from dataclasses import asdict

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import BudgetPlan, BudgetPlanItem
from app.schemas.plan import GroupTotalRead, PlanItemCreate, PlanItemRead, PlanItemUpdate, PlanRead, PlanUpdate, RuleCheckRead
from app.services import plan_math
from app.services.errors import InvalidInputError, NotFoundError

MAX_ITEMS = 100


def get_plan(session: Session) -> BudgetPlan:
    """The one plan; created empty the first time (ON CONFLICT: two first visits can't make two)."""
    session.execute(insert(BudgetPlan).values(id=uuid.uuid4()).on_conflict_do_nothing(index_elements=[BudgetPlan.singleton]))
    plan = session.scalar(select(BudgetPlan))
    assert plan is not None
    return plan


def update_plan(session: Session, data: PlanUpdate) -> BudgetPlan:
    plan = get_plan(session)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "salary" and value is None:
            continue
        setattr(plan, field, value)
    session.flush()
    return plan


def add_item(session: Session, data: PlanItemCreate) -> BudgetPlanItem:
    plan = get_plan(session)
    if len(plan.items) >= MAX_ITEMS:
        raise InvalidInputError(f"A plan can have up to {MAX_ITEMS} lines")
    last = session.scalar(select(func.max(BudgetPlanItem.sort_order)).where(BudgetPlanItem.plan_id == plan.id))
    item = BudgetPlanItem(plan=plan, name=data.name, amount=data.amount, group=data.group, sort_order=(last or 0) + 1)
    session.add(item)
    session.flush()
    return item


def get_item(session: Session, item_id: uuid.UUID) -> BudgetPlanItem:
    item = session.get(BudgetPlanItem, item_id)
    if item is None:
        raise NotFoundError(f"Plan line {item_id} not found")
    return item


def update_item(session: Session, item: BudgetPlanItem, data: PlanItemUpdate) -> BudgetPlanItem:
    for field, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(item, field, value)
    session.flush()
    return item


def delete_item(session: Session, item: BudgetPlanItem) -> None:
    session.delete(item)
    session.flush()


def to_read(plan: BudgetPlan) -> PlanRead:
    lines = [plan_math.Line(id=i.id, name=i.name, amount=i.amount, group=i.group) for i in plan.items]
    f = plan_math.figures(plan.salary, lines)

    def item(line: plan_math.Line) -> PlanItemRead:
        return PlanItemRead(**asdict(line), percent_of_salary=plan_math.percent(line.amount, plan.salary))

    return PlanRead(
        salary=plan.salary,
        notes=plan.notes,
        items=[item(line) for line in lines],
        planned=f.planned,
        left_over=f.left_over,
        left_over_percent=f.left_over_percent,
        saving_rate=f.saving_rate,
        groups=[GroupTotalRead(**asdict(g)) for g in f.groups],
        top_items=[item(line) for line in f.top_items],
        rule_50_30_20=[RuleCheckRead(**asdict(r)) for r in f.rule_50_30_20],
    )
