"""Transfers and card payments keep both sides consistent (Neon dev, rolled back)."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AccountType, BankAccount, CardNetwork, Category, CreditCard, Transaction, TransactionKind
from app.services.balances import account_balance
from app.services.errors import ArchivedError, InvalidInputError
from app.services.transactions import (
    card_outstanding,
    counterpart,
    create_card_payment,
    create_transfer,
    delete_transaction,
    update_pair,
)

TODAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
D = Decimal


def account(session: Session, nickname: str, opening: str = "10000.00") -> BankAccount:
    a = BankAccount(bank_name="HDFC Bank", nickname=nickname, account_type=AccountType.SAVINGS,
                    opening_balance=D(opening), opening_date=date(2026, 1, 1))
    session.add(a)
    session.flush()
    return a


def card(session: Session) -> CreditCard:
    c = CreditCard(bank_name="HDFC Bank", card_name="Regalia", network=CardNetwork.VISA, statement_day=12, payment_due_days=20)
    session.add(c)
    session.flush()
    return c


def spend_on_card(session: Session, c: CreditCard, amount: str) -> None:
    session.add(Transaction(card=c, kind=TransactionKind.EXPENSE, amount=-D(amount), occurred_at=datetime(2026, 10, 1, tzinfo=UTC)))
    session.flush()


class TestTransfer:
    def test_moves_money_and_keeps_total_unchanged(self, db_session: Session) -> None:
        hdfc, icici = account(db_session, "HDFC"), account(db_session, "ICICI", "2000.00")

        out, into = create_transfer(db_session, from_account_id=hdfc.id, to_account_id=icici.id,
                                    amount=D("2500.00"), occurred_on=None, today=TODAY, description="Rent pot")

        assert (out.amount, into.amount) == (D("-2500.00"), D("2500.00"))
        assert out.link_id == into.link_id is not None
        assert out.kind is into.kind is TransactionKind.TRANSFER
        assert (out.direction, into.direction) == ("debit", "credit")
        assert account_balance(db_session, hdfc, NOW) == D("7500.00")
        assert account_balance(db_session, icici, NOW) == D("4500.00")
        assert account_balance(db_session, hdfc, NOW) + account_balance(db_session, icici, NOW) == D("12000.00")

    def test_counterpart_finds_the_other_side(self, db_session: Session) -> None:
        a, b = account(db_session, "A"), account(db_session, "B")
        out, into = create_transfer(db_session, from_account_id=a.id, to_account_id=b.id, amount=D("1.00"), occurred_on=None, today=TODAY)
        assert counterpart(db_session, out) is into
        assert counterpart(db_session, into) is out

    @pytest.mark.parametrize("amount", ["0.00", "-5.00"])
    def test_amount_must_be_positive(self, db_session: Session, amount: str) -> None:
        a, b = account(db_session, "A"), account(db_session, "B")
        with pytest.raises(InvalidInputError):
            create_transfer(db_session, from_account_id=a.id, to_account_id=b.id, amount=D(amount), occurred_on=None, today=TODAY)

    def test_same_account_refused(self, db_session: Session) -> None:
        a = account(db_session, "A")
        with pytest.raises(InvalidInputError, match="two different"):
            create_transfer(db_session, from_account_id=a.id, to_account_id=a.id, amount=D("1.00"), occurred_on=None, today=TODAY)

    def test_archived_target_writes_nothing(self, db_session: Session) -> None:
        a, b = account(db_session, "A"), account(db_session, "B")
        b.is_archived = True
        with pytest.raises(ArchivedError):
            create_transfer(db_session, from_account_id=a.id, to_account_id=b.id, amount=D("1.00"), occurred_on=None, today=TODAY)
        assert db_session.scalars(select(Transaction)).all() == []  # no half-written transfer

    def test_future_date_refused(self, db_session: Session) -> None:
        a, b = account(db_session, "A"), account(db_session, "B")
        with pytest.raises(InvalidInputError, match="future"):
            create_transfer(db_session, from_account_id=a.id, to_account_id=b.id, amount=D("1.00"),
                            occurred_on=date(2026, 10, 26), today=TODAY)


class TestCardPayment:
    def test_payment_reduces_bank_balance_and_card_outstanding(self, db_session: Session) -> None:
        bank, c = account(db_session, "Salary"), card(db_session)
        spend_on_card(db_session, c, "8000.00")
        assert card_outstanding(db_session, [c.id], NOW) == {c.id: D("8000.00")}

        out, into = create_card_payment(db_session, from_account_id=bank.id, card_id=c.id,
                                        amount=D("5000.00"), occurred_on=None, today=TODAY)

        assert (out.account_id, out.amount) == (bank.id, D("-5000.00"))
        assert (into.card_id, into.amount) == (c.id, D("5000.00"))
        assert account_balance(db_session, bank, NOW) == D("5000.00")
        assert card_outstanding(db_session, [c.id], NOW) == {c.id: D("3000.00")}

    def test_archived_card_writes_nothing(self, db_session: Session) -> None:
        bank, c = account(db_session, "Salary"), card(db_session)
        c.is_archived = True
        with pytest.raises(ArchivedError):
            create_card_payment(db_session, from_account_id=bank.id, card_id=c.id, amount=D("1.00"), occurred_on=None, today=TODAY)
        assert db_session.scalars(select(Transaction)).all() == []


class TestPairEditAndDelete:
    def test_editing_amount_changes_both_sides_with_correct_signs(self, db_session: Session) -> None:
        bank, c = account(db_session, "Salary"), card(db_session)
        out, _ = create_card_payment(db_session, from_account_id=bank.id, card_id=c.id, amount=D("5000.00"), occurred_on=None, today=TODAY)

        group = update_pair(db_session, out, amount=D("4200.00"), occurred_on=date(2026, 10, 20), today=TODAY,
                            description="Oct bill", set_description=True, tags=["bills"])

        assert sorted(r.amount for r in group) == [D("-4200.00"), D("4200.00")]
        assert {r.occurred_at for r in group} == {datetime(2026, 10, 19, 18, 30, tzinfo=UTC)}  # 20 Oct IST
        assert {r.description for r in group} == {"Oct bill"}
        assert all(r.tags == ["bills"] for r in group)
        assert account_balance(db_session, bank, NOW) == D("5800.00")

    def test_editing_from_either_side_works(self, db_session: Session) -> None:
        a, b = account(db_session, "A"), account(db_session, "B")
        _, into = create_transfer(db_session, from_account_id=a.id, to_account_id=b.id, amount=D("100.00"), occurred_on=None, today=TODAY)
        update_pair(db_session, into, amount=D("250.00"), today=TODAY)
        assert account_balance(db_session, a, NOW) == D("9750.00")
        assert account_balance(db_session, b, NOW) == D("10250.00")

    @pytest.mark.parametrize("side", [0, 1])
    def test_deleting_either_side_removes_both(self, db_session: Session, side: int) -> None:
        a, b = account(db_session, "A"), account(db_session, "B")
        pair = create_transfer(db_session, from_account_id=a.id, to_account_id=b.id, amount=D("700.00"), occurred_on=None, today=TODAY)

        assert delete_transaction(db_session, pair[side].id) == 2

        assert db_session.scalars(select(Transaction)).all() == []
        assert account_balance(db_session, a, NOW) == account_balance(db_session, b, NOW) == D("10000.00")

    def test_deleting_an_ordinary_transaction_removes_only_it(self, db_session: Session) -> None:
        c = card(db_session)
        spend_on_card(db_session, c, "100.00")
        spend_on_card(db_session, c, "200.00")
        first = db_session.scalars(select(Transaction)).first()
        assert first is not None
        assert delete_transaction(db_session, first.id) == 1
        assert len(db_session.scalars(select(Transaction)).all()) == 1


class TestDatabaseGuards:
    """The DB itself refuses shapes the service would never write — a second line of defence."""

    def test_transfer_without_link_is_rejected_by_postgres(self, db_session: Session) -> None:
        a = account(db_session, "A")
        nested = db_session.begin_nested()
        db_session.add(Transaction(account=a, kind=TransactionKind.TRANSFER, amount=D("-1.00"), occurred_at=NOW))
        with pytest.raises(IntegrityError, match="ck_transactions_paired_has_link"):
            db_session.flush()
        nested.rollback()

    def test_card_payment_kind_is_accepted(self, db_session: Session) -> None:
        bank, c = account(db_session, "Salary"), card(db_session)
        create_card_payment(db_session, from_account_id=bank.id, card_id=c.id, amount=D("1.00"), occurred_on=None, today=TODAY)
        kinds = db_session.scalars(text("select distinct kind from transactions")).all()
        assert kinds == ["card_payment"]


class TestCardOutstanding:
    def test_spend_refund_and_no_activity(self, db_session: Session) -> None:
        c1, c2 = card(db_session), card(db_session)
        spend_on_card(db_session, c1, "1500.00")
        db_session.add(Transaction(card=c1, kind=TransactionKind.EXPENSE, amount=D("300.00"),  # refund
                                   occurred_at=datetime(2026, 10, 2, tzinfo=UTC)))
        db_session.flush()

        result = card_outstanding(db_session, [c1.id, c2.id], NOW)

        assert result == {c1.id: D("1200.00"), c2.id: D("0.00")}
        assert str(result[c2.id]) == "0.00"  # not "-0.00"


class TestSeededCategories:
    def test_thirteen_defaults_in_order(self, db_session: Session) -> None:
        names = db_session.scalars(select(Category.name).where(Category.is_system).order_by(Category.sort_order)).all()
        assert names == ["Food", "Groceries", "Fuel", "Rent", "Utilities", "Shopping", "Travel",
                         "EMI", "Medical", "Entertainment", "Salary", "Family", "Other"]

    def test_names_are_unique_ignoring_case(self, db_session: Session) -> None:
        nested = db_session.begin_nested()
        db_session.add(Category(name="food", icon="Tag", color="#000000", kind="any"))
        with pytest.raises(IntegrityError, match="uq_categories_name_lower"):
            db_session.flush()
        nested.rollback()
