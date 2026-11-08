"""Reports end to end (Neon dev, rolled back). "Today" is pinned to 15 Nov 2026, so October is a finished month.

Every expected number is worked out by hand in the comments.
"""

from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_logo_fetcher, get_today
from app.core.db import get_db
from app.models import MonthlySnapshot
from tests.conftest import FakeFetcher, db_override

TODAY = date(2026, 11, 15)


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
    return response.json()


def post(api: TestClient, path: str, body: dict[str, Any]) -> Any:
    return ok(api.post(path, json=body), 201)


@pytest.fixture
def world(api: TestClient) -> dict[str, Any]:
    hdfc = post(api, "/accounts", {"bank_name": "HDFC Bank", "nickname": "Salary", "account_type": "salary",
                                   "opening_balance": "100000", "opening_date": "2026-01-01"})
    icici = post(api, "/accounts", {"bank_name": "ICICI Bank", "nickname": "Savings", "account_type": "savings",
                                    "opening_balance": "20000", "opening_date": "2026-10-10"})  # opened mid-October
    card = post(api, "/cards", {"bank_name": "HDFC Bank", "card_name": "Regalia", "network": "visa", "statement_day": 12,
                                "payment_due_days": 20, "credit_limit": "100000"})  # 12 Oct statement, due 1 Nov
    ravi = post(api, "/people", {"name": "Ravi"})
    dad = post(api, "/people", {"name": "Dad"})
    cats = {c["name"]: c["id"] for c in ok(api.get("/categories"))["items"]}
    acc, on_card = {"account_id": hdfc["id"]}, {"card_id": card["id"]}

    def txn(body: dict[str, Any]) -> None:
        post(api, "/transactions", body)

    txn({"type": "income", "source": acc, "amount": "80000", "occurred_on": "2026-09-15", "category_id": cats["Salary"]})
    txn({"type": "expense", "source": on_card, "amount": "2000", "occurred_on": "2026-09-20", "category_id": cats["Food"]})
    # ---- October ----
    txn({"type": "income", "source": acc, "amount": "85000", "occurred_on": "2026-10-01", "category_id": cats["Salary"]})
    txn({"type": "income", "source": acc, "amount": "5000", "occurred_on": "2026-10-03", "person_id": dad["id"]})
    txn({"type": "income", "source": acc, "amount": "1000", "occurred_on": "2026-10-05", "description": "Cashback"})
    txn({"type": "expense", "source": on_card, "amount": "3000", "occurred_on": "2026-10-10", "category_id": cats["Food"],
         "description": "Dinner", "shares": [{"person_id": ravi["id"], "amount": "1000"}]})
    txn({"type": "expense", "source": on_card, "amount": "236", "occurred_on": "2026-10-12", "description": "FINANCE CHARGES"})
    txn({"type": "expense", "source": acc, "amount": "18000", "occurred_on": "2026-10-15", "category_id": cats["Rent"]})
    txn({"type": "expense", "source": acc, "amount": "100", "occurred_on": "2026-10-20", "category_id": cats["Food"], "direction": "credit"})
    txn({"type": "card_payment", "from_account_id": hdfc["id"], "card_id": card["id"], "amount": "2000", "occurred_on": "2026-10-22"})
    txn({"type": "transfer", "from_account_id": hdfc["id"], "to_account_id": icici["id"], "amount": "5000", "occurred_on": "2026-10-25"})
    post(api, f"/people/{ravi['id']}/settlements", {"account_id": hdfc["id"], "amount": "400", "occurred_on": "2026-10-28"})
    # ---- November ----
    txn({"type": "card_payment", "from_account_id": hdfc["id"], "card_id": card["id"], "amount": "3236", "occurred_on": "2026-11-05"})  # late
    txn({"type": "expense", "source": acc, "amount": "500", "occurred_on": "2026-11-02"})
    return {"hdfc": hdfc, "card": card, "cats": cats}


def october(api: TestClient) -> Any:
    return ok(api.get("/reports/monthly", params={"month": "2026-10"}))


def test_summary_and_breakdowns(api: TestClient, world: dict[str, Any]) -> None:
    r = october(api)
    assert {k: r["period"][k] for k in ("label", "start", "end", "is_complete")} == {
        "label": "October 2026", "start": "2026-10-01", "end": "2026-10-31", "is_complete": True,
    }
    s = r["summary"]
    # Income 85000 + 5000 + 1000. Expenses (your share): Food 3000 − Ravi's 1000 − refund 100 = 1900, Rent 18000, fee 236.
    assert (s["income"], s["expenses"], s["net_savings"], s["savings_rate"]) == ("91000.00", "20136.00", "70864.00", "77.9")
    # HDFC: 100000 + 80000 at the start; + 85000 + 5000 + 1000 − 18000 + 100 − 2000 − 5000 + 400 = 246500 at the end.
    # ICICI opened mid-month: 0 → 20000 + 5000.
    assert [(a["name"], a["opening"], a["closing"]) for a in s["accounts"]] == [("Salary", "180000.00", "246500.00"), ("Savings", "0.00", "25000.00")]
    assert (s["banks_opening"], s["banks_closing"]) == ("180000.00", "271500.00")

    assert [(i["source"], i["amount"], i["percent"]) for i in r["income_sources"]] == [
        ("salary", "85000.00", "93.4"), ("people", "5000.00", "5.5"), ("other", "1000.00", "1.1"),
    ]
    cats = {c["name"]: (c["amount"], c["previous"], c["change_pct"]) for c in r["expense_categories"]}
    assert cats == {"Rent": ("18000.00", "0.00", None), "Food": ("1900.00", "2000.00", "-5.0"), "Uncategorised": ("236.00", "0.00", None)}
    assert [(t["amount"], t["description"]) for t in r["top_expenses"]] == [("18000.00", None), ("3000.00", "Dinner"), ("236.00", "FINANCE CHARGES")]


def test_cards_people_net_position_insights(api: TestClient, world: dict[str, Any]) -> None:
    r = october(api)
    [stmt] = r["cards"]
    # 12 Oct statement = 2000 + 3000 + 236; 2000 paid by the 1 Nov due date, the rest on 5 Nov → paid late.
    assert {k: stmt[k] for k in ("statement_date", "due_date", "amount", "paid_by_due", "paid", "status", "utilization_pct", "fees")} == {
        "statement_date": "2026-10-12", "due_date": "2026-11-01", "amount": "5236.00", "paid_by_due": "2000.00",
        "paid": "5236.00", "status": "paid_late", "utilization_pct": "5.2", "fees": "236.00",
    }
    assert [(p["name"], p["owed_at_start"], p["new_shares"], p["settled"], p["pending"]) for p in r["people"]] == [
        ("Ravi", "0.00", "1000.00", "400.00", "600.00"),
    ]
    # End: banks 271500 + owed 600 − card (2000 + 3000 + 236 − 2000 = 3236). Start: 180000 + 0 − 2000.
    assert {k: r["net_position"][k] for k in ("value", "previous_value", "change", "card_outstanding")} == {
        "value": "268864.00", "previous_value": "178000.00", "change": "90864.00", "card_outstanding": "3236.00",
    }
    assert [(i["tone"], i["text"]) for i in r["insights"]] == [
        ("bad", "₹236 paid in card interest or fees"),
        ("warn", "1 card bill paid late"),
        ("good", "You saved 77.9% of your income"),
        ("good", "Net position up ₹90,864 this month"),
        ("info", "₹600 still owed to you by Ravi"),
    ]
    trend = {t["month"]: (t["income"], t["expenses"]) for t in r["trend"]}
    assert list(trend)[0] == "2026-05-01" and trend["2026-09-01"] == ("80000.00", "2000.00") and trend["2026-10-01"] == ("91000.00", "20136.00")


def test_totals_match_the_transaction_list(api: TestClient, world: dict[str, Any]) -> None:
    """Cross-check against the raw entries the Transactions page shows for October."""
    items = ok(api.get("/transactions", params={"from": "2026-10-01", "to": "2026-10-31", "limit": 100}))["items"]
    income = sum(Decimal(t["amount"]) for t in items if t["type"] == "income")
    spent = sum(-Decimal(t["amount"]) - sum(Decimal(s["amount"]) for s in t["shares"]) for t in items if t["type"] == "expense")
    s = october(api)["summary"]
    assert (Decimal(s["income"]), Decimal(s["expenses"])) == (income, spent)


def test_finished_month_is_frozen_until_regenerated(api: TestClient, world: dict[str, Any], db_session: Session) -> None:
    assert october(api)["from_snapshot"] is False  # built and saved
    assert october(api)["from_snapshot"] is True

    # Correct an old month: the saved report doesn't change by itself…
    post(api, "/transactions", {"type": "expense", "source": {"account_id": world["hdfc"]["id"]}, "amount": "1000", "occurred_on": "2026-10-30"})
    assert october(api)["summary"]["expenses"] == "20136.00"
    # …until you ask for it.
    rebuilt = ok(api.post("/reports/monthly/regenerate", params={"month": "2026-10"}))
    assert (rebuilt["summary"]["expenses"], rebuilt["from_snapshot"]) == ("21136.00", False)
    again = october(api)
    assert (again["summary"]["expenses"], again["from_snapshot"]) == ("21136.00", True)
    assert db_session.scalar(select(func.count()).select_from(MonthlySnapshot)) == 1  # replaced, not duplicated


def test_current_month_is_always_live(api: TestClient, world: dict[str, Any], db_session: Session) -> None:
    for _ in range(2):
        r = ok(api.get("/reports/monthly", params={"month": "2026-11"}))
        assert (r["from_snapshot"], r["period"]["is_complete"]) == (False, False)
    assert db_session.scalar(select(func.count()).select_from(MonthlySnapshot)) == 0


def test_range_and_year(api: TestClient, world: dict[str, Any]) -> None:
    r = ok(api.get("/reports/range", params={"from": "2026-10-01", "to": "2026-10-15"}))
    # Up to 15 Oct: Food 2000 (refund is on the 20th), fee 236, Rent 18000.
    assert (r["period"]["label"], r["summary"]["income"], r["summary"]["expenses"]) == ("1 Oct – 15 Oct 2026", "91000.00", "20236.00")
    assert (r["period"]["previous_start"], r["period"]["previous_end"]) == ("2026-09-16", "2026-09-30")

    y = ok(api.get("/reports/yearly", params={"year": 2026}))
    # 80000 + 91000 in; 2000 (Sep) + 20136 (Oct) + 500 (Nov) out.
    assert (y["summary"]["income"], y["summary"]["expenses"], y["period"]["is_complete"]) == ("171000.00", "22636.00", False)
    assert len(y["trend"]) == 12
    # Only the 12 Oct statement asked for money: the 5 Nov payment cleared the card before 12 Nov.
    assert [(c["statement_date"], c["status"]) for c in y["cards"] if c["status"] != "nothing_due"] == [("2026-10-12", "paid_late")]


@pytest.mark.parametrize(
    ("path", "params", "message"),
    [
        ("/reports/monthly", {"month": "2026-12"}, "hasn't started"),
        ("/reports/monthly", {"month": "2026-13"}, "string_pattern_mismatch"),
        ("/reports/range", {"from": "2026-10-10", "to": "2026-10-01"}, "on or before"),
        ("/reports/range", {"from": "2023-01-01", "to": "2026-01-01"}, "two years"),
        ("/reports/yearly", {"year": 2027}, "hasn't started"),
    ],
)
def test_invalid_periods(api: TestClient, path: str, params: dict[str, Any], message: str) -> None:
    response = api.get(path, params=params)
    assert response.status_code == 422 and message in response.text


def test_month_range_and_financial_year(api: TestClient, world: dict[str, Any]) -> None:
    m = ok(api.get("/reports/months", params={"from": "2026-09", "to": "2026-10"}))
    # Sep: 80000 in, Food 2000 out. Oct: 91000 in, 20136 out.
    assert (m["period"]["label"], m["summary"]["income"], m["summary"]["expenses"]) == ("Sep – Oct 2026", "171000.00", "22136.00")
    assert (m["period"]["previous_start"], m["period"]["compare_label"]) == ("2026-07-01", "the previous 2 months")

    fy = ok(api.get("/reports/financial-year", params={"fy": 2026}))
    # FY 2026–27 so far: Sep + Oct + Nov (the 500 on 2 Nov) — same totals as calendar 2026 here.
    assert (fy["period"]["label"], fy["summary"]["income"], fy["summary"]["expenses"], fy["period"]["is_complete"]) == (
        "FY 2026–27", "171000.00", "22636.00", False,
    )
    assert [t["month"] for t in fy["trend"]][::11] == ["2026-04-01", "2027-03-01"]

    pdf = api.get("/reports/financial-year/pdf", params={"fy": 2026})
    assert pdf.headers["content-disposition"] == 'attachment; filename="finance-report-FY2026-27.pdf"'
    assert pdf.content.startswith(b"%PDF-")
    months_pdf = api.get("/reports/months/pdf", params={"from": "2026-09", "to": "2026-10"})
    assert 'finance-report-2026-09_to_2026-10.pdf' in months_pdf.headers["content-disposition"]

    assert api.get("/reports/financial-year", params={"fy": 2027}).status_code == 422
    assert api.get("/reports/months", params={"from": "2026-10", "to": "2026-09"}).status_code == 422
