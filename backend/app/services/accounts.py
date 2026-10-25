"""Bank account CRUD. Functions flush but never commit — the route owns the transaction."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BankAccount
from app.schemas.bank_account import BankAccountCreate, BankAccountUpdate
from app.services.errors import ArchivedAccountError, NotFoundError


def list_accounts(session: Session, *, include_archived: bool = False) -> list[BankAccount]:
    stmt = select(BankAccount).order_by(BankAccount.is_archived, BankAccount.bank_name, BankAccount.nickname)
    if not include_archived:
        stmt = stmt.where(BankAccount.is_archived.is_(False))
    return list(session.scalars(stmt))


def get_account(session: Session, account_id: uuid.UUID) -> BankAccount:
    account = session.get(BankAccount, account_id)
    if account is None:
        raise NotFoundError(f"Account {account_id} not found")
    return account


def create_account(session: Session, data: BankAccountCreate) -> BankAccount:
    account = BankAccount(**data.model_dump())
    session.add(account)
    session.flush()
    return account


def update_account(session: Session, account: BankAccount, data: BankAccountUpdate) -> BankAccount:
    if account.is_archived:
        raise ArchivedAccountError("Unarchive the account before editing it")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    session.flush()
    return account


def set_archived(session: Session, account: BankAccount, *, archived: bool) -> BankAccount:
    account.is_archived = archived
    session.flush()
    return account
