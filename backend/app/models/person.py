from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import ArchivableMixin, BaseEntity


class Person(ArchivableMixin, BaseEntity):
    """Someone who sends you money or shares bills with you (dad, mom, friends).

    What they owe is computed from expense_shares and settlement transactions — never stored.
    """

    __tablename__ = "people"

    name: Mapped[str] = mapped_column(String(100))
    relation: Mapped[str | None] = mapped_column(String(50))  # free text: "Dad", "Friend", ...
    notes: Mapped[str | None] = mapped_column(Text)
