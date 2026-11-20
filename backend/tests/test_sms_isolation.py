"""Inbox SMS never count until approved.

Every total (balances, card dues, dashboard, reports, people, the transaction list) reads only
the transactions table, and an SMS only becomes transactions on approve. This test pins that
down: add SMS in every status, matched to a real account and card, and nothing may move.
"""

import hashlib
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import SmsMessage, SmsStatus, TransactionKind

# Responses that carry "when was this built" rather than money.
VOLATILE = {"generated_at"}


def strip(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip(v) for k, v in value.items() if k not in VOLATILE}
    if isinstance(value, list):
        return [strip(v) for v in value]
    return value


def ok(response: Any) -> Any:
    assert response.status_code == 200, response.text
    return strip(response.json())


def everything(api: TestClient, month: str) -> dict[str, Any]:
    return {
        "accounts": ok(api.get("/accounts")),
        "cards": ok(api.get("/cards")),
        "people": ok(api.get("/people")),
        "transactions": ok(api.get("/transactions")),
        "dashboard": ok(api.get("/dashboard/summary")),
        "report": ok(api.get(f"/reports/monthly?month={month}")),
    }


def sms(status: SmsStatus, amount: str, *, account_id: str | None = None, card_id: str | None = None, is_debit: bool = True) -> SmsMessage:
    text = f"{status} {amount} {account_id} {card_id} {is_debit}"
    now = datetime.now(UTC)
    return SmsMessage(
        sender="AX-TESTBK",
        text=text,
        received_at=now,
        text_hash=hashlib.sha256(text.encode()).hexdigest(),
        status=status,
        parsed_at=now,
        amount=Decimal(amount),
        is_debit=is_debit,
        suggested_kind=TransactionKind.EXPENSE if is_debit else TransactionKind.INCOME,
        occurred_at=now,
        account_id=account_id,
        card_id=card_id,
    )


def test_inbox_sms_change_no_total(api: TestClient, db_session: Session) -> None:
    account = api.post(
        "/accounts",
        json={"bank_name": "Axis Bank", "nickname": "Main", "account_type": "savings", "opening_balance": "10000.00", "opening_date": "2026-01-01"},
    ).json()
    card = api.post(
        "/cards",
        json={"bank_name": "Axis Bank", "card_name": "Ace", "network": "visa", "statement_day": 12, "payment_due_days": 20},
    ).json()
    api.post("/people", json={"name": "Ravi"})
    spent = api.post("/transactions", json={"type": "expense", "source": {"account_id": account["id"]}, "amount": "250.00", "description": "Lunch"})
    assert spent.status_code == 201, spent.text

    month = datetime.now(UTC).strftime("%Y-%m")
    before = everything(api, month)

    db_session.add_all(
        [
            sms(status, amount, account_id=account["id"], is_debit=debit)
            for status in SmsStatus
            for amount, debit in [("999.00", True), ("5000.00", False)]
        ]
        + [sms(SmsStatus.PENDING, "1234.00", card_id=card["id"])]
    )
    db_session.flush()

    assert everything(api, month) == before

    # Sanity check: the comparison does notice real money (so the assert above means something).
    api.post("/transactions", json={"type": "expense", "source": {"card_id": card["id"]}, "amount": "1.00"})
    after = everything(api, month)
    assert {key for key in before if after[key] != before[key]} == {"cards", "transactions", "dashboard", "report"}
