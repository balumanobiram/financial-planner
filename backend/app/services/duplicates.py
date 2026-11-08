"""Duplicate detection for imports — pure functions, no database.

A statement row is a likely duplicate of an existing transaction on the same account/card when:
  same IST date + same signed amount + a similar description.
"Similar" is generous on purpose — bank text ("UPI/4729/SWIGGY BANGALORE/…") rarely matches what
you typed ("Swiggy") — because a false "possible duplicate" costs one tap, a missed one double-counts.
Transfers / card payments match on date + amount alone (their descriptions are usually empty).
Each existing transaction can match at most one row, so two real ₹40 coffees on the same day
in the file still import if only one was entered by hand.
"""

import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher

# Words every bank line contains; they say nothing about *what* the transaction was.
_NOISE = {
    "upi", "neft", "imps", "rtgs", "pos", "ach", "nach", "ecom", "txn", "ref", "the", "and", "for", "from",
    "payment", "transfer", "trf", "debit", "credit", "card", "bank", "india", "ltd", "pvt", "private", "limited",
}


@dataclass(frozen=True)
class Existing:
    id: uuid.UUID
    occurred_on: date  # IST calendar day
    amount: Decimal
    description: str | None
    kind: str


@dataclass(frozen=True)
class Candidate:
    """One parsed statement row (only rows that could be imported)."""

    key: int  # caller's row identifier
    occurred_on: date
    amount: Decimal
    description: str | None


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{3,}", text.lower()) if w not in _NOISE}


def _letters(text: str) -> str:
    return "".join(re.findall(r"[a-z]+", text.lower()))


def similar(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return True  # nothing to compare: date + amount on the same account is suspicious enough
    ta, tb = _tokens(a), _tokens(b)
    if ta and tb and len(ta & tb) / min(len(ta), len(tb)) >= 0.5:
        return True
    la, lb = _letters(a), _letters(b)
    short, long = sorted((la, lb), key=len)
    if len(short) >= 4 and short in long:  # "swiggy" inside "upiswiggybangalore"
        return True
    return bool(la and lb) and SequenceMatcher(None, la, lb).ratio() >= 0.75


def find_duplicates(rows: list[Candidate], existing: list[Existing]) -> dict[int, Existing]:
    """row key → the existing transaction it duplicates (one-to-one)."""
    pool: dict[tuple[date, Decimal], list[Existing]] = defaultdict(list)
    for e in existing:
        pool[(e.occurred_on, e.amount)].append(e)

    matches: dict[int, Existing] = {}
    for row in rows:
        candidates = pool.get((row.occurred_on, row.amount))
        if not candidates:
            continue
        for i, e in enumerate(candidates):
            if e.kind in ("transfer", "card_payment") or similar(row.description, e.description):
                matches[row.key] = candidates.pop(i)  # used up: can't match a second row
                break
    return matches
