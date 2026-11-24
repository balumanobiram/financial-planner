"""Plan page API end to end (Neon dev, rolled back). Standalone: it must not touch anything else."""

from typing import Any

from fastapi.testclient import TestClient


def ok(response: Any, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json()


def test_first_visit_creates_an_empty_plan(api: TestClient) -> None:
    plan = ok(api.get("/plan"))
    assert (plan["salary"], plan["items"], plan["planned"], plan["left_over"]) == ("0.00", [], "0.00", "0.00")
    assert ok(api.get("/plan")) == plan  # still one plan


def test_salary_lines_and_figures(api: TestClient) -> None:
    ok(api.patch("/plan", json={"salary": "80000", "notes": "Nov plan"}))
    ok(api.post("/plan/items", json={"name": "Rent", "amount": "18000", "group": "needs"}), 201)
    ok(api.post("/plan/items", json={"name": "Eating out", "amount": "6000", "group": "wants"}), 201)
    plan = ok(api.post("/plan/items", json={"name": "SIP", "amount": "16000", "group": "investments"}), 201)

    assert [i["name"] for i in plan["items"]] == ["Rent", "Eating out", "SIP"]  # in the order added
    assert (plan["planned"], plan["left_over"], plan["saving_rate"]) == ("40000.00", "40000.00", "20.0")
    assert plan["items"][0]["percent_of_salary"] == "22.5"
    assert plan["notes"] == "Nov plan"


def test_edit_and_delete_a_line(api: TestClient) -> None:
    ok(api.patch("/plan", json={"salary": "50000"}))
    item = ok(api.post("/plan/items", json={"name": "Rent", "amount": "18000", "group": "needs"}), 201)["items"][0]

    plan = ok(api.patch(f"/plan/items/{item['id']}", json={"amount": "20000", "group": "wants"}))
    assert (plan["items"][0]["amount"], plan["items"][0]["group"], plan["items"][0]["name"]) == ("20000.00", "wants", "Rent")

    plan = ok(api.delete(f"/plan/items/{item['id']}"))
    assert plan["items"] == [] and plan["left_over"] == "50000.00"
    assert api.delete(f"/plan/items/{item['id']}").status_code == 404


def test_salary_can_be_cleared_notes_alone(api: TestClient) -> None:
    ok(api.patch("/plan", json={"salary": "50000"}))
    plan = ok(api.patch("/plan", json={"notes": "just notes"}))
    assert (plan["salary"], plan["notes"]) == ("50000.00", "just notes")


def test_validation(api: TestClient) -> None:
    for body in [
        {"name": "", "amount": "10", "group": "needs"},
        {"name": "X", "amount": "0", "group": "needs"},
        {"name": "X", "amount": "10.555", "group": "needs"},
        {"name": "X", "amount": "10", "group": "fun"},
    ]:
        assert api.post("/plan/items", json=body).status_code == 422, body
    assert api.patch("/plan", json={"salary": "-1"}).status_code == 422


def test_plan_is_standalone(api: TestClient) -> None:
    before = ok(api.get("/dashboard/summary"))
    ok(api.patch("/plan", json={"salary": "80000"}))
    ok(api.post("/plan/items", json={"name": "Rent", "amount": "18000", "group": "needs"}), 201)
    after = ok(api.get("/dashboard/summary"))
    assert after == before


def test_needs_login(app: Any) -> None:
    assert TestClient(app).get("/plan").status_code == 401
