import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, status
from sqlalchemy.orm import Session

from app.api.deps import DbSession, Fetcher, Now
from app.models import BankAccount, BankLogo
from app.schemas.bank_account import (
    AdjustmentRead,
    BankAccountCreate,
    BankAccountList,
    BankAccountRead,
    BankAccountUpdate,
    ReconcileRequest,
    ReconcileResponse,
)
from app.services import accounts as service
from app.services.balances import account_balance, account_balances, reconcile
from app.services.logos import logos_by_domain, to_data_url

router = APIRouter(prefix="/accounts", tags=["accounts"])

_ORM_FIELDS = [name for name in BankAccountRead.model_fields if name not in {"current_balance", "logo_data_url"}]


def _to_read(account: BankAccount, balance: Decimal, logo: BankLogo | None) -> BankAccountRead:
    return BankAccountRead.model_validate(
        {
            **{name: getattr(account, name) for name in _ORM_FIELDS},
            "current_balance": balance,
            "logo_data_url": to_data_url(logo) if logo else None,
        }
    )


def _read_one(db: Session, account: BankAccount, now: datetime) -> BankAccountRead:
    logo = logos_by_domain(db, [account.bank_domain]).get(account.bank_domain or "")
    return _to_read(account, account_balance(db, account, now), logo)


@router.get("")
def list_accounts(db: DbSession, now: Now, include_archived: bool = False) -> BankAccountList:
    accounts = service.list_accounts(db, include_archived=include_archived)
    balances = account_balances(db, accounts, now)
    logos = logos_by_domain(db, (a.bank_domain for a in accounts))
    total = sum((balances[a.id] for a in accounts if not a.is_archived), Decimal("0.00"))
    items = [_to_read(a, balances[a.id], logos.get(a.bank_domain or "")) for a in accounts]
    return BankAccountList(items=items, total_balance=total)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_account(body: BankAccountCreate, db: DbSession, now: Now, fetcher: Fetcher) -> BankAccountRead:
    account = service.create_account(db, body, fetcher)
    db.commit()
    return _read_one(db, account, now)


@router.get("/{account_id}")
def get_account(account_id: uuid.UUID, db: DbSession, now: Now) -> BankAccountRead:
    account = service.get_account(db, account_id)
    return _read_one(db, account, now)


@router.patch("/{account_id}")
def update_account(
    account_id: uuid.UUID, body: BankAccountUpdate, db: DbSession, now: Now, fetcher: Fetcher
) -> BankAccountRead:
    account = service.update_account(db, service.get_account(db, account_id), body, fetcher)
    db.commit()
    return _read_one(db, account, now)


@router.post("/{account_id}/archive")
def archive_account(account_id: uuid.UUID, db: DbSession, now: Now) -> BankAccountRead:
    account = service.set_archived(db, service.get_account(db, account_id), archived=True)
    db.commit()
    return _read_one(db, account, now)


@router.post("/{account_id}/unarchive")
def unarchive_account(account_id: uuid.UUID, db: DbSession, now: Now) -> BankAccountRead:
    account = service.set_archived(db, service.get_account(db, account_id), archived=False)
    db.commit()
    return _read_one(db, account, now)


@router.post("/{account_id}/reconcile")
def reconcile_account(account_id: uuid.UUID, body: ReconcileRequest, db: DbSession, now: Now) -> ReconcileResponse:
    """Enter the real balance from your bank app; an adjustment transaction covers the difference."""
    account = service.get_account(db, account_id)
    adjustment = reconcile(db, account, body.actual_balance, now)
    db.commit()
    return ReconcileResponse(
        account=_read_one(db, account, now),
        adjustment=AdjustmentRead.model_validate(adjustment) if adjustment else None,
    )


@router.post("/{account_id}/refresh-logo")
def refresh_logo(account_id: uuid.UUID, db: DbSession, now: Now, fetcher: Fetcher) -> BankAccountRead:
    """Fetch (or re-fetch) the bank's icon; guesses the website from the bank name if it's not set."""
    account = service.get_account(db, account_id)
    service.refresh_logo(db, account, fetcher)
    db.commit()
    return _read_one(db, account, now)
