"""Performance: counts listing visits by where people came from, and shows each org
its visits and inquiries per listing and source. See docs/business-suite.md, section 7.

Only daily totals are kept. No IP address, cookie, or visitor ID is stored.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from slowapi.util import get_remote_address

import orgs_repo
import performance_repo
import store
from deps import authenticate, limiter, optional_user
from permissions import can

router = APIRouter()

PERIODS = (7, 30, 90)


def clean_tag(value: str | None) -> str:
    """A UTM value as we store it: lowercase, spaces as dashes, letters, digits, dots, dashes, and underscores"""
    value = re.sub(r"\s+", "-", (value or "").strip().lower())
    return re.sub(r"[^a-z0-9._-]", "", value)[:40]


class RefIn(BaseModel):
    """Where a visitor came from: their UTM tags, or a source the page worked out from the referrer"""

    source: str = Field(default="", max_length=100)
    medium: str = Field(default="", max_length=100)
    campaign: str = Field(default="", max_length=100)

    @field_validator("source", "medium", "campaign")
    @classmethod
    def tidy(cls, v: str) -> str:
        return clean_tag(v)


def _is_team(user: dict | None, poster: dict) -> bool:
    """The person who posted the listing, or anyone on the business it was posted for"""
    if user is None:
        return False
    if user["id"] == poster["user_id"]:
        return True
    return bool(poster["org_id"]) and orgs_repo.role_of(user["id"], poster["org_id"]) is not None


@router.post("/api/listings/{listing_id}/visits", status_code=204)
# Per IP, so a script can't inflate the counts. The address is never stored.
@limiter.limit("60/hour", key_func=get_remote_address)
def count_visit(request: Request, listing_id: str, body: RefIn, user: dict | None = Depends(optional_user)):
    poster = store.listing_poster(listing_id)
    if poster is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    # The seller and their team looking at their own listing isn't a visit
    if not _is_team(user, poster):
        performance_repo.add_visit(listing_id, body.source or "direct", body.medium, body.campaign)
    return Response(status_code=204)


@router.get("/api/business/orgs/{org_id}/performance")
def performance(org_id: str, days: int = Query(default=30), user: dict = Depends(authenticate)):
    can(user, "performance.view", org_id)
    if days not in PERIODS:
        raise HTTPException(status_code=422, detail="Pick 7, 30, or 90 days.")
    org = orgs_repo.get_org(org_id)
    return performance_repo.report(org, user["id"], days)
