import uuid
from decimal import Decimal

import pytest

from app.services.settlement_math import (
    OverpaymentError,
    PersonTotals,
    ShareStatus,
    allocate_settlements,
    check_settlement,
    check_split,
)

D = Decimal
A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


class TestPersonTotals:
    @pytest.mark.parametrize(
        ("shared", "settled", "outstanding"),
        [
            ("1500.00", "0.00", "1500.00"),
            ("1500.00", "600.50", "899.50"),
            ("1500.00", "1500.00", "0.00"),
            ("0.00", "0.00", "0.00"),
            ("200.00", "500.00", "-300.00"),  # an expense was deleted after they paid → you owe them
        ],
    )
    def test_outstanding(self, shared: str, settled: str, outstanding: str) -> None:
        totals = PersonTotals(shared_total=D(shared), settled_total=D(settled), received_total=D("5000.00"))
        assert totals.outstanding == D(outstanding)

    def test_income_does_not_reduce_what_they_owe(self) -> None:
        # Dad sending ₹5,000 is a gift, not repayment.
        totals = PersonTotals(shared_total=D("1000.00"), settled_total=D("0.00"), received_total=D("5000.00"))
        assert totals.outstanding == D("1000.00")


class TestAllocateSettlements:
    SHARES = [(A, D("500.00")), (B, D("300.00")), (C, D("200.00"))]  # oldest first

    def test_nothing_settled(self) -> None:
        result = allocate_settlements(self.SHARES, D("0.00"))
        assert [r.status for r in result] == [ShareStatus.OPEN] * 3
        assert [r.remaining for r in result] == [D("500.00"), D("300.00"), D("200.00")]

    def test_partial_pays_oldest_first(self) -> None:
        result = allocate_settlements(self.SHARES, D("650.00"))
        assert [r.status for r in result] == [ShareStatus.PAID, ShareStatus.PART_PAID, ShareStatus.OPEN]
        assert [r.settled for r in result] == [D("500.00"), D("150.00"), D("0.00")]
        assert result[1].remaining == D("150.00")

    def test_exact_boundary_marks_paid(self) -> None:
        result = allocate_settlements(self.SHARES, D("800.00"))
        assert [r.status for r in result] == [ShareStatus.PAID, ShareStatus.PAID, ShareStatus.OPEN]

    def test_everything_paid(self) -> None:
        result = allocate_settlements(self.SHARES, D("1000.00"))
        assert all(r.status is ShareStatus.PAID for r in result)
        assert sum((r.remaining for r in result), D("0")) == D("0.00")

    def test_extra_beyond_total_is_ignored(self) -> None:
        result = allocate_settlements(self.SHARES, D("1200.00"))
        assert all(r.status is ShareStatus.PAID for r in result)

    def test_paise_precision(self) -> None:
        result = allocate_settlements([(A, D("0.03")), (B, D("0.02"))], D("0.04"))
        assert [r.settled for r in result] == [D("0.03"), D("0.01")]

    def test_rejects_bad_input(self) -> None:
        with pytest.raises(ValueError):
            allocate_settlements(self.SHARES, D("-1.00"))
        with pytest.raises(ValueError):
            allocate_settlements([(A, D("0.00"))], D("0.00"))


class TestCheckSettlement:
    def test_partial_and_exact_allowed(self) -> None:
        check_settlement(D("900.00"), D("100.00"))
        check_settlement(D("900.00"), D("900.00"))

    def test_overpayment_refused_with_amount_owed(self) -> None:
        with pytest.raises(OverpaymentError, match="Only ₹900.00 is owed"):
            check_settlement(D("900.00"), D("900.01"))

    def test_nothing_owed(self) -> None:
        with pytest.raises(OverpaymentError, match="Nothing is owed"):
            check_settlement(D("0.00"), D("1.00"))

    def test_non_positive_refused(self) -> None:
        with pytest.raises(ValueError, match="positive"):
            check_settlement(D("900.00"), D("0.00"))


class TestCheckSplit:
    def test_full_and_partial_splits_allowed(self) -> None:
        check_split(D("1200.00"), [D("1200.00")])  # they owe all of it
        check_split(D("1200.00"), [D("400.00"), D("400.00")])  # three-way split, you pay a third

    @pytest.mark.parametrize(
        ("total", "shares", "message"),
        [
            ("1200.00", [D("700.00"), D("600.00")], "more than"),
            ("1200.00", [], "at least one"),
            ("1200.00", [D("0.00")], "positive"),
            ("0.00", [D("1.00")], "spent must be positive"),
        ],
    )
    def test_invalid_splits(self, total: str, shares: list[Decimal], message: str) -> None:
        with pytest.raises(ValueError, match=message):
            check_split(D(total), shares)
