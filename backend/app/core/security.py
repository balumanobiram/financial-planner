"""Password hashing + JWT helpers (≈ Spring Security's PasswordEncoder + a JWT utility).

Deliberately free of app settings imports so scripts/hash_password.py can use it
without a configured backend/.env.
"""

import secrets
from datetime import datetime, timedelta

import bcrypt
import jwt

ALGORITHM = "HS256"
BCRYPT_MAX_BYTES = 72  # bcrypt ignores/rejects anything longer


def hash_password(password: str, rounds: int = 12) -> str:
    data = password.encode("utf-8")
    if len(data) > BCRYPT_MAX_BYTES:
        raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes (bcrypt limit)")
    return bcrypt.hashpw(data, bcrypt.gensalt(rounds=rounds)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:  # malformed hash, or password over 72 bytes
        return False


def authenticate(username: str, password: str, *, expected_username: str, password_hash: str) -> bool:
    """Check both credentials. The password is verified even when the username is wrong,
    so response time does not reveal which one failed."""
    username_ok = secrets.compare_digest(username.encode("utf-8"), expected_username.encode("utf-8"))
    password_ok = verify_password(password, password_hash)
    return username_ok and password_ok


def create_access_token(
    subject: str, *, now: datetime, secret: str, expire_days: int
) -> tuple[str, datetime]:
    expires_at = now + timedelta(days=expire_days)
    token = jwt.encode({"sub": subject, "iat": now, "exp": expires_at}, secret, algorithm=ALGORITHM)
    return token, expires_at


def decode_access_token(token: str, *, secret: str) -> str:
    """Return the token's subject. Raises jwt.InvalidTokenError if invalid or expired."""
    payload = jwt.decode(
        token, secret, algorithms=[ALGORITHM], options={"require": ["sub", "iat", "exp"]}
    )
    return str(payload["sub"])
