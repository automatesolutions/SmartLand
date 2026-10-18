"""Turns a place name into coordinates with OpenStreetMap Nominatim, and looks
up ground elevation with Open-Meteo. Falls back to the reference list when
Nominatim can't be reached."""

import asyncio
import os

from loguru import logger

from reference import find_region, match_locality, nearest

from .http import TTLCache, client

NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
NOMINATIM_REVERSE_URL = NOMINATIM_URL.rsplit("/search", 1)[0] + "/reverse"
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"

_geo_cache = TTLCache(ttl_seconds=7 * 24 * 3600)
_elev_cache = TTLCache(ttl_seconds=30 * 24 * 3600)
# Nominatim allows one request per second
_nominatim_lock = asyncio.Lock()


def _place_from_nominatim(hit: dict) -> dict:
    addr = hit.get("address", {})
    locality = addr.get("city") or addr.get("town") or addr.get("municipality") or addr.get("village")
    barangay = addr.get("quarter") or addr.get("village") or addr.get("suburb") or addr.get("neighbourhood")
    if barangay == locality:
        barangay = None
    province = addr.get("province") or addr.get("state")
    if province == addr.get("region") or (addr.get("region") == "Metro Manila"):
        province = None
    lat, lon = float(hit["lat"]), float(hit["lon"])
    region = find_region(addr.get("region") or addr.get("state"), lat, lon)
    return {
        "name": hit.get("name") or locality or hit.get("display_name", "").split(",")[0],
        "display_name": hit.get("display_name"),
        "barangay": barangay,
        "locality": locality,
        "province": province or ("Metro Manila" if region and region.name == "Metro Manila" else None),
        "region": region.name if region else addr.get("region"),
        "lat": lat,
        "lon": lon,
        # A whole city or town rather than a spot inside one
        "kind": "center" if hit.get("addresstype") in ("city", "town", "municipality") else "site",
        "source": "openstreetmap",
    }


async def geocode(query: str) -> dict | None:
    key = query.strip().lower()
    cached = _geo_cache.get(key)
    if cached is not None:
        return cached

    params = {"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "ph", "addressdetails": 1}
    if os.getenv("NOMINATIM_EMAIL"):
        params["email"] = os.getenv("NOMINATIM_EMAIL")
    place = None
    try:
        async with _nominatim_lock:
            res = await client().get(NOMINATIM_URL, params=params, timeout=10)
            await asyncio.sleep(1)
        res.raise_for_status()
        hits = res.json()
        if hits:
            place = _place_from_nominatim(hits[0])
    except Exception as e:
        logger.warning(f"Nominatim lookup failed for {query!r}: {e}")

    if place is None:
        ref = match_locality(query)
        if ref:
            place = {
                "name": ref.locality,
                "display_name": f"{ref.locality}, {ref.province}, Philippines",
                "barangay": None,
                "locality": ref.locality,
                "province": ref.province,
                "region": ref.region,
                "lat": ref.lat,
                "lon": ref.lon,
                "kind": "center",
                "source": "reference",
            }

    if place:
        _geo_cache.set(key, place)
    return place


async def reverse(lat: float, lon: float) -> dict | None:
    """Names the spot someone pinned on the map. The pin keeps its own
    coordinates, since the address Nominatim returns can sit a street away.
    Returns None when the point is outside the Philippines."""
    key = f"rev:{lat:.4f},{lon:.4f}"
    cached = _geo_cache.get(key)
    if cached is not None:
        return cached

    params = {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 17, "addressdetails": 1}
    if os.getenv("NOMINATIM_EMAIL"):
        params["email"] = os.getenv("NOMINATIM_EMAIL")
    place = None
    try:
        async with _nominatim_lock:
            res = await client().get(NOMINATIM_REVERSE_URL, params=params, timeout=10)
            await asyncio.sleep(1)
        res.raise_for_status()
        hit = res.json()
        if hit.get("error"):
            # Nominatim has no address for open water
            return None
        if hit.get("address", {}).get("country_code") != "ph":
            return None
        place = _place_from_nominatim(hit)
    except Exception as e:
        logger.warning(f"Nominatim reverse lookup failed for {key}: {e}")

    if place is None:
        ref, _ = nearest(lat, lon, 1)[0]
        place = {
            "name": f"Near {ref.locality}",
            "display_name": f"Near {ref.locality}, {ref.province}, Philippines",
            "barangay": None,
            "locality": ref.locality,
            "province": ref.province,
            "region": ref.region,
            "source": "reference",
        }

    place.update(lat=lat, lon=lon, kind="site", pinned=True)
    _geo_cache.set(key, place)
    return place


async def search_near(query: str, lat: float, lon: float, span: float = 0.4) -> dict | None:
    """First Nominatim match for a named place within `span` degrees of a point.
    Used to put offices such as the city hall on the map."""
    key = f"near:{query.lower()}:{lat:.2f},{lon:.2f}:{span}"
    cached = _geo_cache.get(key)
    if cached is not None:
        return cached or None

    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 1,
        "countrycodes": "ph",
        "viewbox": f"{lon - span},{lat + span},{lon + span},{lat - span}",
        "bounded": 1,
    }
    if os.getenv("NOMINATIM_EMAIL"):
        params["email"] = os.getenv("NOMINATIM_EMAIL")
    try:
        async with _nominatim_lock:
            res = await client().get(NOMINATIM_URL, params=params, timeout=10)
            await asyncio.sleep(1)
        res.raise_for_status()
        hits = res.json()
    except Exception as e:
        logger.warning(f"Nominatim search failed for {query!r}: {e}")
        return None

    hit = None
    if hits:
        h = hits[0]
        hit = {"name": h.get("name") or query, "address": h.get("display_name"), "lat": float(h["lat"]), "lon": float(h["lon"])}
    # Cache misses too ({}), so a town without the office on the map isn't searched again
    _geo_cache.set(key, hit or {})
    return hit


async def elevation(lat: float, lon: float) -> float | None:
    key = f"{lat:.4f},{lon:.4f}"
    cached = _elev_cache.get(key)
    if cached is not None:
        return cached
    try:
        res = await client().get(ELEVATION_URL, params={"latitude": lat, "longitude": lon}, timeout=8)
        res.raise_for_status()
        value = float(res.json()["elevation"][0])
        _elev_cache.set(key, value)
        return value
    except Exception as e:
        logger.warning(f"Elevation lookup failed for {key}: {e}")
        return None
