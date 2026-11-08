from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BeforeValidator, Field

from app.services.logos import normalize_domain

# Request/response money: ≤ 14 digits, ≤ 2 decimal places (matches NUMERIC(14,2)).
# Pydantic serialises Decimal to a JSON *string* ("1234.50"), so no float ever reaches the client.


def _two_places(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))  # "1800" → 1800.00, so responses always read "1800.00"


MoneyAmount = Annotated[Decimal, Field(max_digits=14, decimal_places=2), AfterValidator(_two_places)]


def _blank_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


BlankToNone = BeforeValidator(_blank_to_none)


def _bank_domain(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = normalize_domain(value)
    if normalized is None:
        raise ValueError("Enter a website like hdfcbank.com")
    return normalized


# Bank website for the logo: "https://www.HDFCBank.com/x" → "hdfcbank.com"; blank → None (guessed from bank name).
BankDomain = Annotated[Annotated[str, Field(max_length=255)] | None, BlankToNone, AfterValidator(_bank_domain)]
