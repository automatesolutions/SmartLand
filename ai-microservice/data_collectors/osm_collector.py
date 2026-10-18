"""Measures what's around a point using OpenStreetMap through the Overpass API,
and lists nearby places from OpenStreetMap and the local Overture copy.

One Overpass request per point answers two questions at once:
- the nearest mall, school, hospital and town center, and how built-up the
  area is (used for the scoring factors), and
- the hospitals, supermarkets, malls, and popular chains nearby (the report's
  "What's nearby" card).

The request starts as soon as a place is looked up, so the report usually
finds the answer cached. Requests for the same point share one query, and the
query goes to every working mirror at once; the first good answer wins.
"""

import asyncio
import math
import re
import time

from loguru import logger

from reference import haversine_km

from . import places_db
from .http import TTLCache, client

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
# A mirror that fails is skipped for this long, unless every mirror is down
_MIRROR_BACKOFF_SECONDS = 300
_mirror_down_until: dict[str, float] = {}
# Public mirrors queue each client, so a pin dragged around the map shouldn't
# fire more than a couple of queries at once
_slots = asyncio.Semaphore(2)

# Search radius per amenity type, in meters. Nothing found means "farther than this".
RADII = {"mall": 10000, "school": 4000, "hospital": 20000, "center": 12000}

# "What's nearby": places within `count` meters are counted and listed. Beyond
# that, the nearest one within `search` meters is still reported, so the card
# can say "nearest 7-Eleven: 18 km" instead of a bare 0.
NEARBY = {
    "hospital": {"count": 10000, "search": 20000},
    "school": {"count": 3000, "search": 10000},
    "supermarket": {"count": 5000, "search": 15000},
    "mall": {"count": 10000, "search": 20000},
    "seven_eleven": {"count": 5000, "search": 20000},
    "restaurant": {"count": 2000, "search": 5000},
    "jollibee": {"count": 5000, "search": 20000},
    "mcdonalds": {"count": 5000, "search": 20000},
    "mang_inasal": {"count": 5000, "search": 20000},
    "resort": {"count": 15000, "search": 40000},
    "car_rental": {"count": 10000, "search": 40000},
    "computer_shop": {"count": 5000, "search": 15000},
}
NEARBY_LIMIT = 5

# Chains by Wikidata ID (the brand:wikidata tag) and the exact brand or name
# spellings mappers use. Exact tags hit Overpass's index; name regexes would
# scan the whole planet and time out.
CHAINS = {
    "seven_eleven": {"wikidata": "Q259340", "names": ["7-Eleven", "7 Eleven", "7-11", "Seven Eleven", "7-ELEVEN"]},
    "mcdonalds": {"wikidata": "Q38076", "names": ["McDonald's", "McDonalds", "Mcdonald's", "McDonald’s"]},
    "jollibee": {"wikidata": "Q37614", "names": ["Jollibee", "JOLLIBEE"]},
    "mang_inasal": {"wikidata": "Q6748573", "names": ["Mang Inasal", "MANG INASAL"]},
}
_CHAIN_BY_WIKIDATA = {c["wikidata"]: kind for kind, c in CHAINS.items()}

_cache = TTLCache(ttl_seconds=7 * 24 * 3600)
_nearby_cache = TTLCache(ttl_seconds=7 * 24 * 3600)
_inflight: dict[str, asyncio.Task] = {}


def _key(lat: float, lon: float) -> str:
    # About 110 m, so small pin nudges reuse the same answer
    return f"{lat:.3f},{lon:.3f}"


def _query(lat: float, lon: float) -> str:
    r = RADII
    p = f"{lat},{lon}"
    chain_r = max(NEARBY[k]["search"] for k in CHAINS)
    chains = []
    for c in CHAINS.values():
        chains.append(f'nwr["brand:wikidata"="{c["wikidata"]}"](around:{chain_r},{p});')
        for name in c["names"]:
            chains.append(f'nwr["brand"="{name}"](around:{chain_r},{p});')
            chains.append(f'nwr["name"="{name}"](around:{chain_r},{p});')
    chain_lines = "\n  ".join(chains)
    return f"""
[out:json][timeout:50];
(
  nwr["shop"="mall"](around:{r['mall']},{p});
  nwr["shop"="department_store"](around:{r['mall']},{p});
  nwr["amenity"="hospital"](around:{r['hospital']},{p});
  nwr["amenity"="school"](around:{r['school']},{p});
  nwr["amenity"="college"](around:{r['school']},{p});
  nwr["amenity"="townhall"](around:{r['center']},{p});
  nwr["amenity"="marketplace"](around:{r['center']},{p});
  nwr["shop"="supermarket"](around:{NEARBY['supermarket']['search']},{p});
  {chain_lines}
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
    """Kind used for the scoring factors"""
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


def _nearby_kind(tags: dict) -> str | None:
    """Kind used for the "What's nearby" card. Chains win over shop type, so a
    7-Eleven isn't also listed as a supermarket."""
    chain = _CHAIN_BY_WIKIDATA.get(tags.get("brand:wikidata", ""))
    if chain:
        return chain
    label = f"{tags.get('brand', '')} {tags.get('name', '')}".lower().replace("’", "'")
    if "7-eleven" in label or "7 eleven" in label or "7-11" in label or "seven eleven" in label:
        return "seven_eleven"
    if "jollibee" in label:
        return "jollibee"
    if "mcdonald" in label:
        return "mcdonalds"
    if "mang inasal" in label:
        return "mang_inasal"
    if tags.get("amenity") == "hospital":
        return "hospital"
    if tags.get("amenity") in ("school", "college"):
        return "school"
    if tags.get("shop") == "supermarket":
        return "supermarket"
    if tags.get("shop") in ("mall", "department_store"):
        return "mall"
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


def _point(el: dict) -> dict | None:
    return el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)


def _parse_measure(elements: list[dict], counts: list[int], lat: float, lon: float) -> dict:
    nearest: dict[str, dict] = {}
    for el in elements:
        kind = _kind(el.get("tags", {}))
        point = _point(el)
        if not kind or not point:
            continue
        d = haversine_km(lat, lon, point["lat"], point["lon"])
        if d * 1000 > RADII[kind]:
            continue
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


def _words(name: str | None) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (name or "").lower().replace("’", "'")))


def _same_place(a: dict, b: dict) -> bool:
    """The same branch is often mapped twice: as a point and as a building, or
    once in each dataset with slightly different names ("Cabadbaran District
    Hospital" and "Cabadbaran City District Hospital")"""
    gap = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
    if gap < 0.04:
        return True
    wa, wb = _words(a["name"]), _words(b["name"])
    if not wa or not wb or gap > 0.3:
        return False
    # Most of the words in common
    return len(wa & wb) / len(wa | wb) >= 0.6


def _osm_nearby(elements: list[dict], lat: float, lon: float) -> dict[str, list[dict]]:
    """OpenStreetMap's places per kind, within each kind's search radius"""
    found: dict[str, list[dict]] = {k: [] for k in NEARBY}
    for el in elements:
        tags = el.get("tags", {})
        kind = _nearby_kind(tags)
        point = _point(el)
        if not kind or not point:
            continue
        d = haversine_km(lat, lon, point["lat"], point["lon"])
        if d * 1000 > NEARBY[kind]["search"]:
            continue
        street = " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")]))
        place = {
            "name": tags.get("name") or tags.get("brand") or None,
            "address": street or tags.get("addr:city") or None,
            "lat": point["lat"],
            "lon": point["lon"],
            "distance_km": round(d, 2),
            "source": "openstreetmap",
        }
        if not any(_same_place(place, p) for p in found[kind]):
            found[kind].append(place)
    return found


def _categories(osm: dict[str, list[dict]] | None, lat: float, lon: float) -> dict:
    """Merges OpenStreetMap with the local Overture copy, which has many branches
    OSM is missing (most 7-Elevens outside big cities, for one). OSM comes first
    when both have a place, since its positions are usually hand-placed."""
    categories = {}
    for kind, spec in NEARBY.items():
        places = list((osm or {}).get(kind, []))
        for extra in places_db.near(kind, lat, lon, spec["search"] / 1000):
            if not any(_same_place(extra, p) for p in places):
                places.append(extra)
        places.sort(key=lambda p: p["distance_km"])
        within = [p for p in places if p["distance_km"] * 1000 <= spec["count"]]
        categories[kind] = {
            "count": len(within),
            "radius_km": spec["count"] / 1000,
            "places": within[:NEARBY_LIMIT],
            # Nearest one even when it's outside the count radius
            "nearest": places[0] if places else None,
            "search_km": spec["search"] / 1000,
        }
    return categories


async def _ask(url: str, query: str, timeout: float) -> dict:
    res = await client().post(url, data={"data": query}, timeout=timeout)
    res.raise_for_status()
    data = res.json()
    # Overpass answers 200 with a remark when the query times out or runs out of memory
    remark = data.get("remark") or ""
    if "error" in remark.lower() or "timed out" in remark.lower():
        raise RuntimeError(remark)
    return data


async def _overpass(query: str, label: str, timeout: float = 60) -> dict | None:
    """Sends the query to every mirror that hasn't failed recently and returns
    the first good answer, or None when they all fail."""
    now = time.monotonic()
    urls = [u for u in OVERPASS_MIRRORS if _mirror_down_until.get(u, 0) <= now] or OVERPASS_MIRRORS
    tasks = {asyncio.create_task(_ask(u, query, timeout)): u for u in urls}
    pending = set(tasks)
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                url = tasks[t]
                if t.exception() is None:
                    logger.info(f"Overpass {url} answered for {label}")
                    _mirror_down_until.pop(url, None)
                    return t.result()
                logger.warning(f"Overpass {url} failed for {label}: {t.exception()!r}")
                _mirror_down_until[url] = time.monotonic() + _MIRROR_BACKOFF_SECONDS
        return None
    finally:
        for t in pending:
            t.cancel()


async def _survey(lat: float, lon: float, key: str) -> dict | None:
    try:
        async with _slots:
            data = await _overpass(_query(lat, lon), key)
        return _store(data, lat, lon, key) if data is not None else None
    except Exception as e:
        logger.error(f"Overpass survey failed for {key}: {e!r}")
        return None


def _store(data: dict, lat: float, lon: float, key: str) -> dict:
    elements, counts = [], []
    for el in data.get("elements", []):
        if el.get("type") == "count":
            counts.append(int(el.get("tags", {}).get("total", 0)))
        else:
            elements.append(el)
    result = {"measure": _parse_measure(elements, counts, lat, lon), "nearby": _categories(_osm_nearby(elements, lat, lon), lat, lon)}
    _cache.set(key, result["measure"])
    _nearby_cache.set(key, result["nearby"])
    return result


def _survey_task(lat: float, lon: float) -> asyncio.Task:
    """The one in-flight survey for this point, started if needed"""
    key = _key(lat, lon)
    task = _inflight.get(key)
    if task is None:
        task = asyncio.create_task(_survey(lat, lon, key))
        _inflight[key] = task
        task.add_done_callback(lambda _: _inflight.pop(key, None))
    return task


async def collect(lat: float, lon: float, budget: float | None = None) -> dict | None:
    """Amenity distances and an infrastructure score. Waits at most `budget`
    seconds; the survey keeps running after that, so the report's nearby list
    still gets cached. Returns None when it isn't ready or every mirror fails."""
    cached = _cache.get(_key(lat, lon))
    if cached is not None:
        return cached
    try:
        result = await asyncio.wait_for(asyncio.shield(_survey_task(lat, lon)), budget)
    except TimeoutError:
        logger.info(f"Overpass not back within {budget}s for {_key(lat, lon)}; using estimates")
        return None
    return result["measure"] if result else None


async def nearby(lat: float, lon: float, budget: float = 2) -> dict | None:
    """Schools, hospitals, shops, food, and more around a point, nearest first.

    Joins the survey /locate started, if it's still running. If OpenStreetMap
    isn't back within `budget` seconds, answers at once from the local Overture
    copy with partial=True; the survey keeps going, so asking again shortly gets
    the full answer. None only when both sources fail.
    Returns {"categories": {...}, "partial": bool}."""
    cached = _nearby_cache.get(_key(lat, lon))
    if cached is not None:
        return {"categories": cached, "partial": False}
    task = _survey_task(lat, lon)
    try:
        result = await asyncio.wait_for(asyncio.shield(task), budget if places_db.available() else None)
    except TimeoutError:
        return {"categories": _categories(None, lat, lon), "partial": True}
    if result:
        return {"categories": result["nearby"], "partial": False}
    # Every Overpass mirror failed: Overture alone is still a good answer
    return {"categories": _categories(None, lat, lon), "partial": False} if places_db.available() else None
