"""POST /ingest — the iPhone Shortcut sends each bank/UPI/card SMS here.

Public (no login), so it can only *create*: no reading, approving or deleting. It answers
{"ok": true} straight away — also for duplicates and OTPs, so a sender learns nothing — and
parses in the background. The body is read with a hard 4 KB cap before any JSON parsing.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.api.deps import BackgroundSessions, DbSession, Now
from app.core.time import IST
from app.services import sms_inbox

router = APIRouter(tags=["ingest"])

MAX_BODY_BYTES = 4096
CLOCK_SKEW = timedelta(minutes=5)  # a phone clock slightly ahead is fine; further in the future is not


class SmsIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    text: Annotated[str, Field(min_length=1, max_length=1000)]
    sender: Annotated[str, Field(max_length=50)] = ""
    # ISO 8601 from the Shortcut. Optional and forgiving: anything unreadable → the time it arrived.
    received_at: str | None = None

    @field_validator("received_at", mode="before")
    @classmethod
    def _text_only(cls, value: object) -> object:
        return None if value is None else str(value)[:64]

    def received(self, now: datetime) -> datetime:
        try:
            parsed = datetime.fromisoformat(self.received_at or "")
        except ValueError:
            return now
        parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=IST)  # a bare time is India time
        return parsed.astimezone(UTC) if parsed <= now + CLOCK_SKEW else now



async def sms_body(request: Request) -> SmsIn:
    """Read at most 4 KB, then validate. (A dependency, so the route itself can stay sync.)"""
    too_large = HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Body larger than 4 KB")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY_BYTES:
            raise too_large
    try:
        return SmsIn.model_validate_json(bytes(body))
    except ValidationError as exc:
        # include_input=False: never echo the SMS text back (or into any log).
        raise RequestValidationError(exc.errors(include_input=False, include_url=False)) from None


@router.post("/ingest")
def ingest(
    sms: Annotated[SmsIn, Depends(sms_body)], db: DbSession, now: Now, background: BackgroundTasks, sessions: BackgroundSessions
) -> dict[str, bool]:
    sms_id = sms_inbox.store(db, text=sms.text, sender=sms.sender, received_at=sms.received(now))
    db.commit()
    if sms_id:
        background.add_task(sms_inbox.process_safely, sessions, sms_id)
    return {"ok": True}
