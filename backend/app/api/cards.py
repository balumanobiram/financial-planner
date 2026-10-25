import uuid
from dataclasses import asdict
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, status
from sqlalchemy.orm import Session

from app.api.deps import DbSession, Fetcher, Now, Today
from app.models import BankLogo, CreditCard
from app.schemas.credit_card import BillingRead, CreditCardCreate, CreditCardList, CreditCardRead, CreditCardUpdate
from app.services import cards as service
from app.services.billing import billing_cycle
from app.services.logos import logos_by_domain, to_data_url
from app.services.transactions import card_outstanding

router = APIRouter(prefix="/cards", tags=["cards"])

_ORM_FIELDS = [name for name in CreditCardRead.model_fields if name not in {"logo_data_url", "billing", "outstanding", "available_credit"}]


def _to_read(card: CreditCard, today: date, logo: BankLogo | None, outstanding: Decimal) -> CreditCardRead:
    cycle = billing_cycle(today, card.statement_day, card.payment_due_days)
    return CreditCardRead.model_validate(
        {
            **{name: getattr(card, name) for name in _ORM_FIELDS},
            "logo_data_url": to_data_url(logo) if logo else None,
            "outstanding": outstanding,
            "available_credit": card.credit_limit - outstanding if card.credit_limit is not None else None,
            "billing": BillingRead(**asdict(cycle)),
        }
    )


def _read_one(db: Session, card: CreditCard, today: date, now: datetime) -> CreditCardRead:
    logo = logos_by_domain(db, [card.bank_domain]).get(card.bank_domain or "")
    return _to_read(card, today, logo, card_outstanding(db, [card.id], now)[card.id])


@router.get("")
def list_cards(db: DbSession, today: Today, now: Now, include_archived: bool = False) -> CreditCardList:
    cards = service.list_cards(db, include_archived=include_archived)
    logos = logos_by_domain(db, (c.bank_domain for c in cards))
    owed = card_outstanding(db, [c.id for c in cards], now)
    items = [_to_read(c, today, logos.get(c.bank_domain or ""), owed[c.id]) for c in cards]
    # Most urgent first; archived cards last.
    items.sort(key=lambda c: (c.is_archived, c.billing.pay_by, c.bank_name, c.card_name))
    return CreditCardList(items=items)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_card(body: CreditCardCreate, db: DbSession, today: Today, now: Now, fetcher: Fetcher) -> CreditCardRead:
    card = service.create_card(db, body, fetcher)
    db.commit()
    return _read_one(db, card, today, now)


@router.get("/{card_id}")
def get_card(card_id: uuid.UUID, db: DbSession, today: Today, now: Now) -> CreditCardRead:
    return _read_one(db, service.get_card(db, card_id), today, now)


@router.patch("/{card_id}")
def update_card(
    card_id: uuid.UUID, body: CreditCardUpdate, db: DbSession, today: Today, now: Now, fetcher: Fetcher
) -> CreditCardRead:
    card = service.update_card(db, service.get_card(db, card_id), body, fetcher)
    db.commit()
    return _read_one(db, card, today, now)


@router.post("/{card_id}/archive")
def archive_card(card_id: uuid.UUID, db: DbSession, today: Today, now: Now) -> CreditCardRead:
    card = service.set_archived(db, service.get_card(db, card_id), archived=True)
    db.commit()
    return _read_one(db, card, today, now)


@router.post("/{card_id}/unarchive")
def unarchive_card(card_id: uuid.UUID, db: DbSession, today: Today, now: Now) -> CreditCardRead:
    card = service.set_archived(db, service.get_card(db, card_id), archived=False)
    db.commit()
    return _read_one(db, card, today, now)


@router.post("/{card_id}/refresh-logo")
def refresh_logo(card_id: uuid.UUID, db: DbSession, today: Today, now: Now, fetcher: Fetcher) -> CreditCardRead:
    """Re-download the bank's icon (e.g. after the bank changed its logo)."""
    card = service.get_card(db, card_id)
    service.refresh_logo(db, card, fetcher)
    db.commit()
    return _read_one(db, card, today, now)
