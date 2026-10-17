import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from loguru import logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import motor.motor_asyncio
import asyncpg
import jwt
import httpx

import store

load_dotenv()

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://localhost:8002/predict")
AI_BASE_URL = re.sub(r"/predict/?$", "", AI_SERVICE_URL)

# A missing or placeholder secret gets a random one, so tokens can't be forged.
# Sign-ins then last only until the server restarts, so set JWT_SECRET in production.
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET or JWT_SECRET.startswith("your_"):
    JWT_SECRET = secrets.token_urlsafe(32)
    logger.warning("JWT_SECRET is not set. Using a temporary secret: sign-ins reset when the server restarts.")
TOKEN_DAYS = 30

app = FastAPI()
security = HTTPBearer(auto_error=False)

# Logging setup
logger.add("error.log", level="ERROR")
logger.add("combined.log", level="INFO")

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "*")],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _user_id_from_header(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return jwt.decode(auth[7:], JWT_SECRET, algorithms=["HS256"]).get("sub")
    except jwt.PyJWTError:
        return None


def rate_key(request: Request) -> str:
    # Signed-in people get their own bucket; guests share one per IP
    user_id = _user_id_from_header(request)
    return f"user:{user_id}" if user_id else get_remote_address(request)


# Rate limiting
limiter = Limiter(key_func=rate_key)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# JWT Authentication ---------------------------------------------------------

def issue_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user["id"], "email": user["email"], "iat": now, "exp": now + timedelta(days=TOKEN_DAYS)}, JWT_SECRET, algorithm="HS256")


def _decode(credentials: HTTPAuthorizationCredentials | None) -> dict | None:
    if credentials is None:
        return None
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        logger.warning(f"Invalid JWT token: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = store.get_user(payload.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="Account not found")
    return user


async def optional_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict | None:
    return _decode(credentials)


async def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict:
    user = _decode(credentials)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


# Database Connections -------------------------------------------------------

async def connect_databases():
    app.state.mongo_db = None
    try:
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017"), serverSelectionTimeoutMS=2000)
        await mongo_client.admin.command("ping")
        app.state.mongo_db = mongo_client["smartland"]
        logger.info("MongoDB connected")
    except Exception as e:
        # Agency contacts are optional; reports still work without them
        logger.warning(f"MongoDB unavailable, agency contacts disabled: {e}")

    app.state.pg_pool = None
    try:
        app.state.pg_pool = await asyncpg.create_pool(
            os.getenv("POSTGRES_URI", "postgresql://postgres:password@localhost:5432/smartland_geo"), timeout=3, min_size=1, max_size=4
        )
        logger.info("PostgreSQL connected")
    except Exception as e:
        logger.warning(f"PostgreSQL unavailable, using Open-Meteo elevation instead of PostGIS: {e}")


@app.on_event("startup")
async def startup_event():
    await connect_databases()


# Pydantic Models for Validation ---------------------------------------------

class AnalyzeData(BaseModel):
    distance_to_amenities: float = 0
    population_growth: float = 0
    gdp_growth: float = 0
    infrastructure_score: float = 0
    typhoon_risk: float = 0
    proximity_to_mall: float = 5
    proximity_to_school: float = 3
    proximity_to_hospital: float = 4
    news_text: str = ""


class AnalyzeRequest(BaseModel):
    location: str
    data: AnalyzeData
    # From /api/locate. When missing, the backend looks the location up itself.
    place: dict | None = None
    amenities: list[dict] = []
    news_articles: list[dict] = []
    measured: bool = False


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=200)
    name: str | None = Field(default=None, max_length=80)


class ReportBody(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    createdAt: str
    input: dict
    result: dict


# Location data --------------------------------------------------------------

async def ai_locate(query: str) -> dict | None:
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(f"{AI_BASE_URL}/locate", params={"q": query})
    if res.status_code == 404:
        return None
    res.raise_for_status()
    return res.json()


async def postgis_elevation(lat: float, lon: float) -> float | None:
    """Elevation from the 30 m DEM loaded by ai-microservice/etl/import_geodata.py"""
    if app.state.pg_pool is None:
        return None
    try:
        async with app.state.pg_pool.acquire() as conn:
            value = await conn.fetchval(
                """SELECT ST_Value(rast, pt) FROM ph.dem30, ST_SetSRID(ST_MakePoint($1, $2), 4326) AS pt
                   WHERE ST_Intersects(rast, pt) LIMIT 1""",
                lon,
                lat,
            )
        return float(value) if value is not None else None
    except Exception as e:
        logger.warning(f"PostGIS elevation lookup failed: {e}")
        return None


async def get_agency(place: dict) -> dict | None:
    if app.state.mongo_db is None:
        return None
    names = [n for n in (place.get("locality"), place.get("name")) if n]
    try:
        return await app.state.mongo_db.agencies.find_one({"location": {"$in": names}}, {"_id": 0}, max_time_ms=2000)
    except Exception as e:
        logger.warning(f"Agency lookup skipped: {e}")
        return None


def offices_for(place: dict) -> list[dict]:
    """Where to verify a lot in this place. The same offices exist in every city and town."""
    town = place.get("locality") or place.get("name") or "the city or town"
    province = place.get("province") or town
    return [
        {"name": f"{town} Assessor's Office", "purpose": "Tax declaration and the assessed value of the lot"},
        {"name": f"BIR Revenue District Office for {town}", "purpose": "Zonal value, the government's minimum value for taxes"},
        {"name": f"Registry of Deeds, {province}", "purpose": "Certified true copy of the title, to check the owner and any liens"},
        {"name": f"{town} Planning and Development Office", "purpose": "Zoning, and whether the lot can be built on"},
    ]


@app.get("/api/locate")
@limiter.limit("60/15minute")
async def locate(request: Request, q: str = Query(min_length=2, max_length=200)):
    try:
        located = await ai_locate(q)
    except httpx.HTTPError as e:
        logger.error(f"Error in /api/locate: {e}")
        raise HTTPException(status_code=502, detail="Location service unavailable")
    if located is None:
        raise HTTPException(status_code=404, detail="Place not found")
    place = located["place"]
    elevation = await postgis_elevation(place["lat"], place["lon"])
    if elevation is not None:
        place["elevation_m"], place["elevation_source"] = round(elevation, 1), "postgis"
    elif place.get("elevation_m") is not None:
        place["elevation_source"] = "open-meteo"
    return located


# API Endpoint: Analyze location ----------------------------------------------

@app.post("/api/analyze")
@limiter.limit("100/15minute")
async def analyze(request: Request, body: AnalyzeRequest, user: dict | None = Depends(optional_user)):
    try:
        place = body.place
        if place is None:
            located = await ai_locate(body.location)
            place = located["place"] if located else None

        payload = body.data.model_dump()
        if place:
            payload.update(lat=place["lat"], lon=place["lon"], place_kind=place.get("kind", "site"), measured=body.measured)

        async with httpx.AsyncClient(timeout=30) as client:
            ai_response = await client.post(AI_SERVICE_URL, json=payload)
            ai_response.raise_for_status()
            ai_data = ai_response.json()

        report = {
            "location": body.location,
            "category": ai_data.get("category"),
            "predicted_price_sqm": ai_data.get("predicted_price_sqm"),
            "price_low": ai_data.get("price_low"),
            "price_high": ai_data.get("price_high"),
            "confidence": ai_data.get("confidence"),
            "comps": ai_data.get("comps", []),
            "growth_score": ai_data.get("growth_score"),
            "insights": ai_data.get("insights"),
            "news_analysis": ai_data.get("news_analysis"),
            "news_articles": body.news_articles[:8],
            "feature_analysis": ai_data.get("feature_analysis"),
            "agency": await get_agency(place) if place else None,
            "offices": offices_for(place) if place else [],
            "geo_data": {**place, "amenities": body.amenities[:8]} if place else {},
        }

        logger.info(f"Generated report for {body.location} ({'user ' + user['id'] if user else 'guest'})")
        return report
    except Exception as e:
        logger.error(f"Error in /api/analyze: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Accounts --------------------------------------------------------------------

@app.post("/api/auth/register")
@limiter.limit("10/15minute")
def register(request: Request, body: Credentials):
    user = store.create_user(body.email, body.password, (body.name or "").strip() or None)
    if user is None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    return {"token": issue_token(user), "user": user}


@app.post("/api/auth/login")
@limiter.limit("20/15minute")
def login(request: Request, body: Credentials):
    user = store.authenticate(body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Wrong email or password")
    return {"token": issue_token(user), "user": user}


@app.get("/api/auth/me")
async def me(user: dict = Depends(authenticate)):
    return user


# Saved reports ---------------------------------------------------------------

@app.get("/api/reports")
async def list_reports(user: dict = Depends(authenticate)):
    return store.list_reports(user["id"])


@app.put("/api/reports/{report_id}", status_code=204)
async def put_report(report_id: str, body: ReportBody, user: dict = Depends(authenticate)):
    if body.id != report_id:
        raise HTTPException(status_code=400, detail="Report id does not match the URL")
    store.put_report(user["id"], body.model_dump())
    return Response(status_code=204)


@app.delete("/api/reports/{report_id}", status_code=204)
async def delete_report(report_id: str, user: dict = Depends(authenticate)):
    store.delete_report(user["id"], report_id)
    return Response(status_code=204)


@app.post("/api/reports/{report_id}/share")
async def share_report(report_id: str, user: dict = Depends(authenticate)):
    token = store.share_report(user["id"], report_id)
    if token is None:
        raise HTTPException(status_code=404, detail="Save the report before you share it")
    return {"token": token}


@app.delete("/api/reports/{report_id}/share", status_code=204)
async def unshare_report(report_id: str, user: dict = Depends(authenticate)):
    store.unshare_report(user["id"], report_id)
    return Response(status_code=204)


@app.get("/api/shared/{token}")
async def shared_report(token: str):
    report = store.shared_report(token)
    if report is None:
        raise HTTPException(status_code=404, detail="This link was turned off or never existed")
    return report


# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "OK"}


# Serve the built web app when STATIC_DIR points at frontend/dist (set in the Docker image)
STATIC_DIR = os.getenv("STATIC_DIR")
if STATIC_DIR and os.path.isdir(STATIC_DIR):
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        file = os.path.join(STATIC_DIR, path)
        if path and os.path.isfile(file) and os.path.abspath(file).startswith(os.path.abspath(STATIC_DIR)):
            return FileResponse(file)
        # React Router handles every other path in the browser
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 3000)))
