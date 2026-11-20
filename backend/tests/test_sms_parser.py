"""Generic SMS parser. The messages are made-up generic wording, not any bank's real format."""

from datetime import date
from decimal import Decimal

import pytest

from app.services.sms_parser import Direction, is_otp, mask_card_numbers, parse, plausible_date


class TestAmount:
    @pytest.mark.parametrize(
        ("text", "amount"),
        [
            ("Rs 1,250.50 debited from A/c XX1234", "1250.50"),
            ("Rs.500 spent on card x9876", "500.00"),
            ("INR 99 debited from a/c XX1234", "99.00"),
            ("₹ 10,000 credited to A/c XX1234", "10000.00"),
            ("Rs.45.5 paid to shop@okaxis", "45.50"),
        ],
    )
    def test_reads_rs_inr_and_rupee_sign(self, text: str, amount: str) -> None:
        assert parse(text, "").amount == Decimal(amount)

    def test_skips_balance_and_limit(self) -> None:
        text = "Avl Bal Rs 50,000.00. Rs 300 debited from A/c XX1234. Avl Lmt INR 20,000"
        assert parse(text, "").amount == Decimal("300.00")

    def test_missing_amount_needs_review(self) -> None:
        result = parse("Money debited from A/c XX1234", "")
        assert result.amount is None and result.needs_review


class TestDirection:
    @pytest.mark.parametrize("word", ["sent", "spent", "used", "paid", "debited"])
    def test_debit_words(self, word: str) -> None:
        assert parse(f"Rs 100 {word} from A/c XX1234", "").direction is Direction.DEBIT

    @pytest.mark.parametrize("word", ["received", "credited"])
    def test_credit_words(self, word: str) -> None:
        assert parse(f"Rs 100 {word} in A/c XX1234", "").direction is Direction.CREDIT

    def test_earliest_word_wins_and_both_is_not_flagged_as_unknown(self) -> None:
        result = parse("Rs 100 debited from A/c XX1234 and credited to shop@okicici", "")
        assert result.direction is Direction.DEBIT
        assert result.unsure == ["Mentions both money out and money in — check the direction"]

    def test_no_direction_needs_review(self) -> None:
        result = parse("Rs 100 transaction on A/c XX1234", "")
        assert result.direction is None and result.needs_review


class TestOverrides:
    @pytest.mark.parametrize(
        "text",
        [
            "Payment of Rs 5,000 received towards your credit card XX4321",
            "Rs 5000 paid towards card bill for card ending 4321",
        ],
    )
    def test_card_bill_payment(self, text: str) -> None:
        result = parse(text, "")
        assert result.is_card_payment and result.rejected_reason is None

    @pytest.mark.parametrize(
        "text",
        [
            "shop@okaxis has requested Rs 500 from you. Approve in your UPI app",
            "Collect request of Rs 200 from friend@ybl",
            "Your credit card bill of Rs 12,000 is due on 25-11-2026",
            "Reminder: Rs 999 for your subscription",
            "Rs 1,500 will be debited from A/c XX1234 tomorrow",
        ],
    )
    def test_no_money_moved_is_rejected(self, text: str) -> None:
        assert parse(text, "").rejected_reason is not None

    def test_payment_mentioning_due_is_still_a_card_payment(self) -> None:
        result = parse("Payment of Rs 5,000 received on credit card XX4321. Total due now Rs 0", "")
        assert result.is_card_payment and result.rejected_reason is None

    @pytest.mark.parametrize("text", ["Your OTP is 123456", "123456 is your one time password for Rs 500"])
    def test_otp(self, text: str) -> None:
        assert is_otp(text)

    def test_ordinary_sms_is_not_otp(self) -> None:
        assert not is_otp("Rs 100 debited from A/c XX1234 at HOTSPOT CAFE")


class TestDetails:
    def test_upi_id_ref_and_last4(self) -> None:
        result = parse("Rs 250 sent from A/c XX1234 to Chai.Point@okhdfcbank on 20-11-26. UPI Ref No 512345678901", "")
        assert (result.merchant, result.upi_ref, result.last4) == ("chai.point@okhdfcbank", "512345678901", "1234")
        assert result.on_date == date(2026, 11, 20)

    @pytest.mark.parametrize(
        ("text", "merchant"),
        [
            ("Rs 499 spent on card x9876 at AMAZON RETAIL on 2026-11-20", "AMAZON RETAIL"),
            ("Rs 1200 credited to A/c XX1234 from RAVI KUMAR.", "RAVI KUMAR"),
        ],
    )
    def test_merchant_name(self, text: str, merchant: str) -> None:
        assert parse(text, "").merchant == merchant

    def test_account_words_are_not_a_merchant(self) -> None:
        assert parse("Rs 100 debited from A/c XX1234", "").merchant is None

    @pytest.mark.parametrize(
        ("text", "last4"),
        [("card ending 5678", "5678"), ("a/c no. XXXXXX4321", "4321"), ("Card x9876", "9876"), ("**2468 used", "2468")],
    )
    def test_last4(self, text: str, last4: str) -> None:
        assert parse(f"Rs 10 debited {text}", "").last4 == last4

    @pytest.mark.parametrize(
        ("text", "expected"),
        [("on 05/11/2026", date(2026, 11, 5)), ("on 5-Nov-26", date(2026, 11, 5)), ("on 05 Nov 2026", date(2026, 11, 5)), ("on 2026-11-05", date(2026, 11, 5))],
    )
    def test_dates_are_day_first(self, text: str, expected: date) -> None:
        assert parse(f"Rs 10 debited from A/c XX1234 {text}", "").on_date == expected

    def test_implausible_dates_are_dropped(self) -> None:
        today = date(2026, 11, 20)
        assert plausible_date(date(2026, 11, 19), today) == date(2026, 11, 19)
        assert plausible_date(date(2026, 12, 1), today) is None
        assert plausible_date(date(2024, 1, 1), today) is None


def test_full_card_numbers_are_masked_but_upi_refs_kept() -> None:
    text = "Card 4111 1111 1111 1234 used. Ref 512345678901. Card 4111-1111-1111-5678"
    assert mask_card_numbers(text) == "Card XXXXXXXXXXXX1234 used. Ref 512345678901. Card XXXXXXXXXXXX5678"
