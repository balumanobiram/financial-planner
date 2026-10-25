"""Import every model here so Base.metadata knows all tables (Alembic autogenerate relies on it)."""

from app.models.bank_account import AccountType, BankAccount
from app.models.base import Base
from app.models.transaction import Transaction, TransactionKind

__all__ = ["AccountType", "BankAccount", "Base", "Transaction", "TransactionKind"]
