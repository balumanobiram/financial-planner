"""Logo helpers. HTTP is simulated with httpx2.MockTransport — no real network calls."""

import httpx2
import pytest
from sqlalchemy.orm import Session

from app.services.logos import (
    MAX_LOGO_BYTES,
    fetch_logo,
    get_or_fetch_logo,
    guess_bank_domain,
    normalize_domain,
    to_data_url,
)

PNG = b"\x89PNG\r\n\x1a\n-fake-image-bytes"


class TestNormalizeDomain:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("hdfcbank.com", "hdfcbank.com"),
            ("  HDFCBank.com ", "hdfcbank.com"),
            ("https://www.icicibank.com/cards?x=1", "icicibank.com"),
            ("www.sbicard.com/", "sbicard.com"),
            ("hsbc.co.in", "hsbc.co.in"),
        ],
    )
    def test_accepts_and_cleans(self, raw: str, expected: str) -> None:
        assert normalize_domain(raw) == expected

    @pytest.mark.parametrize("raw", ["", "hdfc", "not a domain", "http://", "-bad-.com", "localhost", "a.b"])
    def test_rejects(self, raw: str) -> None:
        assert normalize_domain(raw) is None


class TestGuessBankDomain:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("HDFC Bank", "hdfcbank.com"),
            ("ICICI", "icicibank.com"),
            ("SBI Card", "sbicard.com"),
            ("American Express", "americanexpress.com"),
            ("Axis Bank", "axisbank.com"),
            ("My Local Co-op", None),
        ],
    )
    def test_known_banks(self, name: str, expected: str | None) -> None:
        assert guess_bank_domain(name) == expected


def client_returning(response: httpx2.Response | Exception, seen: list[httpx2.Request] | None = None) -> httpx2.Client:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if seen is not None:
            seen.append(request)
        if isinstance(response, Exception):
            raise response
        return response

    return httpx2.Client(transport=httpx2.MockTransport(handler))


class TestFetchLogo:
    def test_returns_image_and_asks_for_128px(self) -> None:
        seen: list[httpx2.Request] = []
        client = client_returning(httpx2.Response(200, content=PNG, headers={"content-type": "image/png"}), seen)

        assert fetch_logo("hdfcbank.com", client) == ("image/png", PNG)
        assert seen[0].url.params["domain"] == "hdfcbank.com"
        assert seen[0].url.params["sz"] == "128"

    @pytest.mark.parametrize(
        "response",
        [
            httpx2.Response(404, content=PNG, headers={"content-type": "image/png"}),  # Google's "unknown" globe
            httpx2.Response(200, content=b"<html>", headers={"content-type": "text/html"}),
            httpx2.Response(200, content=b"", headers={"content-type": "image/png"}),
            httpx2.Response(200, content=b"x" * (MAX_LOGO_BYTES + 1), headers={"content-type": "image/png"}),
        ],
        ids=["404", "not-image", "empty", "too-large"],
    )
    def test_bad_responses_give_none(self, response: httpx2.Response) -> None:
        assert fetch_logo("hdfcbank.com", client_returning(response)) is None

    def test_network_error_gives_none(self) -> None:
        assert fetch_logo("hdfcbank.com", client_returning(httpx2.ConnectError("offline"))) is None


class TestStoredLogos:
    def test_fetches_once_then_reuses(self, db_session: Session) -> None:
        calls: list[str] = []

        def fetcher(domain: str) -> tuple[str, bytes]:
            calls.append(domain)
            return "image/png", PNG

        first = get_or_fetch_logo(db_session, "hdfcbank.com", fetcher)
        second = get_or_fetch_logo(db_session, "hdfcbank.com", fetcher)

        assert first is not None and second is not None and first.id == second.id
        assert calls == ["hdfcbank.com"]
        assert to_data_url(first).startswith("data:image/png;base64,")

    def test_refresh_replaces_but_failed_refresh_keeps_old(self, db_session: Session) -> None:
        get_or_fetch_logo(db_session, "axisbank.com", lambda _: ("image/png", PNG))

        refreshed = get_or_fetch_logo(db_session, "axisbank.com", lambda _: ("image/x-icon", b"new"), refresh=True)
        assert refreshed is not None and refreshed.data == b"new"

        kept = get_or_fetch_logo(db_session, "axisbank.com", lambda _: None, refresh=True)
        assert kept is not None and kept.data == b"new"

    def test_failed_first_fetch_stores_nothing(self, db_session: Session) -> None:
        assert get_or_fetch_logo(db_session, "unknown-bank.in", lambda _: None) is None
