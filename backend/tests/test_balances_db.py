"""Balance and reconcile logic against real Postgres (Neon dev, rolled back after each test)."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccountType, BankAccount, Transaction, TransactionKind
from app.services.balances import account_balance, account_balances, reconcile
from app.services.errors import ArchivedAccountError

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)


def make_account(session: Session, opening: str = "1000.00", nickname: str = "Main") -> BankAccount:
    account = BankAccount(
        bank_name="HDFC",
        nickname=nickname,
        account_type=AccountType.SAVINGS,
        opening_balance=Decimal(opening),
        opening_date=date(2026, 1, 1),
    )
    session.add(account)
    session.flush()
    return account


def add_txn(session: Session, account: BankAccount, amount: str, when: datetime = NOW - timedelta(days=1)) -> None:
    kind = TransactionKind.INCOME if Decimal(amount) > 0 else TransactionKind.EXPENSE
    session.add(Transaction(account=account, kind=kind, amount=Decimal(amount), occurred_at=when))
    session.flush()


class TestAccountBalance:
    def test_no_transactions_equals_opening(self, db_session: Session) -> None:
        account = make_account(db_session, "1234.56")
        assert account_balance(db_session, account, NOW) == Decimal("1234.56")

    def test_opening_plus_signed_transactions(self, db_session: Session) -> None:
        account = make_account(db_session, "1000.00")
        add_txn(db_session, account, "50000.00")  # salary
        add_txn(db_session, account, "-1999.99")  # spend
        add_txn(db_session, account, "-0.01")
        assert account_balance(db_session, account, NOW) == Decimal("49000.00")

    def test_future_dated_transactions_not_counted_yet(self, db_session: Session) -> None:
        account = make_account(db_session, "1000.00")
        add_txn(db_session, account, "-300.00", when=NOW)  # exactly now counts
        add_txn(db_session, account, "-200.00", when=NOW + timedelta(seconds=1))
        assert account_balance(db_session, account, NOW) == Decimal("700.00")
        assert account_balance(db_session, account, NOW + timedelta(days=1)) == Decimal("500.00")

    def test_other_accounts_transactions_ignored(self, db_session: Session) -> None:
        a = make_account(db_session, "100.00", "A")
        b = make_account(db_session, "100.00", "B")
        add_txn(db_session, b, "-40.00")
        assert account_balance(db_session, a, NOW) == Decimal("100.00")

    def test_negative_balance_allowed(self, db_session: Session) -> None:
        account = make_account(db_session, "0.00")
        add_txn(db_session, account, "-2500.00")
        assert account_balance(db_session, account, NOW) == Decimal("-2500.00")

    def test_requires_timezone_aware_time(self, db_session: Session) -> None:
        account = make_account(db_session)
        with pytest.raises(ValueError, match="timezone-aware"):
            account_balance(db_session, account, datetime(2026, 1, 1))


class TestAccountBalances:
    def test_matches_single_balance_for_each_account(self, db_session: Session) -> None:
        a = make_account(db_session, "100.00", "A")
        b = make_account(db_session, "200.00", "B")
        c = make_account(db_session, "300.00", "C")  # no transactions
        add_txn(db_session, a, "10.00")
        add_txn(db_session, b, "-20.00")
        add_txn(db_session, b, "-30.00")

        balances = account_balances(db_session, [a, b, c], NOW)

        assert balances == {a.id: Decimal("110.00"), b.id: Decimal("150.00"), c.id: Decimal("300.00")}
        for account in (a, b, c):
            assert balances[account.id] == account_balance(db_session, account, NOW)

    def test_empty_list(self, db_session: Session) -> None:
        assert account_balances(db_session, [], NOW) == {}


class TestReconcile:
    @pytest.mark.parametrize(("actual", "expected_adjustment"), [("1500.00", "500.00"), ("876.55", "-123.45")])
    def test_creates_adjustment_for_difference(
        self, db_session: Session, actual: str, expected_adjustment: str
    ) -> None:
        account = make_account(db_session, "1000.00")

        adjustment = reconcile(db_session, account, Decimal(actual), NOW)

        assert adjustment is not None
        assert adjustment.kind is TransactionKind.ADJUSTMENT
        assert adjustment.amount == Decimal(expected_adjustment)
        assert adjustment.occurred_at == NOW
        assert account_balance(db_session, account, NOW) == Decimal(actual)

    def test_no_adjustment_when_already_matching(self, db_session: Session) -> None:
        account = make_account(db_session, "1000.00")
        add_txn(db_session, account, "-250.00")

        assert reconcile(db_session, account, Decimal("750.00"), NOW) is None
        assert db_session.scalars(select(Transaction).where(Transaction.kind == TransactionKind.ADJUSTMENT)).all() == []

    def test_reconcile_twice_is_idempotent(self, db_session: Session) -> None:
        account = make_account(db_session, "1000.00")
        reconcile(db_session, account, Decimal("1200.00"), NOW)
        assert reconcile(db_session, account, Decimal("1200.00"), NOW) is None

    def test_ignores_future_transactions_when_reconciling(self, db_session: Session) -> None:
        account = make_account(db_session, "1000.00")
        add_txn(db_session, account, "-400.00", when=NOW + timedelta(days=3))  # scheduled, not yet in bank

        adjustment = reconcile(db_session, account, Decimal("1000.00"), NOW)

        assert adjustment is None

    def test_archived_account_cannot_be_reconciled(self, db_session: Session) -> None:
        account = make_account(db_session)
        account.is_archived = True
        with pytest.raises(ArchivedAccountError):
            reconcile(db_session, account, Decimal("1.00"), NOW)
