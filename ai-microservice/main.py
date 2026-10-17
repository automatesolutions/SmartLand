import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from loguru import logger
from pydantic import BaseModel

import pricing
from data_collectors import geocoder, http, news_collector, osm_collector
from reference import LOCALITIES, find_region, nearest

load_dotenv()

# Logging setup
logger.add("ai_error.log", level="ERROR")
logger.add("ai_combined.log", level="INFO")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await http.close()


app = FastAPI(title="SmartLand AI Microservice", version="2.0.0", lifespan=lifespan)

FACTOR_KEYS = [
    "infrastructure_score",
    "typhoon_risk",
    "gdp_growth",
    "population_growth",
    "proximity_to_mall",
    "proximity_to_school",
    "proximity_to_hospital",
    "distance_to_amenities",
]
AMENITY_FACTOR = {
    "mall": "proximity_to_mall",
    "school": "proximity_to_school",
    "hospital": "proximity_to_hospital",
    "center": "distance_to_amenities",
}


def extract_news_insights(news_text: str) -> dict:
    """Keyword scan of news text: what kind of projects, and whether the tone is good or bad"""
    if not news_text:
        return {"sentiment": "neutral", "entities": [], "insights": []}

    news_lower = news_text.lower()
    insights = []
    if any(word in news_lower for word in ["infrastructure", "development", "project"]):
        insights.append("News mentions infrastructure projects")
    if any(word in news_lower for word in ["airport", "transportation", "railway", "expressway", "bridge", "road"]):
        insights.append("News mentions transport projects")
    if any(word in news_lower for word in ["mall", "commercial", "business", "economic zone"]):
        insights.append("News mentions commercial projects")
    if any(word in news_lower for word in ["school", "education", "university"]):
        insights.append("News mentions new schools")
    if any(word in news_lower for word in ["hospital", "medical", "healthcare"]):
        insights.append("News mentions new hospitals")
    if any(word in news_lower for word in ["flood", "landslide", "storm surge"]):
        insights.append("News mentions flooding or landslides")

    positive_words = ["announced", "investment", "growth", "development", "new", "expansion", "opens", "approved", "completed"]
    negative_words = ["delay", "cancelled", "canceled", "problem", "issue", "concern", "flood", "landslide", "damage", "stalled"]
    positive_count = sum(1 for word in positive_words if word in news_lower)
    negative_count = sum(1 for word in negative_words if word in news_lower)

    if positive_count > negative_count:
        sentiment = "positive"
    elif negative_count > positive_count:
        sentiment = "negative"
    else:
        sentiment = "neutral"

    return {"sentiment": sentiment, "entities": [], "insights": insights}


def composite_scores(f: dict) -> dict:
    """0 to 10 summaries shown on the report"""
    return {
        "amenity_score": round(
            max(0, 10 - f["proximity_to_mall"]) * 0.4
            + max(0, 10 - f["proximity_to_school"]) * 0.3
            + max(0, 10 - f["proximity_to_hospital"]) * 0.3,
            2,
        ),
        "economic_score": round(min(10, f["population_growth"] * 0.4 + f["gdp_growth"] * 0.6), 2),
        "risk_score": round(f["typhoon_risk"] * 0.7 + (10 - f["infrastructure_score"]) * 0.3, 2),
    }


@app.get("/locate")
async def locate(q: str = Query(min_length=2, max_length=200)):
    """Finds a place and fills in the scoring factors from map, elevation, regional, and news data"""
    place = await geocoder.geocode(q)
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    lat, lon = place["lat"], place["lon"]
    news_place = place.get("locality") or place["name"]
    osm, elev, articles = await asyncio.gather(
        osm_collector.collect(lat, lon),
        geocoder.elevation(lat, lon),
        news_collector.headlines(news_place, place.get("province")),
    )

    closest, d0 = nearest(lat, lon, 1)[0]
    typical = pricing.typical_factors(*pricing.baseline_for(closest.tier, d0, place.get("kind") == "center"))
    region = find_region(place.get("region"), lat, lon)

    factors: dict[str, float] = {}
    sources: dict[str, str] = {}
    for key in ("infrastructure_score", *AMENITY_FACTOR.values()):
        factors[key], sources[key] = typical[key], "estimate"

    amenities = []
    if osm:
        factors["infrastructure_score"], sources["infrastructure_score"] = osm["infrastructure_score"], "openstreetmap"
        for kind, key in AMENITY_FACTOR.items():
            hit = osm["nearest"].get(kind)
            if hit:
                factors[key] = round(min(pricing.LIMITS[key], hit["distance_km"]), 1)
                amenities.append(hit)
            else:
                # Nothing inside the search radius, so it's at least that far
                factors[key] = round(min(pricing.LIMITS[key], osm["radii_km"][kind] * 1.2), 1)
            sources[key] = "openstreetmap"

    if region:
        factors["gdp_growth"], factors["population_growth"] = region.gdp_growth, region.population_growth
        factors["typhoon_risk"] = pricing.flood_adjusted_risk(region.typhoon_risk, elev)
        sources.update(gdp_growth="region", population_growth="region", typhoon_risk="region")
    else:
        factors.update(gdp_growth=5.0, population_growth=1.5, typhoon_risk=5.0)
        sources.update(gdp_growth="estimate", population_growth="estimate", typhoon_risk="estimate")

    headline_text = " ".join(a["title"] for a in articles)
    return {
        "place": {**place, "region": region.name if region else place.get("region"), "elevation_m": elev},
        "factors": factors,
        "sources": sources,
        "amenities": amenities,
        "osm_counts": osm["counts"] if osm else None,
        "news": {"articles": articles, "analysis": extract_news_insights(headline_text)},
    }


class PredictionRequest(BaseModel):
    distance_to_amenities: float = 0
    population_growth: float = 0
    gdp_growth: float = 0
    infrastructure_score: float = 0
    typhoon_risk: float = 0
    proximity_to_mall: float = 5
    proximity_to_school: float = 3
    proximity_to_hospital: float = 4
    news_text: str = ""
    # Coordinates from /locate. Without them the price falls back to a national estimate.
    lat: float | None = None
    lon: float | None = None
    measured: bool = False
    # "center" when the location is a whole city or town, "site" for a spot inside one
    place_kind: str = "site"


@app.post("/predict")
async def predict(request: PredictionRequest):
    """Scores price and growth for one location"""
    try:
        data = request.model_dump()
        factors = {k: float(data[k]) for k in FACTOR_KEYS}
        news = extract_news_insights(request.news_text)
        price = pricing.estimate_price(factors, request.lat, request.lon, request.measured, request.place_kind == "center")
        growth = pricing.growth_score(factors, news["sentiment"])
        cat = pricing.category(growth)

        result = {
            "predicted_price_sqm": price["price"],
            "price_low": price["low"],
            "price_high": price["high"],
            "confidence": price["confidence"],
            "comps": price["comps"],
            "category": cat,
            "growth_score": growth,
            "insights": generate_insights(price, growth, news, factors),
            "news_analysis": news,
            "feature_analysis": {**factors, **composite_scores(factors)},
            "method": "comparables-v1",
        }
        logger.info(f"Prediction completed: {cat} - {result['predicted_price_sqm']} PHP/sqm ({price['confidence']})")
        return result
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


def generate_insights(price: dict, growth_score: float, news_insights: dict, data: dict) -> str:
    """Plain-language reasons behind the result"""
    insights = []

    p = price["price"]
    if p > 100000:
        insights.append("Prime city prices. Most of the value is in the location")
    elif p > 30000:
        insights.append("City prices with steady demand")
    elif p > 8000:
        insights.append("Suburban prices with room to rise")
    elif p > 2000:
        insights.append("Provincial prices. Growth depends on new roads and jobs")
    else:
        insights.append("Rural prices. Check road access, water, and power before you buy")

    if price["comps"]:
        c = price["comps"][0]
        if c["distance_km"] < 1:
            insights.append(f"Inside {c['name']}, one of our reference areas")
        else:
            insights.append(f"Closest reference area is {c['name']}, {c['distance_km']:g} km away")
    if price["confidence"] == "low":
        insights.append("Few reference prices nearby, so check this estimate against local listings")

    if growth_score > 80:
        insights.append("Very strong growth signals")
    elif growth_score > 60:
        insights.append("Strong growth signals")
    elif growth_score > 40:
        insights.append("Moderate growth. Better for long holds")
    else:
        insights.append("Weak growth signals. Check the area carefully before you buy")

    if data.get("gdp_growth", 0) > 5:
        insights.append("The regional economy is growing fast")
    if data.get("population_growth", 0) > 2:
        insights.append("More people are moving in, which raises demand")

    if data.get("infrastructure_score", 0) > 7:
        insights.append("Good roads and utilities support prices")
    elif data.get("infrastructure_score", 0) < 4:
        insights.append("Roads and utilities are still lacking. Watch for planned projects")

    if data.get("typhoon_risk", 0) > 6:
        insights.append("High typhoon and flood risk. Budget for insurance and stronger construction")

    if news_insights.get("insights"):
        insights.extend(news_insights["insights"])

    return " | ".join(insights) if insights else "No strong signals either way"


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy", "reference_localities": len(LOCALITIES), "timestamp": datetime.now().isoformat()}


@app.get("/models/info")
async def models_info():
    """What the service uses to score a location"""
    return {
        "price_model": "Comparables: inverse-distance weighting over reference localities, with a site adjustment",
        "growth_model": "Weighted score of infrastructure, economy, access, hazard, and news tone",
        "data_sources": ["OpenStreetMap Nominatim", "OpenStreetMap Overpass", "Open-Meteo elevation", "Google News RSS"],
        "reference_localities": len(LOCALITIES),
        "version": "comparables-v1",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8002)
