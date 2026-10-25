"""Bank logo lookup: guess a bank's domain, fetch its icon once, store it, serve it as a data: URL.

The only outbound request goes to Google's favicon service (it learns the bank domain).
Failures are fine — the UI falls back to a monogram.
"""

import base64
import logging
import re
from collections.abc import Callable, Iterable
from typing import Protocol
from urllib.parse import urlsplit

import httpx2
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BankLogo

log = logging.getLogger(__name__)

FAVICON_URL = "https://www.google.com/s2/favicons"
MAX_LOGO_BYTES = 256_000
FETCH_TIMEOUT_SECONDS = 5.0

# Hostname: dot-separated labels of letters/digits/hyphens, with a TLD.
_DOMAIN_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")

# Common Indian card issuers. Matched against the lower-cased bank name, first match wins.
KNOWN_BANK_DOMAINS: list[tuple[str, str]] = [
    ("hdfc", "hdfcbank.com"),
    ("icici", "icicibank.com"),
    ("sbi", "sbicard.com"),
    ("state bank", "sbicard.com"),
    ("axis", "axisbank.com"),
    ("kotak", "kotak.com"),
    ("idfc", "idfcfirstbank.com"),
    ("indusind", "indusind.com"),
    ("yes bank", "yesbank.in"),
    ("rbl", "rblbank.com"),
    ("au small", "aubank.in"),
    ("au bank", "aubank.in"),
    ("american express", "americanexpress.com"),
    ("amex", "americanexpress.com"),
    ("hsbc", "hsbc.co.in"),
    ("standard chartered", "sc.com"),
    ("federal", "federalbank.co.in"),
    ("bank of baroda", "bobcard.co.in"),
    ("bob", "bobcard.co.in"),
    ("onecard", "getonecard.app"),
    ("canara", "canarabank.com"),
    ("union bank", "unionbankofindia.co.in"),
    ("punjab national", "pnbindia.in"),
    ("pnb", "pnbindia.in"),
]

LogoFetcher = Callable[[str], tuple[str, bytes] | None]


def normalize_domain(raw: str) -> str | None:
    """'https://www.HDFCBank.com/personal' → 'hdfcbank.com'. None if it isn't a plausible hostname."""
    text = raw.strip().lower()
    if not text:
        return None
    host = urlsplit(text if "://" in text else f"//{text}").hostname or ""
    host = host.removeprefix("www.")
    return host if _DOMAIN_RE.match(host) else None


def guess_bank_domain(bank_name: str) -> str | None:
    name = bank_name.lower()
    return next((domain for keyword, domain in KNOWN_BANK_DOMAINS if keyword in name), None)


def fetch_logo(domain: str, client: httpx2.Client | None = None) -> tuple[str, bytes] | None:
    """Download the domain's icon. Returns (content_type, bytes) or None on any failure."""
    own_client = client is None
    http = client or httpx2.Client(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True)
    try:
        response = http.get(FAVICON_URL, params={"domain": domain, "sz": 128})
        content_type = response.headers.get("content-type", "").split(";")[0].strip()
        # Google answers unknown domains with 404 + a generic globe; treat that as "no logo".
        if response.status_code != 200 or not content_type.startswith("image/"):
            return None
        if not response.content or len(response.content) > MAX_LOGO_BYTES:
            return None
        return content_type, response.content
    except httpx2.HTTPError as exc:
        log.warning("Logo fetch failed for %s: %s", domain, exc)
        return None
    finally:
        if own_client:
            http.close()


def get_or_fetch_logo(session: Session, domain: str, fetcher: LogoFetcher, *, refresh: bool = False) -> BankLogo | None:
    """Stored logo for the domain; fetches (and stores) it if missing or `refresh` is set."""
    existing = session.scalar(select(BankLogo).where(BankLogo.domain == domain))
    if existing and not refresh:
        return existing
    fetched = fetcher(domain)
    if fetched is None:
        return existing  # keep an old logo rather than losing it on a failed refresh
    content_type, data = fetched
    if existing:
        existing.content_type, existing.data = content_type, data
        logo = existing
    else:
        logo = BankLogo(domain=domain, content_type=content_type, data=data)
        session.add(logo)
    session.flush()
    return logo


class HasBank(Protocol):
    """Anything with a bank: accounts and cards."""

    bank_name: str
    bank_domain: str | None


def ensure_logo(session: Session, owner: HasBank, fetcher: LogoFetcher, *, refresh: bool = False) -> None:
    """Fill in a missing bank_domain from the bank name, then make sure its logo is stored."""
    if owner.bank_domain is None:
        owner.bank_domain = guess_bank_domain(owner.bank_name)
    if owner.bank_domain:
        get_or_fetch_logo(session, owner.bank_domain, fetcher, refresh=refresh)


def logos_by_domain(session: Session, domains: Iterable[str | None]) -> dict[str, BankLogo]:
    wanted = {d for d in domains if d}
    if not wanted:
        return {}
    return {logo.domain: logo for logo in session.scalars(select(BankLogo).where(BankLogo.domain.in_(wanted)))}


def to_data_url(logo: BankLogo) -> str:
    return f"data:{logo.content_type};base64,{base64.b64encode(logo.data).decode('ascii')}"
