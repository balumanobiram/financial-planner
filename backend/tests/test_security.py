from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.login_throttle import LoginThrottle
from app.core.security import (
    authenticate,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

SECRET = "unit-test-secret-0123456789abcdef0123456789"


class TestPasswords:
    def test_hash_then_verify(self) -> None:
        password_hash = hash_password("s3cret-pass-phrase", rounds=4)
        assert password_hash.startswith("$2b$")
        assert verify_password("s3cret-pass-phrase", password_hash)
        assert not verify_password("wrong", password_hash)

    def test_same_password_gets_different_salt(self) -> None:
        assert hash_password("same", rounds=4) != hash_password("same", rounds=4)

    def test_rejects_password_over_72_bytes(self) -> None:
        with pytest.raises(ValueError, match="72 bytes"):
            hash_password("x" * 73, rounds=4)

    def test_malformed_hash_is_just_a_failed_login(self) -> None:
        assert not verify_password("anything", "change-me")

    @pytest.mark.parametrize(
        ("username", "password", "expected"),
        [("me", "pw-ok", True), ("me", "nope", False), ("someone", "pw-ok", False), ("", "", False)],
    )
    def test_authenticate(self, username: str, password: str, expected: bool) -> None:
        password_hash = hash_password("pw-ok", rounds=4)
        assert authenticate(username, password, expected_username="me", password_hash=password_hash) is expected


class TestTokens:
    def test_round_trip_and_7_day_expiry(self) -> None:
        now = datetime.now(UTC)
        token, expires_at = create_access_token("me", now=now, secret=SECRET, expire_days=7)
        assert expires_at == now + timedelta(days=7)
        assert decode_access_token(token, secret=SECRET) == "me"

    def test_expired_token_rejected(self) -> None:
        eight_days_ago = datetime.now(UTC) - timedelta(days=8)
        token, _ = create_access_token("me", now=eight_days_ago, secret=SECRET, expire_days=7)
        with pytest.raises(jwt.ExpiredSignatureError):
            decode_access_token(token, secret=SECRET)

    def test_token_signed_with_other_secret_rejected(self) -> None:
        token, _ = create_access_token("me", now=datetime.now(UTC), secret=SECRET, expire_days=7)
        with pytest.raises(jwt.InvalidSignatureError):
            decode_access_token(token, secret=SECRET + "-other")

    def test_unsigned_token_rejected(self) -> None:
        forged = jwt.encode({"sub": "me", "iat": 0, "exp": 9999999999}, key=None, algorithm="none")
        with pytest.raises(jwt.InvalidTokenError):
            decode_access_token(forged, secret=SECRET)


class TestLoginThrottle:
    NOW = datetime(2026, 1, 1, tzinfo=UTC)

    def test_locks_after_max_failures(self) -> None:
        throttle = LoginThrottle(max_failures=3)
        for _ in range(3):
            assert not throttle.is_locked("ip", self.NOW)
            throttle.record_failure("ip", self.NOW)
        assert throttle.is_locked("ip", self.NOW)
        assert not throttle.is_locked("other-ip", self.NOW)

    def test_unlocks_after_window(self) -> None:
        throttle = LoginThrottle(max_failures=1, window=timedelta(minutes=15))
        throttle.record_failure("ip", self.NOW)
        assert throttle.is_locked("ip", self.NOW + timedelta(minutes=14))
        assert not throttle.is_locked("ip", self.NOW + timedelta(minutes=15))

    def test_reset_clears_failures(self) -> None:
        throttle = LoginThrottle(max_failures=1)
        throttle.record_failure("ip", self.NOW)
        throttle.reset("ip")
        assert not throttle.is_locked("ip", self.NOW)
