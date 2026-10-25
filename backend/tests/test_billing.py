from datetime import UTC, date, datetime

import pytest

from app.core.time import today_ist
from app.services.billing import billing_cycle, statement_date


class TestStatementDate:
    @pytest.mark.parametrize(
        ("year", "month", "day", "expected"),
        [
            (2026, 10, 12, date(2026, 10, 12)),
            (2026, 4, 31, date(2026, 4, 30)),  # 30-day month
            (2026, 2, 31, date(2026, 2, 28)),  # February
            (2028, 2, 30, date(2028, 2, 29)),  # leap year
            (2026, 12, 31, date(2026, 12, 31)),
        ],
    )
    def test_clamps_to_month_end(self, year: int, month: int, day: int, expected: date) -> None:
        assert statement_date(year, month, day) == expected


class TestBillingCycle:
    def test_statement_already_out_this_month(self) -> None:
        # Statement on the 12th, 20 days to pay; today is the 25th.
        cycle = billing_cycle(date(2026, 10, 25), statement_day=12, payment_due_days=20)

        assert cycle.last_statement_date == date(2026, 10, 12)
        assert cycle.last_due_date == date(2026, 11, 1)
        assert cycle.next_statement_date == date(2026, 11, 12)
        assert cycle.next_due_date == date(2026, 12, 2)
        assert cycle.pay_by == date(2026, 11, 1)
        assert cycle.days_until_pay_by == 7

    def test_statement_not_yet_out_this_month(self) -> None:
        cycle = billing_cycle(date(2026, 10, 5), statement_day=12, payment_due_days=15)

        assert cycle.last_statement_date == date(2026, 9, 12)
        assert cycle.last_due_date == date(2026, 9, 27)
        assert cycle.next_statement_date == date(2026, 10, 12)
        # Last due date has passed → the next cycle's due date is what matters.
        assert cycle.pay_by == date(2026, 10, 27)

    def test_statement_day_is_today(self) -> None:
        cycle = billing_cycle(date(2026, 10, 12), statement_day=12, payment_due_days=15)
        assert cycle.last_statement_date == date(2026, 10, 12)
        assert cycle.pay_by == date(2026, 10, 27)

    def test_due_date_itself_still_counts(self) -> None:
        cycle = billing_cycle(date(2026, 10, 27), statement_day=12, payment_due_days=15)
        assert cycle.pay_by == date(2026, 10, 27)
        assert cycle.days_until_pay_by == 0

    def test_day_after_due_moves_to_next_cycle(self) -> None:
        cycle = billing_cycle(date(2026, 10, 28), statement_day=12, payment_due_days=15)
        assert cycle.pay_by == date(2026, 11, 27)

    def test_crosses_year_boundary(self) -> None:
        cycle = billing_cycle(date(2026, 12, 20), statement_day=18, payment_due_days=20)
        assert cycle.last_due_date == date(2027, 1, 7)
        assert cycle.next_statement_date == date(2027, 1, 18)

    def test_january_looks_back_to_december(self) -> None:
        cycle = billing_cycle(date(2027, 1, 3), statement_day=10, payment_due_days=20)
        assert cycle.last_statement_date == date(2026, 12, 10)
        assert cycle.last_due_date == date(2026, 12, 30)  # already passed on 3 Jan
        assert cycle.pay_by == date(2027, 1, 30)  # so: 10 Jan statement + 20 days

    def test_month_end_statement_day_in_february(self) -> None:
        cycle = billing_cycle(date(2026, 3, 5), statement_day=31, payment_due_days=20)
        assert cycle.last_statement_date == date(2026, 2, 28)
        assert cycle.last_due_date == date(2026, 3, 20)
        assert cycle.next_statement_date == date(2026, 3, 31)

    @pytest.mark.parametrize(("statement_day", "due_days"), [(0, 15), (32, 15), (12, 0)])
    def test_rejects_invalid_settings(self, statement_day: int, due_days: int) -> None:
        with pytest.raises(ValueError):
            billing_cycle(date(2026, 10, 1), statement_day=statement_day, payment_due_days=due_days)


class TestTodayIst:
    def test_uses_india_calendar_day(self) -> None:
        # 20:00 UTC on 25 Oct is 01:30 on 26 Oct in India.
        assert today_ist(datetime(2026, 10, 25, 20, 0, tzinfo=UTC)) == date(2026, 10, 26)
        assert today_ist(datetime(2026, 10, 25, 18, 29, tzinfo=UTC)) == date(2026, 10, 25)

    def test_rejects_naive_datetime(self) -> None:
        with pytest.raises(ValueError):
            today_ist(datetime(2026, 10, 25))
