from decimal import Decimal

import pytest

from app.services.inr import format_inr


@pytest.mark.parametrize(
    ("amount", "kwargs", "expected"),
    [
        ("0", {}, "₹0.00"),
        ("999", {}, "₹999.00"),
        ("1000", {}, "₹1,000.00"),
        ("123456.5", {}, "₹1,23,456.50"),
        ("12345678.9", {}, "₹1,23,45,678.90"),
        ("-2450", {}, "-₹2,450.00"),
        ("90864.4", {"decimals": False}, "₹90,864"),
        ("0.5", {"decimals": False}, "₹1"),  # half rounds up, like a bank
        ("1500", {"signed": True}, "+₹1,500.00"),
        ("-1500", {"signed": True}, "-₹1,500.00"),
    ],
)
def test_format_inr(amount: str, kwargs: dict[str, bool], expected: str) -> None:
    assert format_inr(Decimal(amount), **kwargs) == expected
