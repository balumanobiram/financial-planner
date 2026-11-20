"""Logo upload: the image travels as base64 in JSON, like statement imports (never touches disk)."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.services.logos import MAX_UPLOAD_BYTES

# base64 makes 3 bytes into 4 characters.
MAX_BASE64_CHARS = (MAX_UPLOAD_BYTES + 2) // 3 * 4


class LogoUpload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    content_base64: Annotated[str, Field(min_length=1, max_length=MAX_BASE64_CHARS)]
