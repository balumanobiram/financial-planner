"""Route registry. Anything under `protected_router` requires a valid Bearer token.

Add new feature routers to `protected_router` — they are secured automatically.
"""

from fastapi import APIRouter, Depends

from app.api import accounts, auth, cards, categories, health, imports, people, transactions
from app.api.deps import require_user

public_router = APIRouter()
public_router.include_router(health.router)
public_router.include_router(auth.public_router)

protected_router = APIRouter(dependencies=[Depends(require_user)])
protected_router.include_router(auth.router)
protected_router.include_router(accounts.router)
protected_router.include_router(cards.router)
protected_router.include_router(people.router)
protected_router.include_router(categories.router)
protected_router.include_router(transactions.router)
protected_router.include_router(imports.router)
