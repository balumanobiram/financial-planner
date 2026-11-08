"""Credit card API end to end on Neon dev (rolled back). "Today" is pinned and logo fetching is faked."""

import uuid
from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_logo_fetcher, get_today
from app.core.db import get_db
from tests.conftest import FakeFetcher, db_override

TODAY = date(2026, 10, 25)


@pytest.fixture
def api(app: FastAPI, db_session: Session, auth_headers: dict[str, str], fetcher: FakeFetcher) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = db_override(db_session)
    app.dependency_overrides[get_today] = lambda: TODAY
    app.dependency_overrides[get_logo_fetcher] = lambda: fetcher
    with TestClient(app, headers=auth_headers) as client:
        yield client
    app.dependency_overrides.clear()


NEW_CARD = {
    "bank_name": "HDFC Bank",
    "card_name": "Regalia Gold",
    "network": "mastercard",
    "last4": "4321",
    "credit_limit": "300000.00",
    "statement_day": 12,
    "payment_due_days": 20,
    "color": "#1A1A2E",
}


def create(api: TestClient, **overrides: Any) -> dict[str, Any]:
    response = api.post("/cards", json={**NEW_CARD, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


class TestCreate:
    def test_create_returns_billing_dates_and_logo(self, api: TestClient, fetcher: FakeFetcher) -> None:
        card = create(api)

        assert card["network"] == "mastercard"
        assert card["color"] == "#1a1a2e"  # normalised to lowercase
        assert card["credit_limit"] == "300000.00"
        assert card["bank_domain"] == "hdfcbank.com"  # guessed from the bank name
        assert card["logo_data_url"].startswith("data:image/png;base64,")
        assert fetcher.calls == ["hdfcbank.com"]
        assert card["billing"] == {
            "last_statement_date": "2026-10-12",
            "last_due_date": "2026-11-01",
            "next_statement_date": "2026-11-12",
            "next_due_date": "2026-12-02",
            "pay_by": "2026-11-01",
            "days_until_pay_by": 7,
        }

    def test_logo_is_fetched_once_per_bank(self, api: TestClient, fetcher: FakeFetcher) -> None:
        create(api)
        second = create(api, card_name="Millennia", network="visa")

        assert fetcher.calls == ["hdfcbank.com"]
        assert second["logo_data_url"] is not None

    def test_explicit_domain_is_cleaned(self, api: TestClient, fetcher: FakeFetcher) -> None:
        card = create(api, bank_name="My Bank", bank_domain="https://www.ICICIBank.com/cards")
        assert card["bank_domain"] == "icicibank.com"
        assert fetcher.calls == ["icicibank.com"]

    def test_unknown_bank_without_domain_has_no_logo(self, api: TestClient, fetcher: FakeFetcher) -> None:
        card = create(api, bank_name="Local Co-op")
        assert (card["bank_domain"], card["logo_data_url"]) == (None, None)
        assert fetcher.calls == []

    def test_failed_logo_fetch_still_creates_card(self, api: TestClient, fetcher: FakeFetcher) -> None:
        fetcher.result = None
        card = create(api)
        assert card["logo_data_url"] is None
        assert card["bank_domain"] == "hdfcbank.com"

    def test_minimal_card(self, api: TestClient) -> None:
        card = create(api, last4=None, credit_limit=None, color="#1f4fd1")
        assert card["last4"] is None and card["credit_limit"] is None


class TestValidation:
    def test_rejects_invalid_input(self, api: TestClient) -> None:
        cases = [
            {"statement_day": 0},
            {"statement_day": 32},
            {"payment_due_days": 0},
            {"payment_due_days": 61},
            {"color": "red"},
            {"color": "#12345"},
            {"last4": "12a4"},
            {"network": "discover"},
            {"bank_domain": "not a domain"},
            {"credit_limit": "0"},
            {"credit_limit": "-5000"},
            {"card_number": "4111111111111111"},  # extra fields are refused — never store full numbers
        ]
        for overrides in cases:
            assert api.post("/cards", json={**NEW_CARD, **overrides}).status_code == 422, overrides


class TestListAndUpdate:
    def test_list_sorted_by_pay_by_with_archived_last(self, api: TestClient) -> None:
        later = create(api, card_name="Later", statement_day=20, payment_due_days=20)  # pays 2026-11-09
        sooner = create(api, card_name="Sooner", statement_day=12, payment_due_days=15)  # pays 2026-10-27
        old = create(api, card_name="Old", statement_day=1, payment_due_days=15)
        api.post(f"/cards/{old['id']}/archive")

        active = api.get("/cards").json()["items"]
        everything = api.get("/cards", params={"include_archived": True}).json()["items"]

        assert [c["card_name"] for c in active] == ["Sooner", "Later"]
        assert [c["card_name"] for c in everything] == ["Sooner", "Later", "Old"]
        assert sooner["billing"]["pay_by"] == "2026-10-27"
        assert later["billing"]["pay_by"] == "2026-11-09"

    def test_patch_recomputes_billing(self, api: TestClient) -> None:
        card = create(api)
        updated = api.patch(f"/cards/{card['id']}", json={"statement_day": 31, "payment_due_days": 15}).json()
        # Statement on the 31st: last one was 30 Sep (30-day month), due 15 Oct → passed, so next cycle.
        assert updated["billing"]["last_statement_date"] == "2026-09-30"
        assert updated["billing"]["pay_by"] == "2026-11-15"

    def test_archived_card_is_read_only(self, api: TestClient) -> None:
        card = create(api)
        api.post(f"/cards/{card['id']}/archive")
        assert api.patch(f"/cards/{card['id']}", json={"card_name": "X"}).status_code == 409
        api.post(f"/cards/{card['id']}/unarchive")
        assert api.patch(f"/cards/{card['id']}", json={"card_name": "X"}).status_code == 200

    def test_changing_bank_fetches_new_logo(self, api: TestClient, fetcher: FakeFetcher) -> None:
        card = create(api)
        api.patch(f"/cards/{card['id']}", json={"bank_name": "Axis Bank", "bank_domain": None})
        assert fetcher.calls == ["hdfcbank.com", "axisbank.com"]

    def test_refresh_logo_refetches(self, api: TestClient, fetcher: FakeFetcher) -> None:
        card = create(api)
        fetcher.result = ("image/x-icon", b"new-logo")

        refreshed = api.post(f"/cards/{card['id']}/refresh-logo").json()

        assert fetcher.calls == ["hdfcbank.com", "hdfcbank.com"]
        assert refreshed["logo_data_url"].startswith("data:image/x-icon;base64,")

    def test_unknown_card_is_404(self, api: TestClient) -> None:
        assert api.get("/cards/00000000-0000-0000-0000-000000000000").status_code == 404


class TestOutstanding:
    def test_new_card_owes_nothing(self, api: TestClient) -> None:
        card = create(api)
        assert (card["outstanding"], card["available_credit"]) == ("0.00", "300000.00")

    def test_outstanding_and_available_credit_follow_spend_and_payment(self, api: TestClient, db_session: Session) -> None:
        from decimal import Decimal

        from app.services.transactions import create_card_payment

        card = create(api)
        account = api.post("/accounts", json={"bank_name": "HDFC Bank", "nickname": "Salary", "account_type": "salary",
                                              "opening_balance": "50000.00", "opening_date": "2026-01-01"}).json()
        person = api.post("/people", json={"name": "Arjun"}).json()
        api.post("/shared-expenses", json={"card_id": card["id"], "amount": "12000.00",
                                           "shares": [{"person_id": person["id"], "amount": "1000.00"}]})
        create_card_payment(db_session, from_account_id=uuid.UUID(account["id"]), card_id=uuid.UUID(card["id"]),
                            amount=Decimal("5000.00"), occurred_on=None, today=TODAY)

        refreshed = api.get(f"/cards/{card['id']}").json()

        assert refreshed["outstanding"] == "7000.00"
        assert refreshed["available_credit"] == "293000.00"

    def test_no_limit_means_no_available_credit(self, api: TestClient) -> None:
        assert create(api, credit_limit=None)["available_credit"] is None
