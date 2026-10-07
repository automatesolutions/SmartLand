import os
import asyncio
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from loguru import logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import motor.motor_asyncio
import asyncpg
import jwt
import httpx

load_dotenv()

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://localhost:8002/predict")

app = FastAPI()
security = HTTPBearer()

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

# Rate limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# JWT Authentication Dependency
async def authenticate(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, os.getenv("JWT_SECRET", "secret_key"), algorithms=["HS256"])
        return payload
    except jwt.PyJWTError as e:
        logger.warning(f"Invalid JWT token: {e}")
        raise HTTPException(status_code=403, detail="Invalid token")

# Database Connections
async def connect_databases():
    try:
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017"), serverSelectionTimeoutMS=2000)
        app.state.mongo_db = mongo_client["smartland"]
        logger.info("MongoDB connected")
    except Exception as e:
        logger.error(f"MongoDB connection error: {e}")
        raise

    try:
        app.state.pg_pool = await asyncpg.create_pool(os.getenv("POSTGRES_URI", "postgresql://postgres:password@localhost:5432/smartland_geo"))
        logger.info("PostgreSQL connected")
    except Exception as e:
        logger.error(f"PostgreSQL connection error: {e}")
        logger.warning("Continuing without PostgreSQL - geospatial features will be disabled")
        app.state.pg_pool = None

# Call on startup
@app.on_event("startup")
async def startup_event():
    await connect_databases()

# Pydantic Models for Validation
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

# Agency Model (for MongoDB)
async def get_agency(location: str):
    collection = app.state.mongo_db.agencies
    try:
        agency = await collection.find_one({"location": location}, {"_id": 0}, max_time_ms=2000)
    except Exception as e:
        # Reports still work without MongoDB; agency info is optional
        logger.warning(f"Agency lookup skipped: {e}")
        agency = None
    return agency or {"name": "N/A"}

# API Endpoint: Analyze location
@app.post("/api/analyze")
@limiter.limit("100/15minute")  # 100 requests per 15 minutes
async def analyze(request: Request, body: AnalyzeRequest, user: dict = Depends(authenticate)):
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            ai_response = await client.post(AI_SERVICE_URL, json=body.data.dict())
            ai_response.raise_for_status()
            ai_data = ai_response.json()

        agency = await get_agency(body.location)

        # Commented out PostGIS/geospatial query for now
        # async with app.state.pg_pool.acquire() as conn:
        #     geo_query = await conn.fetch("SELECT * FROM locations WHERE name = $1", body.location)
        #     geo_data = geo_query[0] if geo_query else {}
        geo_data = {}  # Empty for now until PostGIS is installed

        report = {
            "location": body.location,
            "category": ai_data.get("category"),
            "predicted_price_sqm": ai_data.get("predicted_price_sqm"),
            "growth_score": ai_data.get("growth_score"),
            "insights": ai_data.get("insights"),
            "news_analysis": ai_data.get("news_analysis"),
            "feature_analysis": ai_data.get("feature_analysis"),
            "agency": agency,
            "geo_data": geo_data
        }

        logger.info(f"Generated report for {body.location}")
        return report
    except Exception as e:
        logger.error(f"Error in /api/analyze: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "OK"}

# Test endpoint without authentication
@app.post("/api/test-analyze")
async def test_analyze(body: AnalyzeRequest):
    """Test endpoint without authentication for development"""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            ai_response = await client.post(AI_SERVICE_URL, json=body.data.dict())
            ai_response.raise_for_status()
            ai_data = ai_response.json()

        agency = await get_agency(body.location)

        # Commented out PostGIS/geospatial query for now
        # async with app.state.pg_pool.acquire() as conn:
        #     geo_query = await conn.fetch("SELECT * FROM locations WHERE name = $1", body.location)
        #     geo_data = geo_query[0] if geo_query else {}
        geo_data = {}  # Empty for now until PostGIS is installed

        report = {
            "location": body.location,
            "category": ai_data.get("category"),
            "predicted_price_sqm": ai_data.get("predicted_price_sqm"),
            "growth_score": ai_data.get("growth_score"),
            "insights": ai_data.get("insights"),
            "news_analysis": ai_data.get("news_analysis"),
            "feature_analysis": ai_data.get("feature_analysis"),
            "agency": agency,
            "geo_data": geo_data
        }

        logger.info(f"Generated test report for {body.location}")
        return report
    except Exception as e:
        logger.error(f"Error in /api/test-analyze: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

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