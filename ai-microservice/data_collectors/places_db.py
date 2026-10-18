"""Reads data/places_ph.sqlite, the local copy of Overture Maps Places built by
etl/build_places.py. Lookups take milliseconds, so the "What's nearby" card
doesn't wait on a remote service for them.

When the file is missing (not built yet), every lookup returns an empty list
and the card uses OpenStreetMap alone.
"""

import math
import os
import sqlite3
import threading

from loguru import logger

from reference import haversine_km

PATH = os.getenv("PLACES_DB", os.path.join(os.path.dirname(__file__), "..", "data", "places_ph.sqlite"))

_local = threading.local()
_warned = False


def _db() -> sqlite3.Connection | None:
    global _warned
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    if not os.path.exists(PATH):
        if not _warned:
            logger.warning(f"{PATH} not found; run `python -m etl.build_places`. Nearby places use OpenStreetMap only.")
            _warned = True
        return None
    # Read-only, one connection per thread
    conn = sqlite3.connect(f"file:{os.path.abspath(PATH)}?mode=ro", uri=True, check_same_thread=False)
    _local.conn = conn
    return conn


def available() -> bool:
    return _db() is not None


def release() -> str | None:
    db = _db()
    if db is None:
        return None
    row = db.execute("SELECT value FROM meta WHERE key = 'release'").fetchone()
    return row[0] if row else None


def near(kind: str, lat: float, lon: float, radius_km: float) -> list[dict]:
    """Places of one kind within radius_km, nearest first"""
    db = _db()
    if db is None:
        return []
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    rows = db.execute(
        "SELECT name, lat, lon, address FROM places WHERE kind = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
        (kind, lat - dlat, lat + dlat, lon - dlon, lon + dlon),
    ).fetchall()
    out = []
    for name, plat, plon, address in rows:
        d = haversine_km(lat, lon, plat, plon)
        if d <= radius_km:
            out.append({"name": name, "address": address, "lat": plat, "lon": plon, "distance_km": round(d, 2), "source": "overture"})
    out.sort(key=lambda p: p["distance_km"])
    return out
