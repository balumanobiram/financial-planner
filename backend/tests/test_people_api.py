"""People, shared expenses and settlements end to end (Neon dev, rolled back). "Today" is pinned."""

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


def post(api: TestClient, path: str, body: dict[str, Any], expected: int = 201) -> dict[str, Any]:
    response = api.post(path, json=body)
    assert response.status_code == expected, response.text
    return response.json() if response.content else {}


@pytest.fixture
def account(api: TestClient) -> dict[str, Any]:
    return post(api, "/accounts", {
        "bank_name": "HDFC Bank", "nickname": "Salary", "account_type": "salary",
        "opening_balance": "10000.00", "opening_date": "2026-01-01",
    })


@pytest.fixture
def card(api: TestClient) -> dict[str, Any]:
    return post(api, "/cards", {
        "bank_name": "HDFC Bank", "card_name": "Regalia", "network": "visa", "statement_day": 12, "payment_due_days": 20,
    })


def person(api: TestClient, name: str = "Arjun", relation: str | None = "Friend") -> dict[str, Any]:
    return post(api, "/people", {"name": name, "relation": relation})


def totals(api: TestClient, person_id: str) -> dict[str, str]:
    return api.get(f"/people/{person_id}").json()["totals"]


def balance(api: TestClient, account_id: str) -> str:
    return api.get(f"/accounts/{account_id}").json()["current_balance"]


class TestPeopleCrud:
    def test_new_person_owes_nothing(self, api: TestClient) -> None:
        p = person(api)
        assert p["totals"] == {"shared_total": "0.00", "settled_total": "0.00", "outstanding": "0.00", "received_total": "0.00"}

    def test_validation(self, api: TestClient) -> None:
        assert api.post("/people", json={"name": ""}).status_code == 422
        assert api.post("/people", json={"name": "X", "relation": "r" * 51}).status_code == 422

    def test_archived_person_is_read_only_but_still_viewable(self, api: TestClient, account: dict[str, Any]) -> None:
        p = person(api)
        api.post(f"/people/{p['id']}/archive")
        assert api.patch(f"/people/{p['id']}", json={"name": "Y"}).status_code == 409
        post(api, f"/people/{p['id']}/income", {"account_id": account["id"], "amount": "1.00"}, expected=409)
        assert api.get(f"/people/{p['id']}").status_code == 200


class TestIncomeFromPerson:
    def test_income_goes_into_account_and_counts_as_received(self, api: TestClient, account: dict[str, Any]) -> None:
        dad = person(api, "Dad", "Father")

        txn = post(api, f"/people/{dad['id']}/income", {"account_id": account["id"], "amount": "5000.00", "description": "Pocket money"})

        assert txn["kind"] == "income" and txn["amount"] == "5000.00" and txn["person_id"] == dad["id"]
        assert balance(api, account["id"]) == "15000.00"
        assert totals(api, dad["id"]) == {"shared_total": "0.00", "settled_total": "0.00", "outstanding": "0.00", "received_total": "5000.00"}

    def test_future_date_refused(self, api: TestClient, account: dict[str, Any]) -> None:
        dad = person(api, "Dad")
        post(api, f"/people/{dad['id']}/income", {"account_id": account["id"], "amount": "1.00", "occurred_on": "2026-10-26"}, expected=422)


class TestSharedExpenses:
    def test_card_spend_split_two_ways(self, api: TestClient, card: dict[str, Any], account: dict[str, Any]) -> None:
        arjun, priya = person(api, "Arjun"), person(api, "Priya")

        txn = post(api, "/shared-expenses", {
            "card_id": card["id"], "amount": "1800.00", "description": "Dinner",
            "shares": [{"person_id": arjun["id"], "amount": "600.00"}, {"person_id": priya["id"], "amount": "600.00"}],
        })

        assert txn["kind"] == "expense" and txn["amount"] == "-1800.00" and txn["card_id"] == card["id"]
        assert totals(api, arjun["id"])["outstanding"] == "600.00"
        assert totals(api, priya["id"])["outstanding"] == "600.00"
        assert balance(api, account["id"]) == "10000.00"  # card spend doesn't touch bank balances

    def test_bank_spend_owed_in_full(self, api: TestClient, account: dict[str, Any]) -> None:
        mom = person(api, "Mom", "Mother")
        post(api, "/shared-expenses", {"account_id": account["id"], "amount": "2500.00",
                                       "shares": [{"person_id": mom["id"], "amount": "2500.00"}]})
        assert balance(api, account["id"]) == "7500.00"
        assert totals(api, mom["id"])["outstanding"] == "2500.00"

    @pytest.mark.parametrize(
        "change",
        [
            {"shares": []},  # nobody
            {"shares": "TOO_MUCH"},  # shares exceed spend
            {"card_id": None, "account_id": None},  # no source
            {"shares": "DUPLICATE"},  # same person twice
            {"amount": "0"},
        ],
    )
    def test_invalid_splits(self, api: TestClient, card: dict[str, Any], change: dict[str, Any]) -> None:
        arjun = person(api)
        body: dict[str, Any] = {"card_id": card["id"], "amount": "1000.00", "shares": [{"person_id": arjun["id"], "amount": "400.00"}]}
        if change.get("shares") == "TOO_MUCH":
            body["shares"] = [{"person_id": arjun["id"], "amount": "1000.01"}]
        elif change.get("shares") == "DUPLICATE":
            body["shares"] = [{"person_id": arjun["id"], "amount": "100.00"}] * 2
        else:
            body.update(change)
        assert api.post("/shared-expenses", json=body).status_code == 422, change

    def test_both_sources_refused(self, api: TestClient, card: dict[str, Any], account: dict[str, Any]) -> None:
        arjun = person(api)
        body = {"card_id": card["id"], "account_id": account["id"], "amount": "10.00", "shares": [{"person_id": arjun["id"], "amount": "5.00"}]}
        assert api.post("/shared-expenses", json=body).status_code == 422

    def test_archived_card_refused(self, api: TestClient, card: dict[str, Any]) -> None:
        arjun = person(api)
        api.post(f"/cards/{card['id']}/archive")
        body = {"card_id": card["id"], "amount": "10.00", "shares": [{"person_id": arjun["id"], "amount": "5.00"}]}
        assert api.post("/shared-expenses", json=body).status_code == 409


class TestSettlements:
    def owe(self, api: TestClient, card: dict[str, Any], person_id: str, amount: str, when: str) -> None:
        post(api, "/shared-expenses", {"card_id": card["id"], "amount": amount, "occurred_on": when,
                                       "shares": [{"person_id": person_id, "amount": amount}]})

    def test_partial_then_full_settlement(self, api: TestClient, card: dict[str, Any], account: dict[str, Any]) -> None:
        arjun = person(api)
        self.owe(api, card, arjun["id"], "500.00", "2026-10-01")
        self.owe(api, card, arjun["id"], "300.00", "2026-10-10")

        post(api, f"/people/{arjun['id']}/settlements", {"account_id": account["id"], "amount": "650.00"})

        detail = api.get(f"/people/{arjun['id']}").json()
        assert detail["totals"] == {"shared_total": "800.00", "settled_total": "650.00", "outstanding": "150.00", "received_total": "0.00"}
        shared = [e for e in detail["history"] if e["type"] == "shared_expense"]
        # Newest first: the 10 Oct share is part-paid (oldest-first allocation), the 1 Oct share fully paid.
        assert [(e["occurred_at"][:10], e["status"], e["remaining"]) for e in shared] == [
            ("2026-10-09", "partpaid", "150.00"),  # 10 Oct 00:00 IST = 9 Oct 18:30 UTC
            ("2026-09-30", "paid", "0.00"),
        ]
        assert balance(api, account["id"]) == "10650.00"  # repayment arrived in the bank

        post(api, f"/people/{arjun['id']}/settlements", {"account_id": account["id"], "amount": "150.00"})
        assert totals(api, arjun["id"])["outstanding"] == "0.00"

    def test_overpayment_refused_with_amount_owed(self, api: TestClient, card: dict[str, Any], account: dict[str, Any]) -> None:
        arjun = person(api)
        self.owe(api, card, arjun["id"], "500.00", "2026-10-01")

        response = api.post(f"/people/{arjun['id']}/settlements", json={"account_id": account["id"], "amount": "500.01"})

        assert response.status_code == 422
        assert "Only ₹500.00 is owed" in response.json()["detail"]

    def test_settlement_when_nothing_owed_refused(self, api: TestClient, account: dict[str, Any]) -> None:
        arjun = person(api)
        assert api.post(f"/people/{arjun['id']}/settlements", json={"account_id": account["id"], "amount": "1.00"}).status_code == 422

    def test_gift_does_not_settle_debt(self, api: TestClient, card: dict[str, Any], account: dict[str, Any]) -> None:
        dad = person(api, "Dad")
        self.owe(api, card, dad["id"], "1000.00", "2026-10-01")
        post(api, f"/people/{dad['id']}/income", {"account_id": account["id"], "amount": "5000.00"})
        t = totals(api, dad["id"])
        assert (t["outstanding"], t["received_total"]) == ("1000.00", "5000.00")


class TestListAndHistory:
    def test_list_sorted_by_most_owed_with_total(self, api: TestClient, card: dict[str, Any]) -> None:
        a, b, c = person(api, "Asha"), person(api, "Bala"), person(api, "Chitra")
        post(api, "/shared-expenses", {"card_id": card["id"], "amount": "900.00", "shares": [
            {"person_id": a["id"], "amount": "100.00"}, {"person_id": b["id"], "amount": "400.00"}]})
        api.post(f"/people/{c['id']}/archive")

        listing = api.get("/people", params={"include_archived": True}).json()

        assert [p["name"] for p in listing["items"]] == ["Bala", "Asha", "Chitra"]
        assert listing["total_outstanding"] == "500.00"

    def test_history_lists_every_kind_newest_first(self, api: TestClient, card: dict[str, Any], account: dict[str, Any]) -> None:
        dad = person(api, "Dad")
        post(api, "/shared-expenses", {"card_id": card["id"], "amount": "300.00", "occurred_on": "2026-10-01",
                                       "shares": [{"person_id": dad["id"], "amount": "300.00"}]})
        post(api, f"/people/{dad['id']}/settlements", {"account_id": account["id"], "amount": "100.00", "occurred_on": "2026-10-05"})
        post(api, f"/people/{dad['id']}/income", {"account_id": account["id"], "amount": "2000.00", "occurred_on": "2026-10-20"})

        history = api.get(f"/people/{dad['id']}").json()["history"]

        assert [e["type"] for e in history] == ["income", "settlement", "shared_expense"]
        assert history[2]["source"] == {"kind": "card", "id": card["id"], "name": "HDFC Bank · Regalia"}
        assert history[1]["source"]["name"] == "HDFC Bank · Salary"
        assert history[2]["total_spent"] == "300.00"


class TestDeleteTransaction:
    def test_deleting_shared_expense_removes_what_is_owed(self, api: TestClient, card: dict[str, Any]) -> None:
        arjun = person(api)
        txn = post(api, "/shared-expenses", {"card_id": card["id"], "amount": "600.00",
                                             "shares": [{"person_id": arjun["id"], "amount": "600.00"}]})

        assert api.delete(f"/transactions/{txn['id']}").status_code == 204

        assert totals(api, arjun["id"])["outstanding"] == "0.00"
        assert api.get(f"/people/{arjun['id']}").json()["history"] == []

    def test_deleting_settlement_restores_debt_and_balance(self, api: TestClient, card: dict[str, Any], account: dict[str, Any]) -> None:
        arjun = person(api)
        post(api, "/shared-expenses", {"card_id": card["id"], "amount": "600.00",
                                       "shares": [{"person_id": arjun["id"], "amount": "600.00"}]})
        settlement = post(api, f"/people/{arjun['id']}/settlements", {"account_id": account["id"], "amount": "600.00"})

        api.delete(f"/transactions/{settlement['id']}")

        assert totals(api, arjun["id"])["outstanding"] == "600.00"
        assert balance(api, account["id"]) == "10000.00"

    def test_unknown_transaction_is_404(self, api: TestClient) -> None:
        assert api.delete("/transactions/00000000-0000-0000-0000-000000000000").status_code == 404
