"""Auth over HTTP. No database needed."""

from fastapi.testclient import TestClient

from tests.conftest import TEST_PASSWORD, TEST_USERNAME


def login(client: TestClient, username: str = TEST_USERNAME, password: str = TEST_PASSWORD):  # noqa: ANN201
    return client.post("/auth/login", json={"username": username, "password": password})


def test_login_returns_bearer_token_that_works(client: TestClient) -> None:
    response = login(client)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.json() == {"username": TEST_USERNAME}


def test_wrong_password_and_wrong_username_look_identical(client: TestClient) -> None:
    bad_password = login(client, password="wrong")
    bad_username = login(client, username="someone-else")

    assert bad_password.status_code == bad_username.status_code == 401
    assert bad_password.json() == bad_username.json()


def test_lockout_after_five_failures_even_with_correct_password(client: TestClient) -> None:
    for _ in range(5):
        assert login(client, password="wrong").status_code == 401

    assert login(client).status_code == 429


def test_health_is_public(client: TestClient) -> None:
    assert client.get("/health").status_code == 200


def test_protected_routes_need_a_token(client: TestClient) -> None:
    for path in ("/auth/me", "/accounts"):
        response = client.get(path)
        assert response.status_code == 401, path
        assert response.headers["www-authenticate"] == "Bearer"


def test_garbage_token_rejected(client: TestClient) -> None:
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_cors_allows_frontend_origin_only(client: TestClient) -> None:
    def preflight(origin: str):  # noqa: ANN202
        return client.options(
            "/accounts",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )

    assert preflight("http://localhost:5173").headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in preflight("https://evil.example").headers
