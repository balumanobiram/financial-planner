from collections import defaultdict
from datetime import datetime, timedelta


class LoginThrottle:
    """In-memory brute-force guard: too many failed logins from one client → temporary lockout.

    Good enough for a single Render instance; state resets when the server restarts.
    """

    def __init__(self, max_failures: int = 5, window: timedelta = timedelta(minutes=15)) -> None:
        self._max_failures = max_failures
        self._window = window
        self._failures: defaultdict[str, list[datetime]] = defaultdict(list)

    def _recent(self, key: str, now: datetime) -> list[datetime]:
        recent = [t for t in self._failures[key] if now - t < self._window]
        self._failures[key] = recent
        return recent

    def is_locked(self, key: str, now: datetime) -> bool:
        return len(self._recent(key, now)) >= self._max_failures

    def record_failure(self, key: str, now: datetime) -> None:
        self._recent(key, now).append(now)

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)
