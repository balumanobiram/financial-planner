"""Domain exceptions. Services raise these; app.main maps them to HTTP status codes."""


class DomainError(Exception):
    """Base class for expected business-rule failures."""


class NotFoundError(DomainError):
    """→ 404"""


class ConflictError(DomainError):
    """→ 409: the request is valid but conflicts with current state."""


class ArchivedAccountError(ConflictError):
    """Raised when trying to change an archived account."""
