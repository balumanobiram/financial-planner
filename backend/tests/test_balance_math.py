from decimal import Decimal

import pytest

from app.services.balances import ensure_money, reconciliation_difference


class TestReconciliationDifference:
    @pytest.mark.parametrize(
        ("current", "actual", "expected"),
        [
            ("10000.00", "10500.00", "500.00"),  # bank has more → positive adjustment
            ("10000.00", "9876.55", "-123.45"),  # bank has less → negative adjustment
            ("10000.00", "10000.00", "0.00"),  # already in sync
            ("-2500.00", "-2000.00", "500.00"),  # overdrawn account
            ("0.00", "0.01", "0.01"),  # smallest unit
            ("999999999999.98", "999999999999.99", "0.01"),  # max NUMERIC(14,2), no float drift
        ],
    )
    def test_difference(self, current: str, actual: str, expected: str) -> None:
        assert reconciliation_difference(Decimal(current), Decimal(actual)) == Decimal(expected)

    def test_rejects_sub_paise_input(self) -> None:
        with pytest.raises(ValueError, match="2 decimal places"):
            reconciliation_difference(Decimal("100.00"), Decimal("100.005"))


class TestEnsureMoney:
    @pytest.mark.parametrize("value", ["0", "1", "1.5", "1.50", "-42.10"])
    def test_accepts_up_to_two_places_and_normalises(self, value: str) -> None:
        result = ensure_money(Decimal(value))
        assert result == Decimal(value)
        assert result.as_tuple().exponent == -2

    @pytest.mark.parametrize("value", ["1.001", "NaN", "Infinity"])
    def test_rejects_invalid(self, value: str) -> None:
        with pytest.raises(ValueError):
            ensure_money(Decimal(value))
