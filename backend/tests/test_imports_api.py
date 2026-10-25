"""Statement import end to end (Neon dev, rolled back). "Today" is pinned."""

import base64
import tempfile
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
from tests.test_statement_parser import BANK_CSV

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
def account(api: TestClient) -> dict[str, Any]:
    return ok(api.post("/accounts", json={"bank_name": "HDFC Bank", "nickname": "Salary", "account_type": "salary",
                                          "opening_balance": "100000.00", "opening_date": "2026-01-01"}), 201)


@pytest.fixture
def card(api: TestClient) -> dict[str, Any]:
    return ok(api.post("/cards", json={"bank_name": "HDFC Bank", "card_name": "Regalia", "network": "visa",
                                       "statement_day": 12, "payment_due_days": 20}), 201)


def upload(text: str, filename: str = "statement.csv") -> dict[str, str]:
    return {"filename": filename, "content_base64": base64.b64encode(text.encode()).decode()}


def preview(api: TestClient, source: dict[str, str], text: str = BANK_CSV) -> Any:
    return ok(api.post("/imports/preview", json={"file": upload(text), "source": source}))


def parse(api: TestClient, source: dict[str, str], mapping: dict[str, Any], text: str = BANK_CSV) -> Any:
    return ok(api.post("/imports/parse", json={"file": upload(text), "source": source, "mapping": mapping}))


def commit_rows(parsed: Any, *, skip_duplicates: bool = True) -> list[dict[str, Any]]:
    return [
        {"occurred_on": r["occurred_on"], "description": r["description"], "amount": r["amount"]}
        for r in parsed["rows"]
        if r["error"] is None and not (skip_duplicates and r["duplicate"])
    ]


def test_preview_detects_headings_and_suggests_mapping(api: TestClient, account: dict[str, Any]) -> None:
    body = preview(api, {"account_id": account["id"]})
    assert body["header_row"] == 4
    assert body["columns"][:2] == ["Date", "Narration"]
    assert body["total_rows"] == 5  # blank line skipped
    assert body["sample_rows"][1][1] == "UPI-SWIGGY-swiggy@icici-4729"
    assert body["saved_mapping"] is None
    assert body["suggested_mapping"]["amount_mode"] == "split"
    assert body["suggested_mapping"]["debit_column"] == "Withdrawal Amt."


def test_full_import_flags_duplicates_and_writes_everything_in_one_go(api: TestClient, account: dict[str, Any]) -> None:
    source = {"account_id": account["id"]}
    # Logged by hand earlier: the Swiggy order (your wording, not the bank's).
    ok(api.post("/transactions", json={"type": "expense", "source": source, "amount": "450", "occurred_on": "2026-10-01", "description": "Swiggy"}), 201)

    mapping = preview(api, source)["suggested_mapping"]
    parsed = parse(api, source, mapping)
    assert parsed["summary"] == {
        "rows": 5, "importable": 2, "duplicates": 1, "errors": 2, "date_from": "2026-10-01", "date_to": "2026-10-03",
        "money_in": "85000.00", "money_out": "2450.00",
    }
    swiggy = next(r for r in parsed["rows"] if r["row_number"] == 7)
    assert swiggy["duplicate"]["description"] == "Swiggy"

    result = ok(api.post("/imports/commit", json={"source": source, "mapping": mapping, "rows": commit_rows(parsed)}), 201)
    assert result == {"created": 2, "mapping_saved": True}

    # 100000 − 450 (manual) + 85000 − 2000 = 182550, matching the statement's closing balance
    assert ok(api.get(f"/accounts/{account['id']}"))["current_balance"] == "182550.00"
    imported = ok(api.get("/transactions", params={"q": "imported"}))["items"]
    assert {(t["type"], t["amount"]) for t in imported} == {("income", "85000.00"), ("expense", "-2000.00")}

    # Importing the same file again: everything is now a duplicate.
    again = parse(api, source, mapping)
    assert (again["summary"]["importable"], again["summary"]["duplicates"]) == (0, 3)


def test_saved_mapping_is_offered_next_time(api: TestClient, account: dict[str, Any]) -> None:
    source = {"account_id": account["id"]}
    mapping = {**preview(api, source)["suggested_mapping"], "date_format": "%d/%m/%y"}
    parsed = parse(api, source, mapping)
    ok(api.post("/imports/commit", json={"source": source, "mapping": mapping, "rows": commit_rows(parsed)[:1]}), 201)

    assert preview(api, source)["saved_mapping"] == mapping
    assert ok(api.get("/imports/mapping", params={"account_id": account["id"]})) == mapping

    # Saving again updates the same row (one mapping per account).
    changed = {**mapping, "description_columns": ["Narration", "Chq./Ref.No."]}
    ok(api.post("/imports/commit", json={"source": source, "mapping": changed, "rows": commit_rows(parsed)[1:2]}), 201)
    assert ok(api.get("/imports/mapping", params={"account_id": account["id"]})) == changed


def test_commit_is_all_or_nothing(api: TestClient, account: dict[str, Any]) -> None:
    source = {"account_id": account["id"]}
    food = next(c for c in ok(api.get("/categories"))["items"] if c["name"] == "Food")
    ok(api.post(f"/categories/{food['id']}/archive"), 200)
    rows = [
        {"occurred_on": "2026-10-01", "description": "fine", "amount": "-10.00"},
        {"occurred_on": "2026-10-02", "description": "archived category", "amount": "-20.00", "category_id": food["id"]},
    ]
    ok(api.post("/imports/commit", json={"source": source, "rows": rows}), 409)
    assert ok(api.get("/transactions"))["items"] == []  # the first row was rolled back too
    assert ok(api.get(f"/accounts/{account['id']}"))["current_balance"] == "100000.00"


def test_card_credits_are_refunds_and_card_payments_count_as_duplicates(api: TestClient, account: dict[str, Any], card: dict[str, Any]) -> None:
    source = {"card_id": card["id"]}
    ok(api.post("/transactions", json={"type": "card_payment", "from_account_id": account["id"], "card_id": card["id"],
                                        "amount": "5000", "occurred_on": "2026-10-20"}), 201)
    statement = (
        "Transaction Date,Details,Amount,Dr/Cr\n"
        "18/10/2026,AMAZON PAY INDIA,1299.50,Dr\n"
        "19/10/2026,AMAZON REFUND,299.00,Cr\n"
        "20/10/2026,PAYMENT RECEIVED - THANK YOU,5000.00,Cr\n"
    )
    mapping = preview(api, source, statement)["suggested_mapping"]
    assert (mapping["sign"], mapping["drcr_column"]) == ("positive_is_debit", "Dr/Cr")
    parsed = parse(api, source, mapping, statement)
    assert [r["amount"] for r in parsed["rows"]] == ["-1299.50", "299.00", "5000.00"]
    assert parsed["rows"][2]["duplicate"]["type"] == "card_payment"

    ok(api.post("/imports/commit", json={"source": source, "rows": commit_rows(parsed)}), 201)
    items = {t["description"]: t for t in ok(api.get("/transactions", params={"card_id": card["id"], "type": "expense"}))["items"]}
    assert (items["AMAZON REFUND"]["type"], items["AMAZON REFUND"]["direction"]) == ("expense", "credit")
    assert ok(api.get(f"/cards/{card['id']}"))["outstanding"] == "-3999.50"  # 1299.50 − 299 − 5000: paid more than spent


def test_upload_never_touches_disk(api: TestClient, account: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    def no_disk(*_: object, **__: object) -> None:
        raise AssertionError("an upload was written to a temp file")

    for name in ("TemporaryFile", "NamedTemporaryFile", "SpooledTemporaryFile", "mkstemp", "mkdtemp"):
        monkeypatch.setattr(tempfile, name, no_disk)
    source = {"account_id": account["id"]}
    mapping = preview(api, source)["suggested_mapping"]
    assert parse(api, source, mapping)["summary"]["rows"] == 5


@pytest.mark.parametrize(
    ("file", "message"),
    [
        ({"filename": "s.pdf", "content_base64": "eA=="}, "filename"),
        ({"filename": "s.csv", "content_base64": "%%%"}, "base64"),
        ({"filename": "s.xlsx", "content_base64": base64.b64encode(b"not a zip").decode()}, "valid .xlsx"),
    ],
)
def test_bad_files(api: TestClient, account: dict[str, Any], file: dict[str, str], message: str) -> None:
    response = api.post("/imports/preview", json={"file": file, "source": {"account_id": account["id"]}})
    assert response.status_code == 422
    assert message in response.text


def test_unknown_columns_and_archived_sources(api: TestClient, account: dict[str, Any]) -> None:
    source = {"account_id": account["id"]}
    mapping = {**preview(api, source)["suggested_mapping"], "date_column": "When"}
    response = api.post("/imports/parse", json={"file": upload(BANK_CSV), "source": source, "mapping": mapping})
    assert response.status_code == 422 and "When" in response.text

    ok(api.post(f"/accounts/{account['id']}/archive"), 200)
    assert api.post("/imports/preview", json={"file": upload(BANK_CSV), "source": source}).status_code == 409
    assert api.get("/imports/mapping").status_code == 422
