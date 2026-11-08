"""SQLAlchemy engine + session factory (≈ Spring's DataSource + EntityManagerFactory)."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

# create_engine does not connect yet; the first query does.
engine = create_engine(
    get_settings().database_url.get_secret_value(),
    # Neon suspends idle computes and drops idle connections: test each pooled
    # connection before use, and recycle them before Neon's idle timeout.
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=5,
    max_overflow=5,
)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request. A failed request's changes are rolled back."""
    with SessionLocal() as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise
