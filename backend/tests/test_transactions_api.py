"""Transactions + categories API end to end (Neon dev, rolled back). "Today" is pinned."""

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


def ok(response: Any, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


@pytest.fixture
def hdfc(api: TestClient) -> dict[str, Any]:
    return ok(api.post("/accounts", json={"bank_name": "HDFC Bank", "nickname": "Salary", "account_type": "salary",
                                          "opening_balance": "50000.00", "opening_date": "2026-01-01"}), 201)


@pytest.fixture
def icici(api: TestClient) -> dict[str, Any]:
    return ok(api.post("/accounts", json={"bank_name": "ICICI Bank", "nickname": "Savings", "account_type": "savings",
                                          "opening_balance": "1000.00", "opening_date": "2026-01-01"}), 201)


@pytest.fixture
def card(api: TestClient) -> dict[str, Any]:
    return ok(api.post("/cards", json={"bank_name": "HDFC Bank", "card_name": "Regalia", "network": "visa",
                                       "statement_day": 12, "payment_due_days": 20}), 201)


@pytest.fixture
def cats(api: TestClient) -> dict[str, str]:
    return {c["name"]: c["id"] for c in ok(api.get("/categories"))["items"]}


def add(api: TestClient, body: dict[str, Any], code: int = 201) -> Any:
    return ok(api.post("/transactions", json=body), code)


def expense(source: dict[str, str], amount: str, **extra: Any) -> dict[str, Any]:
    return {"type": "expense", "source": source, "amount": amount, **extra}


def balance(api: TestClient, account: dict[str, Any]) -> str:
    return ok(api.get(f"/accounts/{account['id']}"))["current_balance"]


class TestCategoriesApi:
    def test_seeded_defaults_listed_in_order(self, api: TestClient) -> None:
        items = ok(api.get("/categories"))["items"]
        assert [c["name"] for c in items][:3] == ["Food", "Groceries", "Fuel"]
        food = items[0]
        assert (food["icon"], food["is_system"], food["kind"]) == ("UtensilsCrossed", True, "expense")

    def test_custom_category_lifecycle(self, api: TestClient) -> None:
        pets = ok(api.post("/categories", json={"name": "Pets", "icon": "PawPrint", "color": "#AA5500"}), 201)
        assert (pets["color"], pets["is_system"]) == ("#aa5500", False)
        assert ok(api.get("/categories"))["items"][-1]["name"] == "Pets"  # custom ones after defaults

        ok(api.patch(f"/categories/{pets['id']}", json={"name": "Pet care"}))
        assert ok(api.delete(f"/categories/{pets['id']}"), 204) is None

    def test_duplicate_name_ignoring_case(self, api: TestClient) -> None:
        assert api.post("/categories", json={"name": "food"}).status_code == 409
        assert api.post("/categories", json={"name": "Bad icon", "icon": "not-an-icon"}).status_code == 422

    def test_default_or_used_categories_cannot_be_deleted(self, api: TestClient, card: dict[str, Any], cats: dict[str, str]) -> None:
        assert api.delete(f"/categories/{cats['Food']}").status_code == 409
        gym = ok(api.post("/categories", json={"name": "Gym"}), 201)
        add(api, expense({"card_id": card["id"]}, "1500", category_id=gym["id"]))
        assert api.delete(f"/categories/{gym['id']}").status_code == 409
        assert ok(api.post(f"/categories/{gym['id']}/archive"))["is_archived"] is True

    def test_archived_category_cannot_be_assigned(self, api: TestClient, card: dict[str, Any], cats: dict[str, str]) -> None:
        api.post(f"/categories/{cats['Fuel']}/archive")
        add(api, expense({"card_id": card["id"]}, "100", category_id=cats["Fuel"]), 409)


class TestCreate:
    def test_card_expense_with_category_tags_and_split(self, api: TestClient, card: dict[str, Any], cats: dict[str, str]) -> None:
        arjun = ok(api.post("/people", json={"name": "Arjun"}), 201)

        [item] = add(api, expense({"card_id": card["id"]}, "1800", category_id=cats["Food"], description="Dinner",
                                  tags=["Friends", "weekend", "friends"], shares=[{"person_id": arjun["id"], "amount": "600"}]))["items"]

        assert (item["type"], item["direction"], item["amount"]) == ("expense", "debit", "-1800.00")
        assert item["source"]["name"] == "HDFC Bank · Regalia"
        assert item["category"]["name"] == "Food"
        assert item["tags"] == ["friends", "weekend"]  # lower-cased, de-duplicated
        assert item["shares"] == [{"person_id": arjun["id"], "person_name": "Arjun", "amount": "600.00"}]
        assert ok(api.get(f"/people/{arjun['id']}"))["totals"]["outstanding"] == "600.00"
        assert ok(api.get(f"/cards/{card['id']}"))["outstanding"] == "1800.00"

    def test_income_with_person(self, api: TestClient, hdfc: dict[str, Any], cats: dict[str, str]) -> None:
        dad = ok(api.post("/people", json={"name": "Dad"}), 201)
        [item] = add(api, {"type": "income", "source": {"account_id": hdfc["id"]}, "amount": "5000",
                           "category_id": cats["Family"], "person_id": dad["id"]})["items"]
        assert (item["direction"], item["amount"], item["person"]["name"]) == ("credit", "5000.00", "Dad")
        assert balance(api, hdfc) == "55000.00"
        assert ok(api.get(f"/people/{dad['id']}"))["totals"]["received_total"] == "5000.00"

    def test_card_refund_is_expense_credited_back(self, api: TestClient, card: dict[str, Any]) -> None:
        add(api, expense({"card_id": card["id"]}, "2000"))
        [refund] = add(api, expense({"card_id": card["id"]}, "500", direction="credit", description="Refund"))["items"]
        assert (refund["direction"], refund["amount"]) == ("credit", "500.00")
        assert ok(api.get(f"/cards/{card['id']}"))["outstanding"] == "1500.00"

    def test_transfer_returns_both_halves(self, api: TestClient, hdfc: dict[str, Any], icici: dict[str, Any]) -> None:
        out, into = add(api, {"type": "transfer", "from_account_id": hdfc["id"], "to_account_id": icici["id"], "amount": "10000"})["items"]
        assert (out["amount"], into["amount"]) == ("-10000.00", "10000.00")
        assert out["counterpart"]["name"] == "ICICI Bank · Savings"
        assert into["counterpart"]["name"] == "HDFC Bank · Salary"
        assert (balance(api, hdfc), balance(api, icici)) == ("40000.00", "11000.00")

    def test_card_payment(self, api: TestClient, hdfc: dict[str, Any], card: dict[str, Any]) -> None:
        add(api, expense({"card_id": card["id"]}, "8000"))
        add(api, {"type": "card_payment", "from_account_id": hdfc["id"], "card_id": card["id"], "amount": "8000"})
        assert balance(api, hdfc) == "42000.00"
        assert ok(api.get(f"/cards/{card['id']}"))["outstanding"] == "0.00"

    @pytest.mark.parametrize(
        "body",
        [
            {"type": "settlement", "source": {"card_id": "x"}, "amount": "1"},  # use /people/{id}/settlements
            {"type": "expense", "source": {}, "amount": "1"},  # no source
            {"type": "expense", "source": {"card_id": "CARD"}, "amount": "0"},
            {"type": "expense", "source": {"card_id": "CARD"}, "amount": "1.005"},
            {"type": "income", "source": {"card_id": "CARD"}, "amount": "10", "shares": [{"person_id": "00000000-0000-0000-0000-000000000001", "amount": "1"}]},
            {"type": "expense", "source": {"card_id": "CARD"}, "amount": "10", "tags": ["x" * 31]},
            {"type": "expense", "source": {"card_id": "CARD"}, "amount": "10", "occurred_on": "2026-10-26"},
        ],
    )
    def test_invalid(self, api: TestClient, card: dict[str, Any], body: dict[str, Any]) -> None:
        if body.get("source", {}).get("card_id") == "CARD":
            body = {**body, "source": {"card_id": card["id"]}}
        assert api.post("/transactions", json=body).status_code == 422, body


class TestList:
    @pytest.fixture
    def data(self, api: TestClient, hdfc: dict[str, Any], icici: dict[str, Any], card: dict[str, Any], cats: dict[str, str]) -> dict[str, Any]:
        arjun = ok(api.post("/people", json={"name": "Arjun"}), 201)
        add(api, expense({"card_id": card["id"]}, "450", category_id=cats["Food"], description="Swiggy biryani", occurred_on="2026-10-01"))
        add(api, expense({"card_id": card["id"]}, "1200", category_id=cats["Fuel"], description="Petrol", tags=["car"], occurred_on="2026-10-10"))
        add(api, expense({"account_id": hdfc["id"]}, "900", category_id=cats["Food"], description="Dinner",
                         occurred_on="2026-10-20", shares=[{"person_id": arjun["id"], "amount": "300"}]))
        add(api, {"type": "income", "source": {"account_id": hdfc["id"]}, "amount": "80000", "category_id": cats["Salary"], "occurred_on": "2026-10-24"})
        add(api, {"type": "transfer", "from_account_id": hdfc["id"], "to_account_id": icici["id"], "amount": "5000", "occurred_on": "2026-10-24"})
        return {"arjun": arjun, "hdfc": hdfc, "card": card, "cats": cats}

    def page(self, api: TestClient, **params: Any) -> Any:
        return ok(api.get("/transactions", params=params))

    def test_newest_first_with_summary_excluding_transfers(self, api: TestClient, data: dict[str, Any]) -> None:
        result = self.page(api)
        assert [i["occurred_at"][:10] for i in result["items"]][-1] == "2026-09-30"  # 1 Oct IST
        assert len(result["items"]) == 6  # 4 + both halves of the transfer
        assert result["summary"] == {"count": 4, "money_in": "80000.00", "money_out": "2550.00"}

    def test_filters(self, api: TestClient, data: dict[str, Any]) -> None:
        def descriptions(**params: Any) -> list[str]:
            return sorted(i["description"] or i["type"] for i in self.page(api, **params)["items"])

        assert descriptions(card_id=data["card"]["id"]) == ["Petrol", "Swiggy biryani"]
        assert descriptions(category_id=data["cats"]["Food"]) == ["Dinner", "Swiggy biryani"]
        assert descriptions(person_id=data["arjun"]["id"]) == ["Dinner"]  # via the split
        assert descriptions(type="transfer") == ["transfer", "transfer"]
        assert descriptions(**{"from": "2026-10-10", "to": "2026-10-20"}) == ["Dinner", "Petrol"]

    def test_search_description_and_tags(self, api: TestClient, data: dict[str, Any]) -> None:
        assert [i["description"] for i in self.page(api, q="BIRYANI")["items"]] == ["Swiggy biryani"]
        assert [i["description"] for i in self.page(api, q="car")["items"]] == ["Petrol"]  # tag match
        assert self.page(api, q="100%")["items"] == []  # % is literal, not a wildcard

    def test_cursor_paging_has_no_gaps_or_repeats(self, api: TestClient, data: dict[str, Any]) -> None:
        seen: list[str] = []
        cursor = None
        pages = 0
        while True:
            params: dict[str, Any] = {"limit": 2}
            if cursor:
                params["cursor"] = cursor
            result = self.page(api, **params)
            seen += [i["id"] for i in result["items"]]
            pages += 1
            assert (result["summary"] is None) == (cursor is not None)  # summary only on page 1
            cursor = result["next_cursor"]
            if cursor is None:
                break
        everything = [i["id"] for i in self.page(api, limit=100)["items"]]
        assert seen == everything and len(set(seen)) == 6 and pages == 3

    def test_bad_cursor_and_range(self, api: TestClient, data: dict[str, Any]) -> None:
        assert api.get("/transactions", params={"cursor": "garbage"}).status_code == 422
        assert api.get("/transactions", params={"from": "2026-10-20", "to": "2026-10-01"}).status_code == 422


class TestEditAndDelete:
    def test_edit_simple_keeps_sign_and_moves_source(self, api: TestClient, hdfc: dict[str, Any], card: dict[str, Any], cats: dict[str, str]) -> None:
        [item] = add(api, expense({"card_id": card["id"]}, "1000", category_id=cats["Food"]))["items"]

        [edited] = ok(api.patch(f"/transactions/{item['id']}", json={
            "amount": "750", "source": {"account_id": hdfc["id"]}, "category_id": None, "description": "Lunch", "tags": ["work"]}))["items"]

        assert (edited["amount"], edited["source"]["kind"], edited["category"]) == ("-750.00", "account", None)
        assert (edited["description"], edited["tags"]) == ("Lunch", ["work"])
        assert balance(api, hdfc) == "49250.00"
        assert ok(api.get(f"/cards/{card['id']}"))["outstanding"] == "0.00"

    def test_edit_split_and_amount_must_still_fit(self, api: TestClient, card: dict[str, Any]) -> None:
        arjun = ok(api.post("/people", json={"name": "Arjun"}), 201)
        [item] = add(api, expense({"card_id": card["id"]}, "1000", shares=[{"person_id": arjun["id"], "amount": "600"}]))["items"]

        assert api.patch(f"/transactions/{item['id']}", json={"amount": "500"}).status_code == 422  # split > spend
        ok(api.patch(f"/transactions/{item['id']}", json={"shares": [{"person_id": arjun["id"], "amount": "200"}]}))
        assert ok(api.get(f"/people/{arjun['id']}"))["totals"]["outstanding"] == "200.00"

    def test_edit_transfer_changes_both_halves(self, api: TestClient, hdfc: dict[str, Any], icici: dict[str, Any]) -> None:
        out, _ = add(api, {"type": "transfer", "from_account_id": hdfc["id"], "to_account_id": icici["id"], "amount": "1000"})["items"]
        changed = ok(api.patch(f"/transactions/{out['id']}", json={"amount": "2500", "description": "Top up"}))["items"]
        assert sorted(c["amount"] for c in changed) == ["-2500.00", "2500.00"]
        assert (balance(api, hdfc), balance(api, icici)) == ("47500.00", "3500.00")
        assert api.patch(f"/transactions/{out['id']}", json={"category_id": None}).status_code == 422

    def test_settlement_amount_is_locked(self, api: TestClient, hdfc: dict[str, Any], card: dict[str, Any]) -> None:
        arjun = ok(api.post("/people", json={"name": "Arjun"}), 201)
        add(api, expense({"card_id": card["id"]}, "500", shares=[{"person_id": arjun["id"], "amount": "500"}]))
        settlement = ok(api.post(f"/people/{arjun['id']}/settlements", json={"account_id": hdfc["id"], "amount": "500"}), 201)

        assert api.patch(f"/transactions/{settlement['id']}", json={"amount": "900"}).status_code == 422
        [edited] = ok(api.patch(f"/transactions/{settlement['id']}", json={"description": "UPI"}))["items"]
        assert edited["description"] == "UPI"

    def test_delete_card_payment_from_card_side_removes_both(self, api: TestClient, hdfc: dict[str, Any], card: dict[str, Any]) -> None:
        _, card_side = add(api, {"type": "card_payment", "from_account_id": hdfc["id"], "card_id": card["id"], "amount": "3000"})["items"]
        assert ok(api.delete(f"/transactions/{card_side['id']}"), 204) is None
        assert balance(api, hdfc) == "50000.00"
        assert ok(api.get("/transactions"))["items"] == []
