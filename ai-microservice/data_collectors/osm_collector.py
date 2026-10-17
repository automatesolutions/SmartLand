"""Measures what's around a point using OpenStreetMap through the Overpass API:
the nearest mall, school, hospital and town center, and how built-up the
area is. One Overpass request per point, cached, with mirror fallback."""

import math
import time

from loguru import logger

from reference import haversine_km

from .http import TTLCache, client

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Search radius per amenity type, in meters. Nothing found means "farther than this".
RADII = {"mall": 15000, "school": 4000, "hospital": 20000, "center": 12000}

_cache = TTLCache(ttl_seconds=7 * 24 * 3600)
# When every mirror fails, skip Overpass for a while instead of waiting on timeouts each time
_BACKOFF_SECONDS = 120
_down_until = 0.0


def _query(lat: float, lon: float) -> str:
    r = RADII
    p = f"{lat},{lon}"
    return f"""
[out:json][timeout:25];
(
  nwr["shop"~"^(mall|department_store)$"](around:{r['mall']},{p});
  nwr["amenity"="hospital"](around:{r['hospital']},{p});
  nwr["amenity"~"^(school|college)$"](around:{r['school']},{p});
  nwr["amenity"~"^(townhall|marketplace)$"](around:{r['center']},{p});
);
out tags center;
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](around:2000,{p});
out count;
way["highway"~"^(residential|unclassified|living_street)$"](around:1000,{p});
out count;
way["building"](around:1000,{p});
out count;
nwr["public_transport"~"^(station|stop_position|platform)$"](around:2000,{p});
out count;
"""


def _kind(tags: dict) -> str | None:
    if tags.get("shop") in ("mall", "department_store"):
        return "mall"
    amenity = tags.get("amenity")
    if amenity == "hospital":
        return "hospital"
    if amenity in ("school", "college"):
        return "school"
    if amenity in ("townhall", "marketplace"):
        return "center"
    return None


def _log_points(value: float, target: float, weight: float) -> float:
    """Up to `weight` points, reaching the max when value hits target."""
    return weight * min(1.0, math.log1p(value) / math.log1p(target))


def infrastructure_score(major_roads: int, local_roads: int, buildings: int, transit: int) -> float:
    """0 to 10. Targets are what a built-up Metro Manila district scores."""
    score = (
        _log_points(major_roads, 40, 3)
        + _log_points(local_roads, 250, 3)
        + _log_points(buildings, 4000, 2)
        + _log_points(transit, 40, 2)
    )
    return round(min(10.0, score), 1)


def _parse(data: dict, lat: float, lon: float) -> dict:
    nearest: dict[str, dict] = {}
    counts: list[int] = []
    for el in data.get("elements", []):
        if el.get("type") == "count":
            counts.append(int(el.get("tags", {}).get("total", 0)))
            continue
        kind = _kind(el.get("tags", {}))
        point = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
        if not kind or not point:
            continue
        d = haversine_km(lat, lon, point["lat"], point["lon"])
        if kind not in nearest or d < nearest[kind]["distance_km"]:
            nearest[kind] = {
                "type": kind,
                "name": el.get("tags", {}).get("name") or None,
                "lat": point["lat"],
                "lon": point["lon"],
                "distance_km": round(d, 2),
            }
    major, local, buildings, transit = (counts + [0, 0, 0, 0])[:4]
    return {
        "nearest": nearest,
        "counts": {"major_roads": major, "local_roads": local, "buildings": buildings, "transit_stops": transit},
        "infrastructure_score": infrastructure_score(major, local, buildings, transit),
        "radii_km": {k: v / 1000 for k, v in RADII.items()},
    }


async def collect(lat: float, lon: float) -> dict | None:
    """Returns amenity distances and an infrastructure score, or None when every mirror fails."""
    global _down_until
    key = f"{lat:.3f},{lon:.3f}"
    cached = _cache.get(key)
    if cached is not None:
        return cached
    if time.monotonic() < _down_until:
        return None
    query = _query(lat, lon)
    for url in OVERPASS_MIRRORS:
        try:
            res = await client().post(url, data={"data": query}, timeout=20)
            res.raise_for_status()
            result = _parse(res.json(), lat, lon)
            _cache.set(key, result)
            logger.info(f"Overpass {url} answered for {key}: infra {result['infrastructure_score']}")
            return result
        except Exception as e:
            logger.warning(f"Overpass {url} failed for {key}: {e!r}")
    _down_until = time.monotonic() + _BACKOFF_SECONDS
    return None
