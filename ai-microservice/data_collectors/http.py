"""Shared HTTP client and a small in-memory cache for the public APIs we call.
Nominatim and Overpass ask callers to identify themselves and not repeat
queries, so every collector goes through here."""

import os
import time
from typing import Any

import httpx

USER_AGENT = os.getenv("SMARTLAND_USER_AGENT", "SmartLand/1.0 (land price estimates; github.com/automatesolutions)")

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=True)
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


class TTLCache:
    def __init__(self, ttl_seconds: float, max_items: int = 500):
        self.ttl = ttl_seconds
        self.max_items = max_items
        self._items: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        hit = self._items.get(key)
        if not hit:
            return None
        stored, value = hit
        if time.monotonic() - stored > self.ttl:
            del self._items[key]
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        if len(self._items) >= self.max_items:
            # Drop the oldest entry
            del self._items[min(self._items, key=lambda k: self._items[k][0])]
        self._items[key] = (time.monotonic(), value)
