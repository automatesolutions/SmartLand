import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator
from loguru import logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import motor.motor_asyncio
import asyncpg
import jwt
import httpx

import listing_rules
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

async def ai_locate(query: str | None = None, lat: float | None = None, lon: float | None = None) -> dict | None:
    params = {"lat": lat, "lon": lon} if lat is not None and lon is not None else {"q": query}
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(f"{AI_BASE_URL}/locate", params=params)
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
    # `kind` matches the keys of the AI service's /offices lookup
    return [
        {"kind": "assessor", "name": f"{town} Assessor's Office", "purpose": "Tax declaration and the assessed value of the lot"},
        {"kind": "bir", "name": f"BIR Revenue District Office for {town}", "purpose": "Zonal value, the government's minimum value for taxes"},
        {"kind": "registry", "name": f"Registry of Deeds, {province}", "purpose": "Certified true copy of the title, to check the owner and any liens"},
        {"kind": "planning", "name": f"{town} Planning and Development Office", "purpose": "Zoning, and whether the lot can be built on"},
    ]


@app.get("/api/offices")
@limiter.limit("60/15minute")
async def office_locations(
    request: Request,
    town: str = Query(min_length=2, max_length=100),
    province: str | None = Query(default=None, max_length=100),
    lat: float = Query(ge=4.2, le=21.5),
    lon: float = Query(ge=116.0, le=127.0),
):
    """Map positions for the offices in a report. Each search waits on Nominatim's
    one-request-per-second limit, so the first lookup for a town takes a few seconds."""
    params = {"town": town, "lat": lat, "lon": lon}
    if province:
        params["province"] = province
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.get(f"{AI_BASE_URL}/offices", params=params)
        res.raise_for_status()
        return res.json()
    except httpx.HTTPError as e:
        logger.error(f"Error in /api/offices: {e}")
        raise HTTPException(status_code=502, detail="Location service unavailable")


@app.get("/api/nearby")
@limiter.limit("60/15minute")
async def nearby_places(
    request: Request,
    lat: float = Query(ge=4.2, le=21.5),
    lon: float = Query(ge=116.0, le=127.0),
):
    """Everyday places around a report's lot: hospitals, supermarkets, malls, and popular chains."""
    try:
        # One slow mirror can take 70 s before the next is tried
        async with httpx.AsyncClient(timeout=150) as client:
            res = await client.get(f"{AI_BASE_URL}/nearby", params={"lat": lat, "lon": lon})
        if res.status_code == 503:
            raise HTTPException(status_code=503, detail="Map data unavailable")
        res.raise_for_status()
        return res.json()
    except httpx.HTTPError as e:
        logger.error(f"Error in /api/nearby: {e}")
        raise HTTPException(status_code=502, detail="Location service unavailable")


@app.get("/api/locate")
# Higher than analyze: every move of the map pin is one lookup
@limiter.limit("150/15minute")
async def locate(
    request: Request,
    q: str | None = Query(default=None, min_length=2, max_length=200),
    lat: float | None = Query(default=None, ge=4.2, le=21.5),
    lon: float | None = Query(default=None, ge=116.0, le=127.0),
):
    if not q and (lat is None or lon is None):
        raise HTTPException(status_code=422, detail="Send a place name, or lat and lon")
    try:
        located = await ai_locate(q, lat, lon)
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
# The Check page asks for a live estimate each time the pin or a value settles
@limiter.limit("300/15minute")
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
    return {"token": issue_token(user), "user": {**user, "is_admin": is_admin(user)}}


@app.post("/api/auth/login")
@limiter.limit("20/15minute")
def login(request: Request, body: Credentials):
    user = store.authenticate(body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Wrong email or password")
    return {"token": issue_token(user), "user": {**user, "is_admin": is_admin(user)}}


# "Sign in with Google": an OAuth client ID of type "Web application" from
# Google Cloud Console, with the site's address under Authorized JavaScript origins
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
# Google's signing keys, fetched once and cached; they rotate every few days
_google_keys = jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", cache_keys=True, lifespan=6 * 3600)


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)


@app.get("/api/auth/config")
async def auth_config():
    """Which sign-in methods this server offers"""
    return {"google_client_id": GOOGLE_CLIENT_ID or None}


@app.post("/api/auth/google")
@limiter.limit("30/15minute")
def google_sign_in(request: Request, body: GoogleCredential):
    """Signs in with the ID token Google's sign-in button or One Tap returns.
    The token's signature, audience, issuer, expiry, and verified email are all
    checked before anyone is signed in."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=404, detail="Google sign-in isn't set up on this server")
    try:
        key = _google_keys.get_signing_key_from_jwt(body.credential)
        claims = jwt.decode(body.credential, key.key, algorithms=["RS256"], audience=GOOGLE_CLIENT_ID)
    except (jwt.PyJWTError, jwt.PyJWKClientError) as e:
        logger.warning(f"Rejected Google credential: {e}")
        raise HTTPException(status_code=401, detail="Google sign-in didn't go through. Try again.")
    if claims.get("iss") not in GOOGLE_ISSUERS or not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Google sign-in didn't go through. Try again.")
    if not claims.get("email") or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="This Google account has no verified email.")
    user = store.google_user(claims["sub"], claims["email"], (claims.get("name") or "").strip() or None)
    return {"token": issue_token(user), "user": {**user, "is_admin": is_admin(user)}}


@app.get("/api/auth/me")
async def me(user: dict = Depends(authenticate)):
    return {**user, "is_admin": is_admin(user)}


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


# Listings -------------------------------------------------------------------

ListingCategory = Literal[
    "farm_lot", "house_sale", "house_rent", "land_lease", "commercial_sale", "warehouse_lease", "beach", "foreclosure"
]
DocumentType = Literal["title", "rights", "tax_declaration", "tax_clearance", "survey_plan", "other"]

# Uploaded documents, named by their SHA-256. On Cloud Run this disk is wiped on
# every deploy, like the database (see README.md).
UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(os.path.abspath(store.DATABASE_PATH)), "uploads"))
# Comma-separated emails of the people who review documents
ADMIN_EMAILS = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}


def is_admin(user: dict | None) -> bool:
    return bool(user) and user["email"].lower() in ADMIN_EMAILS


async def require_admin(user: dict = Depends(authenticate)) -> dict:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only reviewers can do this")
    return user


class ListingIn(BaseModel):
    category: ListingCategory
    title: str = Field(min_length=5, max_length=120)
    description: str = Field(default="", max_length=4000)
    # Whole pesos: the asking price, or the monthly rent for rentals and leases
    price: int = Field(gt=0, le=100_000_000_000)
    lot_sqm: float | None = Field(default=None, gt=0, le=100_000_000)
    floor_sqm: float | None = Field(default=None, gt=0, le=10_000_000)
    lat: float = Field(ge=4.2, le=21.5)
    lon: float = Field(ge=116.0, le=127.0)
    place: str = Field(min_length=2, max_length=200)
    town: str | None = Field(default=None, max_length=100)
    province: str | None = Field(default=None, max_length=100)
    seller_type: Literal["owner", "broker", "developer", "bank"]
    prc_license: str | None = Field(default=None, pattern=r"^\d{4,10}$")
    contact_name: str = Field(min_length=2, max_length=80)
    contact_phone: str = Field(pattern=r"^[0-9+()\-\s]{7,20}$")
    # The fields this category asks for (listing_rules.CATEGORIES)
    details: dict = Field(default_factory=dict)
    # The seller confirms they own the property or may sell it for the owner
    authorized: bool

    @model_validator(mode="after")
    def check(self):
        if not self.authorized:
            raise ValueError("Confirm that you own this property or are authorized to sell it")
        if self.seller_type == "broker" and not self.prc_license:
            raise ValueError("Brokers must give their PRC license number")
        needs = listing_rules.required_areas(self.category)
        if needs["lot_sqm"] and not self.lot_sqm:
            raise ValueError("Enter the lot area.")
        if needs["floor_sqm"] and not self.floor_sqm:
            raise ValueError("Enter the floor area.")
        self.details = listing_rules.validate_details(self.category, self.details)
        return self


class ListingChange(BaseModel):
    status: Literal["active", "sold"] | None = None
    price: int | None = Field(default=None, gt=0, le=100_000_000_000)


class Review(BaseModel):
    status: Literal["verified", "rejected"]
    note: str | None = Field(default=None, max_length=500)


def _doc_view(doc: dict, private: bool) -> dict:
    """What anyone sees about a document: its kind, review status, and
    fingerprint. Never the file. The owner and reviewers also see the file name
    and the reviewer's note."""
    view = {k: doc[k] for k in ("id", "type", "status", "sha256", "size", "uploaded_at", "reviewed_at")}
    if private:
        view.update(filename=doc["filename"], mime=doc["mime"], review_note=doc["review_note"])
    return view


def _with_trust(listing: dict, viewer: dict | None = None, phone: bool = True) -> dict:
    docs = store.list_documents(listing["id"])
    private = listing.get("mine") or is_admin(viewer)
    out = {**listing, "documents": [_doc_view(d, private) for d in docs], "credibility": listing_rules.credibility(listing, docs)}
    if not phone:
        # Search results leave out phone numbers, so the list can't be harvested for contacts
        out.pop("contact_phone", None)
    return out


def _sniff(head: bytes) -> str | None:
    """The real file type from its first bytes, whatever the browser claimed"""
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


@app.get("/api/listings/schema")
async def listing_schema():
    """The fields each kind of listing asks for, and the documents that back one up"""
    return {
        "categories": listing_rules.CATEGORIES,
        "documents": listing_rules.DOCUMENTS,
        "scoring": listing_rules.SCORING,
        "max_document_mb": listing_rules.MAX_DOCUMENT_BYTES // (1024 * 1024),
        "document_types": list(listing_rules.ALLOWED_TYPES),
    }


@app.get("/api/listings")
async def search_listings(
    lat: float = Query(ge=4.2, le=21.5),
    lon: float = Query(ge=116.0, le=127.0),
    radius_km: float = Query(default=25, gt=0, le=100),
    category: ListingCategory | None = None,
):
    """Active listings near a point, nearest first, with the count per category"""
    found = store.listings_near(lat, lon, radius_km, category)
    return {**found, "radius_km": radius_km, "listings": [_with_trust(x, phone=False) for x in found["listings"]]}


@app.get("/api/listings/mine")
async def my_listings(user: dict = Depends(authenticate)):
    return [_with_trust(x, user) for x in store.user_listings(user["id"])]


@app.get("/api/listings/{listing_id}")
async def get_listing(listing_id: str, user: dict | None = Depends(optional_user)):
    listing = store.get_listing(listing_id, user["id"] if user else None)
    if listing is None:
        raise HTTPException(status_code=404, detail="This listing was removed or never existed")
    return _with_trust(listing, user)


@app.get("/api/listings/{listing_id}/record")
async def listing_record(listing_id: str):
    """Every change to the listing in order, each with its fingerprint, and
    whether the chain of fingerprints is still intact"""
    if store.get_listing(listing_id) is None:
        raise HTTPException(status_code=404, detail="This listing was removed or never existed")
    events = store.listing_events(listing_id)
    return {"intact": listing_rules.verify_chain(events), "events": events}


@app.post("/api/listings", status_code=201)
@limiter.limit("20/hour")
async def create_listing(request: Request, body: ListingIn, user: dict = Depends(authenticate)):
    data = body.model_dump(exclude={"authorized"})
    if data["seller_type"] != "broker":
        data["prc_license"] = None
    return _with_trust(store.create_listing(user["id"], data), user)


@app.patch("/api/listings/{listing_id}")
async def update_listing(listing_id: str, body: ListingChange, user: dict = Depends(authenticate)):
    listing = None
    if body.price is not None:
        listing = store.set_listing_price(user["id"], listing_id, body.price)
        if listing is None:
            raise HTTPException(status_code=404, detail="Listing not found")
    if body.status is not None:
        listing = store.set_listing_status(user["id"], listing_id, body.status)
        if listing is None:
            raise HTTPException(status_code=404, detail="Listing not found")
    if listing is None:
        raise HTTPException(status_code=422, detail="Send a new price or status")
    return _with_trust(listing, user)


@app.delete("/api/listings/{listing_id}", status_code=204)
async def delete_listing(listing_id: str, user: dict = Depends(authenticate)):
    if store.set_listing_status(user["id"], listing_id, "removed") is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return Response(status_code=204)


@app.post("/api/listings/{listing_id}/documents", status_code=201)
@limiter.limit("40/hour")
async def upload_document(
    request: Request,
    listing_id: str,
    type: DocumentType = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(authenticate),
):
    """Adds a document to your own listing. It stays private: buyers see only
    its kind, review status, and fingerprint."""
    if store.listing_owner(listing_id) != user["id"]:
        raise HTTPException(status_code=404, detail="Listing not found")
    if len(store.list_documents(listing_id)) >= listing_rules.MAX_DOCUMENTS:
        raise HTTPException(status_code=422, detail=f"A listing can have up to {listing_rules.MAX_DOCUMENTS} documents.")
    data = await file.read(listing_rules.MAX_DOCUMENT_BYTES + 1)
    if len(data) > listing_rules.MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail=f"Files can be up to {listing_rules.MAX_DOCUMENT_BYTES // (1024 * 1024)} MB.")
    mime = _sniff(data[:16])
    if mime is None:
        raise HTTPException(status_code=415, detail="Upload a PDF, JPG, PNG, or WebP file.")
    digest = hashlib.sha256(data).hexdigest()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, f"{digest}.{listing_rules.ALLOWED_TYPES[mime]}")
    if not os.path.exists(path):
        with open(path, "wb") as fh:
            fh.write(data)
    name = os.path.basename(file.filename or "document")[:120]
    doc = store.add_document(listing_id, type, name, mime, len(data), digest)
    return _doc_view(doc, private=True)


@app.get("/api/listings/{listing_id}/documents/{doc_id}/file")
async def document_file(listing_id: str, doc_id: str, user: dict = Depends(authenticate)):
    """The file itself, for the listing's owner and for reviewers only"""
    doc = store.get_document(doc_id)
    if doc is None or doc["listing_id"] != listing_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if store.listing_owner(listing_id) != user["id"] and not is_admin(user):
        raise HTTPException(status_code=404, detail="Document not found")
    path = os.path.join(UPLOAD_DIR, f"{doc['sha256']}.{listing_rules.ALLOWED_TYPES[doc['mime']]}")
    if not os.path.exists(path):
        raise HTTPException(status_code=410, detail="The file is gone. Ask the seller to upload it again.")
    return FileResponse(path, media_type=doc["mime"], filename=doc["filename"], content_disposition_type="inline",
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@app.get("/api/admin/documents")
async def review_queue(status: Literal["pending", "verified", "rejected"] = "pending", user: dict = Depends(require_admin)):
    return store.documents_for_review(status)


@app.post("/api/admin/documents/{doc_id}/review")
async def review_document(doc_id: str, body: Review, user: dict = Depends(require_admin)):
    doc = store.review_document(doc_id, body.status, (body.note or "").strip() or None)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    logger.info(f"Document {doc_id} marked {body.status} by {user['email']}")
    return _doc_view(doc, private=True)


@app.get("/api/reverse")
@limiter.limit("60/15minute")
async def reverse_geocode(request: Request, lat: float = Query(ge=4.2, le=21.5), lon: float = Query(ge=116.0, le=127.0)):
    """Names a pinned spot without the map survey and news that /api/locate runs"""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(f"{AI_BASE_URL}/reverse", params={"lat": lat, "lon": lon})
    except httpx.HTTPError as e:
        logger.error(f"Error in /api/reverse: {e}")
        raise HTTPException(status_code=502, detail="Location service unavailable")
    if res.status_code == 404:
        raise HTTPException(status_code=404, detail="Place not found")
    res.raise_for_status()
    return res.json()


# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "OK"}


# Serve the built web app when STATIC_DIR points at frontend/dist (set in the Docker image)
STATIC_DIR = os.getenv("STATIC_DIR")
if STATIC_DIR and os.path.isdir(STATIC_DIR):
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
