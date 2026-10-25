"""Bank account API end to end (HTTP → service → Neon dev, rolled back after each test)."""

from typing import Any

from fastapi.testclient import TestClient

NEW_ACCOUNT = {
    "bank_name": "HDFC Bank",
    "nickname": "Salary",
    "account_type": "salary",
    "last4": "4321",
    "opening_balance": "25000.50",
    "opening_date": "2026-04-01",
}


def create(api: TestClient, **overrides: Any) -> dict[str, Any]:
    response = api.post("/accounts", json={**NEW_ACCOUNT, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


class TestCreateAndRead:
    def test_create_returns_account_with_balance_as_string(self, api: TestClient) -> None:
        account = create(api)

        assert account["nickname"] == "Salary"
        assert account["opening_balance"] == "25000.50"  # money is a JSON string, never a float
        assert account["current_balance"] == "25000.50"
        assert account["is_archived"] is False
        assert api.get(f"/accounts/{account['id']}").json() == account

    def test_whitespace_trimmed_and_blank_optional_fields_become_null(self, api: TestClient) -> None:
        account = create(api, nickname="  Joint  ", last4="", notes="   ")
        assert (account["nickname"], account["last4"], account["notes"]) == ("Joint", None, None)

    def test_opening_balance_defaults_to_zero(self, api: TestClient) -> None:
        body = {k: v for k, v in NEW_ACCOUNT.items() if k != "opening_balance"}
        assert api.post("/accounts", json=body).json()["current_balance"] == "0.00"

    def test_unknown_id_is_404(self, api: TestClient) -> None:
        assert api.get("/accounts/00000000-0000-0000-0000-000000000000").status_code == 404


class TestValidation:
    def test_rejects_invalid_input(self, api: TestClient) -> None:
        cases = [
            {"last4": "12a4"},
            {"last4": "12345"},
            {"opening_balance": "1.005"},  # sub-paisa
            {"opening_balance": "1000000000000.00"},  # > NUMERIC(14,2)
            {"account_type": "crypto"},
            {"bank_name": ""},
            {"unexpected": "field"},
        ]
        for overrides in cases:
            response = api.post("/accounts", json={**NEW_ACCOUNT, **overrides})
            assert response.status_code == 422, overrides


class TestListAndTotals:
    def test_total_balance_sums_active_accounts_only(self, api: TestClient) -> None:
        create(api, nickname="A", opening_balance="1000.00")
        create(api, nickname="B", opening_balance="-250.25")
        archived = create(api, nickname="Old", opening_balance="99999.00")
        api.post(f"/accounts/{archived['id']}/archive")

        default = api.get("/accounts").json()
        everything = api.get("/accounts", params={"include_archived": True}).json()

        assert [a["nickname"] for a in default["items"]] == ["A", "B"]
        assert default["total_balance"] == "749.75"
        assert len(everything["items"]) == 3
        assert everything["total_balance"] == "749.75"  # archived never counts

    def test_empty_list(self, api: TestClient) -> None:
        assert api.get("/accounts").json() == {"items": [], "total_balance": "0.00"}


class TestUpdateAndArchive:
    def test_patch_changes_only_sent_fields(self, api: TestClient) -> None:
        account = create(api)

        updated = api.patch(f"/accounts/{account['id']}", json={"nickname": "Primary", "opening_balance": "100.00"})

        assert updated.status_code == 200
        assert updated.json()["nickname"] == "Primary"
        assert updated.json()["bank_name"] == "HDFC Bank"
        assert updated.json()["current_balance"] == "100.00"

    def test_patch_cannot_null_required_field(self, api: TestClient) -> None:
        account = create(api)
        assert api.patch(f"/accounts/{account['id']}", json={"nickname": None}).status_code == 422

    def test_archived_account_is_read_only_until_unarchived(self, api: TestClient) -> None:
        account = create(api)
        assert api.post(f"/accounts/{account['id']}/archive").json()["is_archived"] is True

        assert api.patch(f"/accounts/{account['id']}", json={"nickname": "X"}).status_code == 409
        assert api.post(f"/accounts/{account['id']}/reconcile", json={"actual_balance": "1.00"}).status_code == 409

        assert api.post(f"/accounts/{account['id']}/unarchive").json()["is_archived"] is False
        assert api.patch(f"/accounts/{account['id']}", json={"nickname": "X"}).status_code == 200


class TestReconcileApi:
    def test_reconcile_creates_adjustment_and_updates_balance(self, api: TestClient) -> None:
        account = create(api, opening_balance="10000.00")

        response = api.post(f"/accounts/{account['id']}/reconcile", json={"actual_balance": "9876.55"})

        assert response.status_code == 200
        body = response.json()
        assert body["adjustment"]["amount"] == "-123.45"
        assert body["account"]["current_balance"] == "9876.55"
        assert api.get("/accounts").json()["total_balance"] == "9876.55"

    def test_reconcile_with_matching_balance_returns_no_adjustment(self, api: TestClient) -> None:
        account = create(api, opening_balance="500.00")
        body = api.post(f"/accounts/{account['id']}/reconcile", json={"actual_balance": "500.00"}).json()
        assert body["adjustment"] is None

    def test_reconcile_rejects_bad_amount(self, api: TestClient) -> None:
        account = create(api)
        response = api.post(f"/accounts/{account['id']}/reconcile", json={"actual_balance": "12.345"})
        assert response.status_code == 422
