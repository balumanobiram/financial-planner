"""Domain exceptions. Services raise these; app.main maps them to HTTP status codes."""


class DomainError(Exception):
    """Base class for expected business-rule failures."""


class NotFoundError(DomainError):
    """→ 404"""


class ConflictError(DomainError):
    """→ 409: the request is valid but conflicts with current state."""


class ArchivedError(ConflictError):
    """Raised when trying to change an archived account, card, person, ..."""


class ArchivedAccountError(ArchivedError):
    """Raised when trying to change an archived bank account."""


class InvalidInputError(DomainError):
    """→ 422: the request is well-formed but breaks a business rule (e.g. shares exceed the spend)."""
