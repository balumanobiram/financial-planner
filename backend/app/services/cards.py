"""Credit card CRUD. Functions flush but never commit — the route owns the transaction."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CreditCard
from app.schemas.credit_card import CreditCardCreate, CreditCardUpdate
from app.services.errors import ArchivedError, NotFoundError
from app.services.logos import LogoFetcher, ensure_logo


def list_cards(session: Session, *, include_archived: bool = False) -> list[CreditCard]:
    stmt = select(CreditCard).order_by(CreditCard.bank_name, CreditCard.card_name)
    if not include_archived:
        stmt = stmt.where(CreditCard.is_archived.is_(False))
    return list(session.scalars(stmt))


def get_card(session: Session, card_id: uuid.UUID) -> CreditCard:
    card = session.get(CreditCard, card_id)
    if card is None:
        raise NotFoundError(f"Card {card_id} not found")
    return card



def create_card(session: Session, data: CreditCardCreate, fetcher: LogoFetcher) -> CreditCard:
    card = CreditCard(**data.model_dump())
    session.add(card)
    ensure_logo(session, card, fetcher)
    session.flush()
    return card


def update_card(session: Session, card: CreditCard, data: CreditCardUpdate, fetcher: LogoFetcher) -> CreditCard:
    if card.is_archived:
        raise ArchivedError("Unarchive the card before editing it")
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(card, field, value)
    if {"bank_domain", "bank_name"} & changes.keys():
        ensure_logo(session, card, fetcher)
    session.flush()
    return card


def set_archived(session: Session, card: CreditCard, *, archived: bool) -> CreditCard:
    card.is_archived = archived
    session.flush()
    return card


def refresh_logo(session: Session, card: CreditCard, fetcher: LogoFetcher) -> None:
    ensure_logo(session, card, fetcher, refresh=True)
    session.flush()
