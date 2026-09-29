"""Client IP for rate limits. Trust Fly's proxy header, not a caller-supplied forward."""

from __future__ import annotations


def client_ip(request) -> str:
    fly_ip = (request.headers.get("fly-client-ip") or "").strip()
    if fly_ip:
        return fly_ip
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    return host or "unknown"
