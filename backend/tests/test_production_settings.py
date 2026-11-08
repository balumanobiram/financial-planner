"""Settings that only matter once deployed: real client IPs behind Render, hidden API docs."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core.client_ip import client_ip
from app.core.config import get_settings
from app.main import create_app


def request(forwarded: str | None, peer: str = "10.0.0.1") -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


@pytest.mark.parametrize(
    ("forwarded", "trust", "expected"),
    [
        ("49.36.1.2", True, "49.36.1.2"),
        # The visitor typed "1.1.1.1" themselves; the proxy appended what it really saw.
        ("1.1.1.1, 49.36.1.2", True, "49.36.1.2"),
        ("1.1.1.1,  ,49.36.1.2 ", True, "49.36.1.2"),
        (None, True, "10.0.0.1"),  # no header: the connection itself
        ("", True, "10.0.0.1"),
        ("49.36.1.2", False, "10.0.0.1"),  # locally the header is ignored — anyone could set it
    ],
)
def test_client_ip(forwarded: str | None, trust: bool, expected: str) -> None:
    assert client_ip(request(forwarded), trust_proxy=trust) == expected


@pytest.fixture
def production_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[FastAPI]:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("TRUST_PROXY", "true")
    get_settings.cache_clear()  # settings are cached on first use; rebuild them from the patched env
    yield create_app()
    get_settings.cache_clear()


def test_production_hides_api_docs(production_app: FastAPI) -> None:
    client = TestClient(production_app)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path
    assert client.get("/health").status_code == 200


def test_lockout_uses_the_forwarded_ip_in_production(production_app: FastAPI) -> None:
    client = TestClient(production_app)
    wrong = {"username": "nobody", "password": "wrong"}
    for _ in range(5):
        client.post("/auth/login", json=wrong, headers={"X-Forwarded-For": "6.6.6.6"})
    assert client.post("/auth/login", json=wrong, headers={"X-Forwarded-For": "6.6.6.6"}).status_code == 429
    # Someone else behind the same Render load balancer is not locked out…
    assert client.post("/auth/login", json=wrong, headers={"X-Forwarded-For": "49.36.1.2"}).status_code == 401
    # …and the attacker can't escape by prefixing a fake address.
    assert client.post("/auth/login", json=wrong, headers={"X-Forwarded-For": "9.9.9.9, 6.6.6.6"}).status_code == 429


def test_development_still_has_docs(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
