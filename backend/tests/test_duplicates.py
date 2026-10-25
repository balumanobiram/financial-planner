"""Duplicate detection: pure functions, no database (fast)."""

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.services.duplicates import Candidate, Existing, find_duplicates, similar

D = date(2026, 10, 1)


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("UPI-SWIGGY-swiggy@icici-4729", "Swiggy", True),  # what the bank says vs what you typed
        ("POS 4321 AMAZON PAY INDIA", "amazon order", True),
        ("NEFT CR-ACME CORP-SALARY OCT", "Salary", True),
        ("Uber trip", "Ubr trip", True),  # fuzzy
        ("UPI-ZOMATO-zomato@hdfc", "Swiggy", False),
        ("UPI-RAVI KUMAR-ok", "Petrol", False),
        ("UPI/NEFT payment", "IMPS transfer", False),  # only bank noise words in common
        (None, "anything", True),  # nothing to compare: date + amount match is enough to ask
        ("", "anything", True),
    ],
)
def test_similar(a: str | None, b: str | None, expected: bool) -> None:
    assert similar(a, b) is expected


def existing(amount: str, description: str | None, kind: str = "expense", day: date = D) -> Existing:
    return Existing(uuid.uuid4(), day, Decimal(amount), description, kind)


def row(key: int, amount: str, description: str | None, day: date = D) -> Candidate:
    return Candidate(key, day, Decimal(amount), description)


def test_needs_same_date_amount_and_sign() -> None:
    e = existing("-450.00", "Swiggy")
    assert find_duplicates([row(1, "-450.00", "SWIGGY")], [e]) == {1: e}
    assert find_duplicates([row(1, "-450.00", "SWIGGY", day=date(2026, 10, 2))], [e]) == {}
    assert find_duplicates([row(1, "-451.00", "SWIGGY")], [e]) == {}
    assert find_duplicates([row(1, "450.00", "SWIGGY")], [e]) == {}  # a refund isn't the spend


def test_one_existing_matches_only_one_row() -> None:
    """Two real ₹40 coffees in the file; you logged one by hand → only one is a duplicate."""
    e = existing("-40.00", "coffee")
    assert find_duplicates([row(1, "-40.00", "UPI-COFFEE DAY"), row(2, "-40.00", "UPI-COFFEE DAY")], [e]) == {1: e}


def test_each_row_takes_a_different_existing() -> None:
    a, b = existing("-40.00", "coffee"), existing("-40.00", "Coffee Day")
    assert find_duplicates([row(1, "-40.00", "COFFEE DAY"), row(2, "-40.00", "COFFEE DAY")], [a, b]) == {1: a, 2: b}


def test_dissimilar_description_is_not_a_duplicate() -> None:
    assert find_duplicates([row(1, "-450.00", "UPI-ZOMATO")], [existing("-450.00", "Swiggy")]) == {}


def test_transfers_and_card_payments_match_on_date_and_amount() -> None:
    payment = existing("18000.00", None, kind="card_payment")
    transfer = existing("-5000.00", "Emergency fund", kind="transfer")
    rows = [row(1, "18000.00", "PAYMENT RECEIVED - THANK YOU"), row(2, "-5000.00", "IMPS-SELF-ICICI")]
    assert find_duplicates(rows, [payment, transfer]) == {1: payment, 2: transfer}
