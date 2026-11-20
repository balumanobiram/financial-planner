"""SMS inbox end to end: SMS arrive via /ingest, then get approved / ignored / bulk-approved.

"Today" is pinned to Fri 20 Nov 2026 (IST) so the October report is a finished, freezable month.
"""

from collections.abc import Iterator
from contextlib import nullcontext
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_logo_fetcher, get_now, get_session_factory, get_today
from app.core.db import get_db
from app.models import Category, MerchantRule, SmsMessage, Transaction
from tests.conftest import FakeFetcher, db_override

TODAY = date(2026, 11, 20)
NOW = datetime(2026, 11, 20, 16, 0, tzinfo=UTC)  # 21:30 IST


@pytest.fixture
def api(app: FastAPI, db_session: Session, auth_headers: dict[str, str], fetcher: FakeFetcher) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = db_override(db_session)
    app.dependency_overrides[get_session_factory] = lambda: (lambda: nullcontext(db_session))
    app.dependency_overrides[get_today] = lambda: TODAY
    app.dependency_overrides[get_now] = lambda: NOW
    app.dependency_overrides[get_logo_fetcher] = lambda: fetcher
    with TestClient(app, headers=auth_headers) as client:
        yield client
    app.dependency_overrides.clear()


def ok(response: Any, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json()


@pytest.fixture
def world(api: TestClient, db_session: Session) -> dict[str, Any]:
    account = ok(api.post("/accounts", json={"bank_name": "Axis Bank", "nickname": "Main", "account_type": "savings", "last4": "1234", "opening_balance": "10000.00", "opening_date": "2026-01-01"}), 201)
    card = ok(api.post("/cards", json={"bank_name": "Axis Bank", "card_name": "Ace", "network": "visa", "last4": "9876", "statement_day": 12, "payment_due_days": 20}), 201)
    ravi = ok(api.post("/people", json={"name": "Ravi"}), 201)
    asha = ok(api.post("/people", json={"name": "Asha"}), 201)
    categories = {c.name: str(c.id) for c in db_session.scalars(select(Category))}
    return {"account": account, "card": card, "ravi": ravi, "asha": asha, "cat": categories}


def sms(api: TestClient, text: str, received_at: str = "2026-11-20T21:00:00+05:30") -> dict[str, Any]:
    ok(api.post("/ingest", json={"text": text, "sender": "AX-TESTBK", "received_at": received_at}))
    items = ok(api.get("/inbox"))["items"]
    return next(i for i in items if i["text"] == text)


def balance(api: TestClient, account_id: str) -> str:
    return ok(api.get(f"/accounts/{account_id}"))["current_balance"]


def approve(api: TestClient, sms_id: str, body: dict[str, Any], code: int = 200) -> Any:
    return ok(api.post(f"/inbox/{sms_id}/approve", json=body), code)


class TestListing:
    def test_pending_newest_first_with_names_and_summary(self, api: TestClient, world: dict[str, Any]) -> None:
        sms(api, "Rs 100 debited from A/c XX1234", "2026-11-20T09:00:00+05:30")
        sms(api, "Rs 200 spent on card x9876 at CAFE", "2026-11-20T10:00:00+05:30")

        page = ok(api.get("/inbox"))

        assert [i["amount"] for i in page["items"]] == ["200.00", "100.00"]
        assert page["items"][0]["source"]["name"] == "Axis Bank · Ace"
        assert page["items"][0]["can_quick_approve"] is True
        assert page["pending_count"] == 2
        assert ok(api.get("/inbox/summary"))["pending_count"] == 2

    def test_inbox_needs_login(self, app: FastAPI) -> None:
        assert TestClient(app).get("/inbox").status_code == 401


class TestApprove:
    def test_expense_moves_balance_keeps_sms_time_and_learns_category(self, api: TestClient, world: dict[str, Any], db_session: Session) -> None:
        item = sms(api, "Rs 250 sent from A/c XX1234 to chai.point@okhdfc", "2026-11-20T08:15:00+05:30")
        before = balance(api, world["account"]["id"])

        [row] = approve(api, item["id"], {"as": "expense", "source": {"account_id": world["account"]["id"]}, "amount": "250", "category_id": world["cat"]["Food"]})["items"]

        assert row["amount"] == "-250.00" and row["category"]["name"] == "Food"
        assert row["occurred_at"].startswith("2026-11-20T02:45:00")  # 08:15 IST, not midnight
        assert balance(api, world["account"]["id"]) == f"{float(before) - 250:.2f}"
        assert db_session.scalar(select(Transaction.sms_message_id)) is not None
        assert db_session.scalar(select(MerchantRule.merchant_key)) == "chai.point@okhdfc"
        assert ok(api.get("/inbox"))["pending_count"] == 0

        next_one = sms(api, "Rs 90 sent from A/c XX1234 to chai.point@okhdfc", "2026-11-20T18:00:00+05:30")
        assert next_one["category"]["name"] == "Food"

    def test_split_with_several_people_counts_only_my_share(self, api: TestClient, world: dict[str, Any]) -> None:
        item = sms(api, "Rs 1,800 spent on card x9876 at TOIT")
        shares = [{"person_id": world["ravi"]["id"], "amount": "600"}, {"person_id": world["asha"]["id"], "amount": "600"}]

        [row] = approve(api, item["id"], {"as": "expense", "source": {"card_id": world["card"]["id"]}, "amount": "1800", "shares": shares})["items"]

        assert row["amount"] == "-1800.00" and len(row["shares"]) == 2
        people = {p["name"]: p["totals"]["outstanding"] for p in ok(api.get("/people"))["items"]}
        assert people == {"Asha": "600.00", "Ravi": "600.00"}
        assert ok(api.get("/cards"))["items"][0]["outstanding"] == "1800.00"  # the card moves by the full amount

    def test_split_across_categories_makes_one_row_each(self, api: TestClient, world: dict[str, Any]) -> None:
        item = sms(api, "Rs 1,000 spent on card x9876 at BIG BAZAAR")
        parts = [{"category_id": world["cat"]["Groceries"], "amount": "700"}, {"category_id": world["cat"]["Shopping"], "amount": "300"}]

        rows = approve(api, item["id"], {"as": "expense", "source": {"card_id": world["card"]["id"]}, "amount": "1000", "parts": parts})["items"]

        assert sorted((r["category"]["name"], r["amount"]) for r in rows) == [("Groceries", "-700.00"), ("Shopping", "-300.00")]

    def test_parts_must_add_up(self, api: TestClient, world: dict[str, Any]) -> None:
        item = sms(api, "Rs 1,000 spent on card x9876 at BIG BAZAAR")
        parts = [{"category_id": world["cat"]["Groceries"], "amount": "700"}, {"category_id": world["cat"]["Shopping"], "amount": "200"}]
        response = api.post(f"/inbox/{item['id']}/approve", json={"as": "expense", "source": {"card_id": world["card"]["id"]}, "amount": "1000", "parts": parts})
        assert response.status_code == 422 and "add up to 900.00" in response.text

    def test_card_bill_payment(self, api: TestClient, world: dict[str, Any]) -> None:
        item = sms(api, "Rs 5,000 paid from A/c XX1234 towards your credit card bill")
        assert item["suggested_kind"] == "card_payment"

        rows = approve(api, item["id"], {"as": "card_payment", "from_account_id": world["account"]["id"], "card_id": world["card"]["id"], "amount": "5000"})["items"]

        assert {r["type"] for r in rows} == {"card_payment"} and len(rows) == 2

    def test_repayment_from_a_friend(self, api: TestClient, world: dict[str, Any]) -> None:
        dinner = sms(api, "Rs 900 spent on card x9876 at TOIT")
        approve(api, dinner["id"], {"as": "expense", "source": {"card_id": world["card"]["id"]}, "amount": "900", "shares": [{"person_id": world["ravi"]["id"], "amount": "450"}]})
        money_in = sms(api, "Rs 450 received in A/c XX1234 from ravi@okaxis", "2026-11-20T21:20:00+05:30")

        [row] = approve(api, money_in["id"], {"as": "repayment", "person_id": world["ravi"]["id"], "account_id": world["account"]["id"], "amount": "450"})["items"]

        assert row["type"] == "settlement"
        ravi = next(p for p in ok(api.get("/people"))["items"] if p["name"] == "Ravi")
        assert ravi["totals"]["outstanding"] == "0.00"

    def test_cannot_approve_twice(self, api: TestClient, world: dict[str, Any]) -> None:
        item = sms(api, "Rs 100 debited from A/c XX1234")
        body = {"as": "expense", "source": {"account_id": world["account"]["id"]}, "amount": "100"}
        approve(api, item["id"], body)
        assert api.post(f"/inbox/{item['id']}/approve", json=body).status_code == 409


class TestIgnoreAndBulk:
    def test_ignore_then_restore(self, api: TestClient, world: dict[str, Any]) -> None:
        item = sms(api, "Rs 100 debited from A/c XX1234")
        assert ok(api.post(f"/inbox/{item['id']}/ignore"))["status"] == "ignored"
        assert ok(api.get("/inbox?status=ignored"))["items"][0]["id"] == item["id"]
        assert ok(api.post(f"/inbox/{item['id']}/restore"))["status"] == "pending"

    def test_rejected_can_be_restored(self, api: TestClient, world: dict[str, Any]) -> None:
        ok(api.post("/ingest", json={"text": "Reminder: Rs 999 debited from A/c XX1234"}))
        [item] = ok(api.get("/inbox?status=rejected"))["items"]
        assert ok(api.post(f"/inbox/{item['id']}/restore"))["status"] == "pending"

    def test_bulk_approves_only_unflagged(self, api: TestClient, world: dict[str, Any]) -> None:
        good = sms(api, "Rs 100 debited from A/c XX1234 at CAFE ONE", "2026-11-20T09:00:00+05:30")
        unknown_card = sms(api, "Rs 50 spent on card x5555 at SHOP", "2026-11-20T10:00:00+05:30")
        dup = sms(api, "Rs 100 spent using A/c XX1234 at CAFE ONE", "2026-11-20T09:05:00+05:30")

        result = ok(api.post("/inbox/bulk-approve", json={"ids": [good["id"], unknown_card["id"], dup["id"]]}))

        assert result == {"approved": 1, "skipped": 2}
        assert {i["id"] for i in ok(api.get("/inbox"))["items"]} == {unknown_card["id"], dup["id"]}


def test_approving_into_a_frozen_month_rebuilds_its_report(api: TestClient, world: dict[str, Any], db_session: Session) -> None:
    october = ok(api.get("/reports/monthly?month=2026-10"))  # first view freezes October
    assert october["summary"]["expenses"] == "0.00"
    item = sms(api, "Rs 300 debited from A/c XX1234 on 15-10-2026")

    approve(api, item["id"], {"as": "expense", "source": {"account_id": world["account"]["id"]}, "amount": "300", "occurred_on": "2026-10-15"})

    rebuilt = ok(api.get("/reports/monthly?month=2026-10"))
    assert rebuilt["from_snapshot"] is True and rebuilt["summary"]["expenses"] == "300.00"
    assert db_session.scalar(select(SmsMessage.status)).value == "approved"
