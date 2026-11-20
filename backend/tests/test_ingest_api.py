"""POST /ingest end to end: store fast, parse in the background, dedupe, never count.

TestClient runs background tasks right after the response, inside the same call, so by the
time api.post() returns the SMS has been parsed (using the test session — see the fixture).
"""

from collections.abc import Iterator
from contextlib import nullcontext
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_session_factory
from app.core.db import get_db
from app.models import Category, MerchantRule, SmsMessage, SmsStatus
from tests.conftest import db_override

RECEIVED = "2026-11-20T21:15:00+05:30"


@pytest.fixture
def public(app: FastAPI, db_session: Session) -> Iterator[TestClient]:
    """No login headers: /ingest is public."""
    app.dependency_overrides[get_db] = db_override(db_session)
    app.dependency_overrides[get_session_factory] = lambda: (lambda: nullcontext(db_session))
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def send(public: TestClient, text: str, *, sender: str = "AX-TESTBK", received_at: Any = RECEIVED) -> Any:
    response = public.post("/ingest", json={"text": text, "sender": sender, "received_at": received_at})
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}
    return response


def stored(db: Session) -> list[SmsMessage]:
    return list(db.scalars(select(SmsMessage).order_by(SmsMessage.received_at, SmsMessage.created_at)))


def add_account(db: Session, last4: str) -> Any:
    from app.models import BankAccount

    account = BankAccount(bank_name="Test Bank", nickname="Main", account_type="savings", last4=last4, opening_balance=0, opening_date="2026-01-01")
    db.add(account)
    db.flush()
    return account


class TestStoreAndParse:
    def test_parses_and_matches_account(self, public: TestClient, db_session: Session) -> None:
        account = add_account(db_session, "1234")

        send(public, "Rs 250.00 sent from A/c XX1234 to chai.point@okhdfc. UPI Ref No 512345678901")

        [sms] = stored(db_session)
        assert sms.status is SmsStatus.PENDING and sms.parsed_at is not None
        assert (str(sms.amount), sms.is_debit, sms.suggested_kind.value) == ("250.00", True, "expense")
        assert (sms.merchant, sms.upi_ref, sms.account_id) == ("chai.point@okhdfc", "512345678901", account.id)
        assert not sms.needs_review
        assert sms.received_at.isoformat() == "2026-11-20T15:45:00+00:00"  # stored in UTC

    def test_unknown_card_needs_review(self, public: TestClient, db_session: Session) -> None:
        send(public, "Rs 99 spent on card x5555 at SOME SHOP")
        [sms] = stored(db_session)
        assert sms.needs_review and sms.note == "No account or card ending 5555"

    def test_request_is_kept_but_rejected(self, public: TestClient, db_session: Session) -> None:
        send(public, "friend@ybl has requested Rs 500 from you")
        [sms] = stored(db_session)
        assert sms.status is SmsStatus.REJECTED and sms.amount is None

    def test_otp_is_not_stored(self, public: TestClient, db_session: Session) -> None:
        send(public, "123456 is your OTP for a payment of Rs 500")
        assert stored(db_session) == []

    def test_full_card_number_is_masked_before_saving(self, public: TestClient, db_session: Session) -> None:
        send(public, "Rs 10 spent on card 4111111111111234")
        assert stored(db_session)[0].text == "Rs 10 spent on card XXXXXXXXXXXX1234"

    def test_merchant_rule_suggests_category(self, public: TestClient, db_session: Session) -> None:
        food = db_session.scalar(select(Category).where(Category.name == "Food"))
        assert food is not None
        db_session.add(MerchantRule(merchant_key="chai.point@okhdfc", category_id=food.id))
        db_session.flush()

        send(public, "Rs 80 paid from A/c XX1234 to Chai.Point@okhdfc")

        assert stored(db_session)[0].category_id == food.id

    @pytest.mark.parametrize("received_at", [None, "yesterday-ish", "2099-01-01T00:00:00Z"])
    def test_odd_received_at_falls_back_to_now(self, public: TestClient, db_session: Session, received_at: Any) -> None:
        send(public, "Rs 10 debited from A/c XX1234", received_at=received_at)
        assert stored(db_session)[0].received_at.year < 2099


class TestDuplicates:
    def test_exact_repeat_in_the_same_minute_is_stored_once(self, public: TestClient, db_session: Session) -> None:
        text = "Rs 10 debited from A/c XX1234"
        send(public, text, received_at="2026-11-20T21:15:05+05:30")
        send(public, text, received_at="2026-11-20T21:15:40+05:30")  # still answers ok
        assert len(stored(db_session)) == 1

    def test_same_upi_ref_is_ignored_not_deleted(self, public: TestClient, db_session: Session) -> None:
        send(public, "Rs 250 sent from A/c XX1234. UPI Ref 512345678901")
        send(public, "You paid Rs 250 to shop@okaxis. UPI Ref 512345678901", received_at="2026-11-20T21:16:00+05:30")
        first, second = stored(db_session)
        assert first.status is SmsStatus.PENDING
        assert second.status is SmsStatus.IGNORED and "same UPI reference" in (second.note or "")

    def test_same_amount_last4_within_10_minutes_is_flagged(self, public: TestClient, db_session: Session) -> None:
        add_account(db_session, "1234")
        send(public, "Rs 700 debited from A/c XX1234 at CAFE ONE", received_at="2026-11-20T21:00:00+05:30")
        send(public, "Rs 700 spent using A/c XX1234 at CAFE ONE", received_at="2026-11-20T21:08:00+05:30")
        send(public, "Rs 700 spent using A/c XX1234 at CAFE TWO", received_at="2026-11-20T21:30:00+05:30")
        first, second, third = stored(db_session)
        assert not first.needs_review
        assert second.needs_review and second.duplicate_of_sms_id == first.id
        assert third.duplicate_of_sms_id is None  # 30 minutes later: a different payment

    def test_matching_existing_transaction_is_flagged(self, public: TestClient, db_session: Session) -> None:
        from datetime import datetime

        from app.models import Transaction, TransactionKind

        account = add_account(db_session, "1234")
        db_session.add(
            Transaction(account_id=account.id, kind=TransactionKind.EXPENSE, amount=-300, occurred_at=datetime.fromisoformat("2026-11-20T21:05:00+05:30"))
        )
        db_session.flush()

        send(public, "Rs 300 debited from A/c XX1234", received_at="2026-11-20T21:10:00+05:30")

        assert stored(db_session)[0].duplicate_of_transaction_id is not None


class TestLimits:
    def test_text_over_1000_chars_is_rejected_without_echoing_it(self, public: TestClient) -> None:
        response = public.post("/ingest", json={"text": "S" * 1001})
        assert response.status_code == 422
        assert "SSSS" not in response.text

    def test_body_over_4kb_is_rejected(self, public: TestClient) -> None:
        response = public.post("/ingest", content=b'{"text": "' + b"x" * 5000 + b'"}', headers={"Content-Type": "application/json"})
        assert response.status_code == 413

    def test_cannot_read_or_change_anything(self, public: TestClient) -> None:
        for method in ("GET", "PUT", "PATCH", "DELETE"):
            assert public.request(method, "/ingest").status_code == 405
        assert public.get("/inbox").status_code in (401, 404)

    def test_health_stays_instant(self, public: TestClient) -> None:
        assert public.get("/health").json() == {"status": "ok"}
