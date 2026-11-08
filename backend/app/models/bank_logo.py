from sqlalchemy import LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseEntity


class BankLogo(BaseEntity):
    """A bank's icon, fetched once per domain and shared by every card from that bank."""

    __tablename__ = "bank_logos"

    domain: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(50))
    data: Mapped[bytes] = mapped_column(LargeBinary)  # small image (≤ 256 KB), stored as bytea
