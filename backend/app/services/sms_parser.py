"""Bank / UPI / card SMS → structured fields. Plain keyword and regex rules — no AI, no database.

The generic parser below handles the common wording. Bank-specific parsers can be added to
BANK_PARSERS later (keyed by a sender fragment, e.g. "AXISBK") from real, masked samples —
we don't guess formats we haven't seen.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import StrEnum

# Every keyword the parser reacts to, in one place. Matched as whole words, case-insensitive.
KEYWORDS: dict[str, list[str]] = {
    # Money left your account / card.
    "debit": ["debited", "sent", "spent", "used", "paid", "withdrawn", "purchase", "deducted", "dr"],
    # Money arrived.
    "credit": ["credited", "received", "deposited", "refund", "refunded", "cr"],
    # No money moved — a UPI request or a future debit. Checked first.
    "reject": ["collect request", "requested", "request", "will be debited", "reminder"],
    # A bill or due-date notice ("due" alone is checked after the card-payment rule).
    "reject_due": ["due"],
    # "received"/"paid" + one of these = paying a credit-card bill, not income/expense.
    "card_bill": ["credit card", "card bill", "card payment", "towards your card", "towards card"],
    # Never stored at all.
    "otp": ["otp", "one time password", "one-time password"],
}


class Direction(StrEnum):
    DEBIT = "debit"
    CREDIT = "credit"


@dataclass(frozen=True)
class ParsedSms:
    """What we could read. Anything None is left for you to fill in on approve."""

    rejected_reason: str | None = None  # set → no money moved; nothing else matters
    amount: Decimal | None = None  # positive
    direction: Direction | None = None
    is_card_payment: bool = False
    merchant: str | None = None  # shop name or UPI ID
    upi_ref: str | None = None
    last4: str | None = None
    on_date: date | None = None
    unsure: list[str] | None = None  # reasons to review it by hand

    @property
    def needs_review(self) -> bool:
        return bool(self.unsure)


def _phrase(words: list[str]) -> re.Pattern[str]:
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(w) for w in words) + r")(?![a-z0-9])", re.I)


_RE = {name: _phrase(words) for name, words in KEYWORDS.items()}

# "Rs 1,250.50", "Rs.500", "INR 99", "₹ 10,000". The (?<![a-z]) stops "hrs 5" matching "rs 5".
_AMOUNT = re.compile(r"(?<![a-z])(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", re.I)
# Amounts right after these words are balances or limits, not the transaction.
_NOT_TXN_AMOUNT = re.compile(r"(?:bal(?:ance)?|lmt|limit|avl|available)[\s.:a-z]{0,12}$", re.I)

_VPA = re.compile(r"\b([a-z0-9][a-z0-9.\-_]{1,60}@[a-z][a-z0-9]{1,30})\b", re.I)
_UPI_REF = re.compile(
    r"(?:upi\s*ref(?:erence)?|ref(?:erence)?|rrn|utr|txn\s*id)\s*(?:no\.?|number|#)?\s*[:.\-]?\s*([0-9]{9,18})\b", re.I
)
# "A/c XX1234", "Card x1234", "card ending 1234", "a/c no. XXXXXX1234", "**1234"
_LAST4 = re.compile(
    r"(?:a/c|acct|account|card|ac)\s*(?:no\.?|number)?\s*(?:ending\s*(?:with|in)?\s*)?[x*.\s]*([0-9]{4})\b"
    r"|[x*]{2,}([0-9]{4})\b",
    re.I,
)
# Merchant after at / to / from / towards / info, until a word that ends it.
_MERCHANT = re.compile(
    r"\b(?:at|to|from|towards|info[:\s])\s*([a-z0-9][a-z0-9&'._\- ]{1,40}?)"
    r"(?=\s+(?:on|ref|upi|via|avl|for|using|with|by|thru|through|is|has|was)\b|[.,;:(]|\s*$)",
    re.I,
)
_NOT_MERCHANT = re.compile(r"\b(?:a/c|acct|account|card|your|xx|bank a/c|beneficiary)\b|[x*]{2,}", re.I)

# 20-11-26, 20/11/2026, 20.11.2026, 20-Nov-26, 20 Nov 2026, 2026-11-20
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_DATE_DMY = re.compile(r"\b([0-3]?[0-9])[-/.]([01]?[0-9])[-/.]([0-9]{2}|[0-9]{4})\b")
_DATE_DMONY = re.compile(r"\b([0-3]?[0-9])[-\s]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s,]*([0-9]{2}|[0-9]{4})\b", re.I)
_DATE_YMD = re.compile(r"\b(20[0-9]{2})-([01][0-9])-([0-3][0-9])\b")

# Full card numbers (13–19 digits, optionally grouped) → keep the last 4. 12-digit UPI refs are left alone.
_CARD_NUMBER = re.compile(r"(?<![0-9])(?:[0-9][ -]?){12,18}[0-9](?![0-9])")


def is_otp(text: str) -> bool:
    return bool(_RE["otp"].search(text))


def mask_card_numbers(text: str) -> str:
    def mask(match: re.Match[str]) -> str:
        digits = re.sub(r"[ -]", "", match.group(0))
        return "X" * (len(digits) - 4) + digits[-4:] if 13 <= len(digits) <= 19 else match.group(0)

    return _CARD_NUMBER.sub(mask, text)


def _amount(text: str) -> Decimal | None:
    for match in _AMOUNT.finditer(text):
        if _NOT_TXN_AMOUNT.search(text[: match.start()]):
            continue
        try:
            value = Decimal(match.group(1).replace(",", ""))
        except InvalidOperation:
            continue
        if value > 0:
            return value.quantize(Decimal("0.01"))
    return None


def _direction(text: str) -> tuple[Direction | None, bool]:
    """Earliest debit/credit word wins ("debited from your a/c … credited to the shop" is a debit).
    Returns (direction, both_kinds_present)."""
    debit, credit = _RE["debit"].search(text), _RE["credit"].search(text)
    if debit and credit:
        return (Direction.DEBIT if debit.start() < credit.start() else Direction.CREDIT), True
    if debit:
        return Direction.DEBIT, False
    if credit:
        return Direction.CREDIT, False
    return None, False


def _merchant(text: str) -> str | None:
    if vpa := _VPA.search(text):
        return vpa.group(1).lower()
    for match in _MERCHANT.finditer(text):
        name = match.group(1).strip(" .-_")
        if len(name) >= 2 and not _NOT_MERCHANT.search(name) and not name.replace(" ", "").isdigit():
            return name
    return None


def _last4(text: str) -> str | None:
    match = _LAST4.search(text)
    return (match.group(1) or match.group(2)) if match else None


def _year(raw: str) -> int:
    return int(raw) + 2000 if len(raw) == 2 else int(raw)


def _on_date(text: str) -> date | None:
    candidates: list[tuple[int, int, int]] = []
    if m := _DATE_YMD.search(text):
        candidates.append((int(m.group(1)), int(m.group(2)), int(m.group(3))))
    if m := _DATE_DMONY.search(text):
        candidates.append((_year(m.group(3)), _MONTHS[m.group(2).lower()[:3]], int(m.group(1))))
    if m := _DATE_DMY.search(text):
        candidates.append((_year(m.group(3)), int(m.group(2)), int(m.group(1))))  # Indian order: day first
    for year, month, day in candidates:
        try:
            return date(year, month, day)
        except ValueError:
            continue
    return None


def parse_generic(text: str) -> ParsedSms:
    if found := _RE["reject"].search(text):
        return ParsedSms(rejected_reason=f"No money moved (“{found.group(1).lower()}”)")

    card_bill = bool(_RE["card_bill"].search(text))
    direction, mixed = _direction(text)
    is_card_payment = card_bill and direction is not None
    if not is_card_payment and (found := _RE["reject_due"].search(text)):
        return ParsedSms(rejected_reason=f"No money moved (“{found.group(1).lower()}”)")

    amount = _amount(text)
    unsure: list[str] = []
    if amount is None:
        unsure.append("Couldn't find the amount")
    if direction is None:
        unsure.append("Couldn't tell if money went out or came in")
    elif mixed and not is_card_payment:
        unsure.append("Mentions both money out and money in — check the direction")

    return ParsedSms(
        amount=amount,
        direction=direction,
        is_card_payment=is_card_payment,
        merchant=_merchant(text),
        upi_ref=(m.group(1) if (m := _UPI_REF.search(text)) else None),
        last4=_last4(text),
        on_date=_on_date(text),
        unsure=unsure or None,
    )


# Bank-specific parsers, matched by a fragment of the sender ID (e.g. "AX-AXISBK-S" contains "AXISBK").
# Each gets the generic result and may correct it. Empty until we have real (masked) samples.
BANK_PARSERS: dict[str, Callable[[str, ParsedSms], ParsedSms]] = {}


def parse(text: str, sender: str) -> ParsedSms:
    result = parse_generic(text)
    for fragment, bank_parser in BANK_PARSERS.items():
        if fragment.lower() in sender.lower():
            return bank_parser(text, result)
    return result


def with_unsure(parsed: ParsedSms, reason: str) -> ParsedSms:
    return replace(parsed, unsure=[*(parsed.unsure or []), reason])


def plausible_date(on_date: date | None, today: date) -> date | None:
    """Keep a date read from the SMS only if it's believable (not in the future, not over a year old)."""
    if on_date is None or on_date > today or (today - on_date).days > 400:
        return None
    return on_date
