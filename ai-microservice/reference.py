"""Reference data shipped with the service: indicative land prices per locality
and regional figures. Both live in data/ as CSV so they can be corrected
without touching code. See README.md for where the numbers come from."""

import csv
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


@dataclass(frozen=True)
class RefLocality:
    locality: str
    province: str
    region: str
    lat: float
    lon: float
    tier: str  # cbd | metro | city | town
    price_low: float
    price_high: float

    @property
    def price_mid(self) -> float:
        # Geometric mean: price ranges are skewed, so this sits closer to typical lots
        return math.sqrt(self.price_low * self.price_high)


@dataclass(frozen=True)
class Region:
    name: str
    aliases: tuple[str, ...]
    typhoon_risk: float
    gdp_growth: float
    population_growth: float


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"\(.*?\)", " ", text.lower())
    text = re.sub(r"\b(city of|city|municipality of|barangay|brgy\.?)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _load_localities() -> list[RefLocality]:
    with open(DATA_DIR / "reference_prices.csv", newline="", encoding="utf-8") as f:
        return [
            RefLocality(
                locality=row["locality"],
                province=row["province"],
                region=row["region"],
                lat=float(row["lat"]),
                lon=float(row["lon"]),
                tier=row["tier"],
                price_low=float(row["price_low"]),
                price_high=float(row["price_high"]),
            )
            for row in csv.DictReader(f)
        ]


def _load_regions() -> list[Region]:
    with open(DATA_DIR / "regions.csv", newline="", encoding="utf-8") as f:
        return [
            Region(
                name=row["region"],
                aliases=tuple(a for a in row["aliases"].split("|") if a),
                typhoon_risk=float(row["typhoon_risk"]),
                gdp_growth=float(row["gdp_growth"]),
                population_growth=float(row["population_growth"]),
            )
            for row in csv.DictReader(f)
        ]


LOCALITIES = _load_localities()
REGIONS = _load_regions()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def nearest(lat: float, lon: float, k: int = 5) -> list[tuple[RefLocality, float]]:
    ranked = sorted(((r, haversine_km(lat, lon, r.lat, r.lon)) for r in LOCALITIES), key=lambda x: x[1])
    return ranked[:k]


def match_locality(query: str) -> RefLocality | None:
    """Offline fallback for geocoding: match the query against the reference list."""
    q = _norm(query)
    if not q:
        return None
    for r in LOCALITIES:
        if _norm(r.locality) == q:
            return r
    # "Lipa, Batangas" or "Sabang, Lipa City": match on any comma-separated part
    for part in (_norm(p) for p in query.split(",")):
        for r in LOCALITIES:
            if part and _norm(r.locality) == part:
                return r
    for r in LOCALITIES:
        name = _norm(r.locality)
        if re.search(rf"\b{re.escape(name)}\b", q):
            return r
    return None


def find_region(name: str | None, lat: float | None = None, lon: float | None = None) -> Region | None:
    if name:
        n = _norm(name)
        for reg in REGIONS:
            if n in (_norm(reg.name), *(_norm(a) for a in reg.aliases)):
                return reg
    if lat is not None and lon is not None:
        # Region of the closest reference locality
        ref, _ = nearest(lat, lon, 1)[0]
        return find_region(ref.region)
    return None
