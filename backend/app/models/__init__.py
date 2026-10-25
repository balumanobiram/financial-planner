"""Import every model here so Base.metadata knows all tables (Alembic autogenerate relies on it)."""

from app.models.bank_account import AccountType, BankAccount
from app.models.bank_logo import BankLogo
from app.models.base import Base
from app.models.category import Category, CategoryKind
from app.models.credit_card import CardNetwork, CreditCard
from app.models.expense_share import ExpenseShare
from app.models.import_mapping import ImportMapping
from app.models.person import Person
from app.models.transaction import Transaction, TransactionKind

__all__ = [
    "AccountType",
    "BankAccount",
    "BankLogo",
    "Base",
    "CardNetwork",
    "Category",
    "CategoryKind",
    "CreditCard",
    "ExpenseShare",
    "ImportMapping",
    "Person",
    "Transaction",
    "TransactionKind",
]
