"""India time helpers. Timestamps are stored in UTC; "today" for billing is the IST calendar day.

India has no daylight saving, so a fixed +05:30 offset is exact — and avoids needing
the `tzdata` package (Windows Python ships without a time-zone database).
"""

from datetime import date, datetime, time, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def today_ist(now: datetime) -> date:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(IST).date()


def start_of_day_ist(day: date) -> datetime:
    """Midnight IST on `day`, as an aware datetime. Used when only a date is entered,
    so an entry dated today always counts towards today's balance."""
    return datetime.combine(day, time.min, tzinfo=IST)
