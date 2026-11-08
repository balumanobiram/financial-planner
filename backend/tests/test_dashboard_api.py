"""GET /dashboard/summary end to end (Neon dev, rolled back).

"Today" is pinned to Wed 28 Oct 2026. The fixture builds a small but complete month, and
every expected number below is worked out by hand in the comments.
"""

from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.api.deps import get_logo_fetcher, get_today
from app.core.db import get_db
from tests.conftest import FakeFetcher, db_override

TODAY = date(2026, 10, 28)  # a Wednesday


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


def post(api: TestClient, path: str, body: dict[str, Any]) -> Any:
    return ok(api.post(path, json=body), 201)


@pytest.fixture
def world(api: TestClient) -> dict[str, Any]:
    hdfc = post(api, "/accounts", {"bank_name": "HDFC Bank", "nickname": "Salary", "account_type": "salary",
                                   "opening_balance": "100000", "opening_date": "2026-01-01"})
    # Opened this month → not part of last month's bank total.
    icici = post(api, "/accounts", {"bank_name": "ICICI Bank", "nickname": "Savings", "account_type": "savings",
                                    "opening_balance": "20000", "opening_date": "2026-10-05"})
    # Statement on the 12th, due 20 days later → last statement 12 Oct, due 1 Nov.
    regalia = post(api, "/cards", {"bank_name": "HDFC Bank", "card_name": "Regalia", "network": "visa", "statement_day": 12, "payment_due_days": 20})
    # Statement 25 Oct; nothing was on it.
    sbi = post(api, "/cards", {"bank_name": "SBI Card", "card_name": "SimplyCLICK", "network": "rupay", "statement_day": 25, "payment_due_days": 20})
    ravi = post(api, "/people", {"name": "Ravi"})
    cats = {c["name"]: c["id"] for c in ok(api.get("/categories"))["items"]}
    acc, card = {"account_id": hdfc["id"]}, {"card_id": regalia["id"]}

    def spend(source: dict[str, str], amount: str, day: str, category: str, **extra: Any) -> None:
        post(api, "/transactions", {"type": "expense", "source": source, "amount": amount, "occurred_on": day,
                                     "category_id": cats[category], "description": f"{category} {day}", **extra})

    post(api, "/transactions", {"type": "income", "source": acc, "amount": "80000", "occurred_on": "2026-09-15", "category_id": cats["Salary"]})
    spend(card, "2000", "2026-09-20", "Shopping")  # last month, on the Oct statement
    spend(card, "3000", "2026-10-10", "Food", shares=[{"person_id": ravi["id"], "amount": "1000"}])  # Ravi owes 1000
    post(api, "/transactions", {"type": "card_payment", "from_account_id": hdfc["id"], "card_id": regalia["id"], "amount": "2000", "occurred_on": "2026-10-20"})
    spend(acc, "300", "2026-10-19", "Fuel")  # last Mon
    spend(acc, "400", "2026-10-21", "Fuel")  # last Wed
    spend(acc, "999", "2026-10-23", "Fuel")  # last Fri — after "same days last week"
    post(api, "/transactions", {"type": "transfer", "from_account_id": hdfc["id"], "to_account_id": icici["id"], "amount": "5000", "occurred_on": "2026-10-22"})
    spend(acc, "500", "2026-10-26", "Groceries")  # this Mon
    post(api, f"/people/{ravi['id']}/settlements", {"account_id": hdfc["id"], "amount": "400", "occurred_on": "2026-10-27"})
    spend(acc, "100", "2026-10-27", "Groceries", direction="credit")  # refund
    spend({"card_id": sbi["id"]}, "1200", "2026-10-28", "Food")  # today
    return {"hdfc": hdfc, "icici": icici, "regalia": regalia, "sbi": sbi}


def test_stats(api: TestClient, world: dict[str, Any]) -> None:
    stats = ok(api.get("/dashboard/summary"))["stats"]
    # Banks now: HDFC 100000 + 80000 − 2000 − 300 − 400 − 999 − 5000 − 500 + 400 + 100 = 171301; ICICI 20000 + 5000 = 25000.
    # Last month: HDFC 100000 + 80000 (ICICI didn't exist yet). (196301 − 180000) / 180000 = +9.06%.
    assert stats["bank_total"] == {"value": "196301.00", "previous": "180000.00", "change_pct": "9.1"}
    # Cards: Regalia 2000 + 3000 − 2000 = 3000, SBI 1200 → 4200; last month 2000.
    assert stats["card_outstanding"] == {"value": "4200.00", "previous": "2000.00", "change_pct": "110.0"}
    # Ravi: share 1000 − repaid 400; the split was this month, so last month 0 → no %.
    assert stats["owed_to_me"] == {"value": "600.00", "previous": "0.00", "change_pct": None}
    # 196301 + 600 − 4200 = 192701; last month 180000 + 0 − 2000 = 178000 → +8.26%.
    assert stats["net_position"] == {"value": "192701.00", "previous": "178000.00", "change_pct": "8.3"}


def test_card_dues_and_hero(api: TestClient, world: dict[str, Any]) -> None:
    body = ok(api.get("/dashboard/summary"))
    regalia, sbi = body["card_dues"]  # most urgent first
    # 12 Oct statement: 2000 + 3000 = 5000; 2000 paid since → 3000 left, due 1 Nov (4 days).
    assert {k: regalia[k] for k in ("card_name", "status", "amount", "statement_balance", "paid_since_statement", "due_date", "days_left")} == {
        "card_name": "Regalia", "status": "partpaid", "amount": "3000.00", "statement_balance": "5000.00",
        "paid_since_statement": "2000.00", "due_date": "2026-11-01", "days_left": 4,
    }
    # Nothing on SBI's 25 Oct statement; today's 1200 is due after the next one (25 Nov + 20 = 15 Dec).
    assert (sbi["status"], sbi["amount"], sbi["due_date"]) == ("open", "1200.00", "2026-12-15")
    assert body["hero"]["card_id"] == world["regalia"]["id"]


def test_no_hero_when_nothing_is_due_soon(api: TestClient) -> None:
    post(api, "/cards", {"bank_name": "SBI Card", "card_name": "SimplyCLICK", "network": "rupay", "statement_day": 25, "payment_due_days": 20})
    assert ok(api.get("/dashboard/summary"))["hero"] is None


def test_money_insights(api: TestClient, world: dict[str, Any]) -> None:
    flows = ok(api.get("/dashboard/summary"))["money_insights"]
    assert [f["month"] for f in flows][:1] + [f["month"] for f in flows][-1:] == ["2025-11-01", "2026-10-01"]
    by_month = {f["month"]: (f["inflow"], f["outflow"]) for f in flows}
    assert by_month["2026-09-01"] == ("80000.00", "2000.00")
    # Oct, without the transfer and card payment: in = repayment 400 + refund 100;
    # out = 3000 + 300 + 400 + 999 + 500 + 1200 (the full card spend — this is cash flow, not your share).
    assert by_month["2026-10-01"] == ("500.00", "6399.00")
    assert by_month["2026-08-01"] == ("0.00", "0.00")


def test_week_spending_is_your_share(api: TestClient, world: dict[str, Any]) -> None:
    week = ok(api.get("/dashboard/summary"))["week"]
    assert [d["day"] for d in week["days"]] == [f"2026-10-{d}" for d in range(26, 32)] + ["2026-11-01"]
    assert [d["amount"] for d in week["days"][:3]] == ["500.00", "-100.00", "1200.00"]  # Tue: just the refund
    # This week 1600 vs Mon–Wed last week 700 (Friday's 999 isn't compared yet).
    assert (week["total"], week["last_week_total"], week["change_pct"]) == ("1600.00", "700.00", "128.6")


def test_expenses_by_category(api: TestClient, world: dict[str, Any]) -> None:
    expenses = ok(api.get("/dashboard/summary"))["expenses"]
    assert [(s["name"], s["amount"], s["percent"]) for s in expenses["week"]] == [("Food", "1200.00", "75.0"), ("Groceries", "400.00", "25.0")]
    # Month: Food 3000 − Ravi's 1000 + 1200 = 3200; Fuel 1699; Groceries 500 − 100 = 400. September's Shopping isn't here.
    assert [(s["name"], s["amount"]) for s in expenses["month"]] == [("Food", "3200.00"), ("Fuel", "1699.00"), ("Groceries", "400.00")]
    assert (expenses["week_total"], expenses["month_total"]) == ("1600.00", "5299.00")
    assert expenses["month"][0]["icon"] == "UtensilsCrossed"


def test_recent_shows_each_transfer_once(api: TestClient, world: dict[str, Any]) -> None:
    recent = ok(api.get("/dashboard/summary"))["recent"]
    assert len(recent) == 8
    assert recent[0]["description"] == "Food 2026-10-28"
    pairs = [t for t in recent if t["type"] in ("transfer", "card_payment")]
    assert pairs and all(t["direction"] == "debit" and t["counterpart"] for t in pairs)


def test_round_trips_stay_constant(api: TestClient, world: dict[str, Any]) -> None:
    """Neon is remote: the summary must stay a fixed, small number of queries however much data there is."""
    from app.core.db import engine

    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", count)
    try:
        ok(api.get("/dashboard/summary"))
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert len(statements) <= 8, "\n\n".join(statements)


def test_empty_database(api: TestClient) -> None:
    body = ok(api.get("/dashboard/summary"))
    assert body["hero"] is None and body["card_dues"] == [] and body["recent"] == []
    assert body["stats"]["net_position"] == {"value": "0.00", "previous": "0.00", "change_pct": None}
    assert len(body["money_insights"]) == 12 and body["expenses"]["month"] == []
