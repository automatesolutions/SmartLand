"""Sign-in, rate limits, and reviewer checks, shared by main.py and the routers"""

import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from slowapi import Limiter
from slowapi.util import get_remote_address

import store

load_dotenv()

# A missing or placeholder secret gets a random one, so tokens can't be forged.
# Sign-ins then last only until the server restarts, so set JWT_SECRET in production.
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET or JWT_SECRET.startswith("your_"):
    JWT_SECRET = secrets.token_urlsafe(32)
    logger.warning("JWT_SECRET is not set. Using a temporary secret: sign-ins reset when the server restarts.")
TOKEN_DAYS = 30

security = HTTPBearer(auto_error=False)


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


limiter = Limiter(key_func=rate_key)


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


# Comma-separated emails of the people who review documents
ADMIN_EMAILS = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}


def is_admin(user: dict | None) -> bool:
    return bool(user) and user["email"].lower() in ADMIN_EMAILS


async def require_admin(user: dict = Depends(authenticate)) -> dict:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only reviewers can do this")
    return user
