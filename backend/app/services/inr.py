"""Indian money formatting for server-rendered text (PDF, insight sentences).

The browser has Intl for this; Python's locale module depends on the OS, so it's done by hand:
the last three digits, then groups of two — 1,23,45,678.90.
"""

from decimal import ROUND_HALF_UP, Decimal


def group_indian(digits: str) -> str:
    """"12345678" → "1,23,45,678"."""
    head, tail = digits[:-3], digits[-3:]
    if not head:
        return tail
    pairs = []
    while len(head) > 2:
        pairs.insert(0, head[-2:])
        head = head[:-2]
    return ",".join([head, *pairs, tail])


def format_inr(amount: Decimal, *, decimals: bool = True, signed: bool = False) -> str:
    """Decimal("-123456.5") → "-₹1,23,456.50"; decimals=False rounds to whole rupees; signed adds "+"."""
    value = amount.quantize(Decimal("0.01") if decimals else Decimal("1"), rounding=ROUND_HALF_UP)
    sign = "-" if value < 0 else "+" if signed and value > 0 else ""
    rupees, _, paise = f"{abs(value):f}".partition(".")
    return f"{sign}₹{group_indian(rupees)}" + (f".{paise}" if decimals else "")
