"""Which IP a request came from — for the login lockout.

Behind Render's load balancer, request.client.host is the balancer's own address, the same
for everyone. The real address is in X-Forwarded-For, which each proxy APPENDS to:
"<whatever the visitor sent>, …, <address the nearest proxy saw>". Only the rightmost entry
was written by infrastructure we trust; anything to its left can be typed by the visitor.
(uvicorn's --forwarded-allow-ips="*" picks the LEFTMOST entry, which an attacker controls —
so a fresh fake IP per guess would dodge the lockout. Hence this.)
"""

from fastapi import Request


def client_ip(request: Request, *, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
        if forwarded:
            return forwarded[-1]
    return request.client.host if request.client else "unknown"
