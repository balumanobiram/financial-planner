from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated, TypeVar

from fastapi import APIRouter, Query, Response

from app.api.deps import DbSession, Now, Today
from app.schemas.reports import ReportData
from app.services import report_math as rm
from app.services.report_pdf import pdf_filename, render_report_pdf
from app.services import reports as service
from app.services.errors import InvalidInputError

router = APIRouter(prefix="/reports", tags=["reports"])

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"  # YYYY-MM
Month = Annotated[str, Query(pattern=MONTH_PATTERN, description="YYYY-MM", examples=["2026-10"])]


def _first_day(month: str) -> date:
    year, m = month.split("-")
    return date(int(year), int(m), 1)


T = TypeVar("T")


def _period(build: Callable[[], T]) -> T:
    """Turn report_math's ValueErrors (future month, bad range…) into 422s."""
    try:
        return build()
    except ValueError as exc:
        raise InvalidInputError(str(exc)) from exc


@router.get("/monthly")
def monthly(month: Month, db: DbSession, today: Today, now: Now) -> ReportData:
    """A finished month is frozen on first view (from_snapshot=true afterwards); the current month is live."""
    report = _period(lambda: service.monthly_report(db, _first_day(month), today, now))
    db.commit()  # keeps the snapshot if one was just made
    return report


@router.post("/monthly/regenerate")
def regenerate(month: Month, db: DbSession, today: Today, now: Now) -> ReportData:
    """Rebuild a finished month's snapshot from the current transactions (after correcting old entries)."""
    report = _period(lambda: service.monthly_report(db, _first_day(month), today, now, regenerate=True))
    db.commit()
    return report


@router.get("/range")
def date_range(
    db: DbSession,
    today: Today,
    now: Now,
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> ReportData:
    """Any custom range up to two years (always computed live)."""
    return service.build_report(db, _period(lambda: rm.range_period(date_from, date_to, today)), today, now)


@router.get("/months")
def month_range(
    db: DbSession,
    today: Today,
    now: Now,
    month_from: Annotated[str, Query(alias="from", pattern=MONTH_PATTERN, description="YYYY-MM")],
    month_to: Annotated[str, Query(alias="to", pattern=MONTH_PATTERN, description="YYYY-MM")],
) -> ReportData:
    """Whole months, e.g. from=2026-04&to=2026-09 (always computed live)."""
    return service.build_report(db, _period(lambda: rm.month_range_period(_first_day(month_from), _first_day(month_to), today)), today, now)


@router.get("/financial-year")
def financial_year(fy: Annotated[int, Query(ge=2000, le=2100, description="Starting year: 2025 = FY 2025–26 (1 Apr 2025 – 31 Mar 2026)")],
                   db: DbSession, today: Today, now: Now) -> ReportData:
    """An Indian financial year, April to March (always computed live)."""
    return service.build_report(db, _period(lambda: rm.financial_year_period(fy, today)), today, now)


@router.get("/yearly")
def yearly(year: Annotated[int, Query(ge=2000, le=2100)], db: DbSession, today: Today, now: Now) -> ReportData:
    """A calendar year (always computed live)."""
    return service.build_report(db, _period(lambda: rm.yearly_period(year, today)), today, now)


# ---- PDF downloads -----------------------------------------------------------------------------


def _pdf(report: ReportData, printed_at: datetime) -> Response:
    """The PDF is built fully in memory (ReportLab writes the cross-reference table last, so it
    can't be sent before it's finished) and returned in one response — never written to disk."""
    return Response(
        content=render_report_pdf(report, printed_at=printed_at),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{pdf_filename(report)}"',
            "Cache-Control": "no-store",  # personal financial data: don't keep copies in caches
        },
    )


@router.get("/monthly/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def monthly_pdf(month: Month, db: DbSession, today: Today, now: Now) -> Response:
    report = _period(lambda: service.monthly_report(db, _first_day(month), today, now))
    db.commit()
    return _pdf(report, now)


@router.get("/range/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def range_pdf(
    db: DbSession,
    today: Today,
    now: Now,
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> Response:
    return _pdf(service.build_report(db, _period(lambda: rm.range_period(date_from, date_to, today)), today, now), now)


@router.get("/months/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def month_range_pdf(
    db: DbSession,
    today: Today,
    now: Now,
    month_from: Annotated[str, Query(alias="from", pattern=MONTH_PATTERN)],
    month_to: Annotated[str, Query(alias="to", pattern=MONTH_PATTERN)],
) -> Response:
    period = _period(lambda: rm.month_range_period(_first_day(month_from), _first_day(month_to), today))
    return _pdf(service.build_report(db, period, today, now), now)


@router.get("/financial-year/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def financial_year_pdf(fy: Annotated[int, Query(ge=2000, le=2100)], db: DbSession, today: Today, now: Now) -> Response:
    return _pdf(service.build_report(db, _period(lambda: rm.financial_year_period(fy, today)), today, now), now)


@router.get("/yearly/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def yearly_pdf(year: Annotated[int, Query(ge=2000, le=2100)], db: DbSession, today: Today, now: Now) -> Response:
    return _pdf(service.build_report(db, _period(lambda: rm.yearly_period(year, today)), today, now), now)
