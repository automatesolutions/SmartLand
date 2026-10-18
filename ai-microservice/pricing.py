"""Location-aware price and growth model.

Price works like a comparable-sales estimate:
1. Take the five reference localities closest to the point and average their
   prices in log space, weighted by inverse squared distance.
2. The farther the point is from the nearest town center, the more the
   estimate falls toward a rural floor.
3. Adjust for the site: better roads and closer amenities than typical for
   that distance raise the price, worse ones lower it (bounded to -25%/+30%).

Growth is a weighted score of infrastructure, the regional economy,
population growth, access, hazard, and news tone.
"""

import math

from reference import LOCALITIES, RefLocality, nearest

# What a lot at the center of each tier usually has
TIER_TYPICAL = {
    "cbd": {"infrastructure_score": 9.5, "proximity_to_mall": 1.0, "proximity_to_school": 0.8, "proximity_to_hospital": 1.5, "distance_to_amenities": 1.5},
    "metro": {"infrastructure_score": 8.5, "proximity_to_mall": 2.0, "proximity_to_school": 1.0, "proximity_to_hospital": 2.5, "distance_to_amenities": 2.0},
    "city": {"infrastructure_score": 7.0, "proximity_to_mall": 3.0, "proximity_to_school": 1.5, "proximity_to_hospital": 3.0, "distance_to_amenities": 2.5},
    "town": {"infrastructure_score": 5.5, "proximity_to_mall": 8.0, "proximity_to_school": 2.0, "proximity_to_hospital": 8.0, "distance_to_amenities": 3.0},
}
# Slider limits in the web app (frontend/src/lib/presets.ts)
LIMITS = {"infrastructure_score": 10, "proximity_to_mall": 30, "proximity_to_school": 20, "proximity_to_hospital": 30, "distance_to_amenities": 30}

RURAL_LOW, RURAL_HIGH = 300.0, 2500.0
RURAL_MID = math.sqrt(RURAL_LOW * RURAL_HIGH)
# Floor for the center of a town that has no reference price of its own
TOWN_LOW, TOWN_HIGH = 1500.0, 6000.0
TOWN_MID = math.sqrt(TOWN_LOW * TOWN_HIGH)

# Log-price change per unit above what's typical
SITE_WEIGHTS = {
    "infrastructure_score": 0.06,
    "proximity_to_mall": -0.015,
    "proximity_to_school": -0.02,
    "proximity_to_hospital": -0.01,
    "distance_to_amenities": -0.02,
}


def baseline_for(tier: str, km_from_ref: float, is_center: bool) -> tuple[str, float]:
    """Tier and distance to judge a point against. A town center far from any
    reference locality is its own center, not an empty lot in between."""
    if is_center and km_from_ref > 5:
        return "town", 0.0
    return tier, km_from_ref


def typical_factors(tier: str, km_from_center: float) -> dict:
    """Expected site factors for a lot `km_from_center` away from a reference locality."""
    t = TIER_TYPICAL.get(tier, TIER_TYPICAL["town"])
    d = max(0.0, km_from_center)
    est = {
        "infrastructure_score": max(1.5, t["infrastructure_score"] - 0.25 * d),
        "proximity_to_mall": t["proximity_to_mall"] + 0.8 * d,
        "proximity_to_school": min(6.0, t["proximity_to_school"] + 0.1 * d),
        "proximity_to_hospital": t["proximity_to_hospital"] + 0.8 * d,
        "distance_to_amenities": t["distance_to_amenities"] + 0.8 * d,
    }
    return {k: round(min(LIMITS[k], v), 1) for k, v in est.items()}


def _weighted_log(neigh: list[tuple[RefLocality, float]], attr: str) -> float:
    weights = [1 / (d + 3) ** 2 for _, d in neigh]
    values = [math.log(getattr(r, attr)) for r, _ in neigh]
    return sum(w * v for w, v in zip(weights, values)) / sum(weights)


def _site_multiplier(factors: dict, typical: dict) -> float:
    m = sum(w * (factors.get(k, typical[k]) - typical[k]) for k, w in SITE_WEIGHTS.items())
    return min(1.3, max(0.75, math.exp(m)))


def estimate_price(factors: dict, lat: float | None, lon: float | None, measured: bool, is_center: bool = False) -> dict:
    if lat is None or lon is None:
        # No location: national town-tier median, adjusted for the site
        towns = sorted(r.price_mid for r in LOCALITIES if r.tier == "town")
        mid = towns[len(towns) // 2]
        mult = _site_multiplier(factors, typical_factors("town", 0))
        return {
            "price": round(mid * mult, -1),
            "low": round(mid * 0.6 * mult, -1),
            "high": round(mid * 1.6 * mult, -1),
            "confidence": "low",
            "comps": [],
        }

    neigh = nearest(lat, lon, 5)
    closest, d0 = neigh[0]
    log_mid, log_low, log_high = (_weighted_log(neigh, a) for a in ("price_mid", "price_low", "price_high"))

    # Fall toward the rural floor beyond 4 km from the closest town center
    keep = max(0.1, math.exp(-max(0.0, d0 - 4) / 18))

    floor_low, floor_mid, floor_high = (TOWN_LOW, TOWN_MID, TOWN_HIGH) if is_center else (RURAL_LOW, RURAL_MID, RURAL_HIGH)

    def blend(log_value: float, floor: float) -> float:
        return math.exp(math.log(floor) + (log_value - math.log(floor)) * keep)

    mult = _site_multiplier(factors, typical_factors(*baseline_for(closest.tier, d0, is_center)))
    price, low, high = (blend(log_mid, floor_mid) * mult, blend(log_low, floor_low) * mult, blend(log_high, floor_high) * mult)

    confidence = "high" if d0 <= 8 and measured else "medium" if d0 <= 25 else "low"
    comps = [
        {
            "name": r.locality,
            "province": r.province,
            "lat": r.lat,
            "lon": r.lon,
            "distance_km": round(d, 1),
            "price_low": r.price_low,
            "price_high": r.price_high,
        }
        for r, d in neigh
    ]
    return {"price": round(price, -1), "low": round(low, -1), "high": round(high, -1), "confidence": confidence, "comps": comps}


def growth_score(factors: dict, news_sentiment: str = "neutral") -> float:
    score = (
        20
        + factors["infrastructure_score"] * 3
        + factors["gdp_growth"] * 3
        + factors["population_growth"] * 4
        - factors["typhoon_risk"] * 2
    )
    if factors["proximity_to_mall"] < 3:
        score += 6
    if factors["proximity_to_school"] < 2:
        score += 3
    if factors["proximity_to_hospital"] < 3:
        score += 3
    if factors["distance_to_amenities"] < 3:
        score += 3
    score += {"positive": 5, "negative": -5}.get(news_sentiment, 0)
    return round(max(0.0, min(100.0, score)), 1)


def category(score: float) -> str:
    if score > 80:
        return "A+ (Prime Investment)"
    if score > 60:
        return "A to B+ (High Growth)"
    if score > 40:
        return "B to C (Moderate Growth)"
    return "C- (High Risk)"


def flood_adjusted_risk(regional_typhoon: float, elevation_m: float | None) -> float:
    """Regional typhoon exposure, raised for low ground where flooding is likelier."""
    risk = regional_typhoon
    if elevation_m is not None:
        if elevation_m < 5:
            risk += 1.5
        elif elevation_m < 15:
            risk += 0.75
        elif elevation_m > 300:
            risk -= 0.5
    return round(max(0.0, min(10.0, risk)), 1)
