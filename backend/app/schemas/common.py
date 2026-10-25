from decimal import Decimal
from typing import Annotated

from pydantic import BeforeValidator, Field

# Request/response money: ≤ 14 digits, ≤ 2 decimal places (matches NUMERIC(14,2)).
# Pydantic serialises Decimal to a JSON *string* ("1234.50"), so no float ever reaches the client.
MoneyAmount = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]


def _blank_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


BlankToNone = BeforeValidator(_blank_to_none)
