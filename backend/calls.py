"""Huddles and live tours over LiveKit. See docs/business-suite.md, section 10.

- Huddle: a call in a team chat channel or DM. Anyone who can see the channel can join;
  guests listen and talk too, but only members and up can start one.
- Live tour: the seller makes a private link for a lead's buyer. The buyer joins with just a name.
  The link works for one tour and stops after TOUR_LINK_HOURS or when the seller ends it.

Nothing is recorded. Caps keep LiveKit's free plan free: CALL_MINUTES per call, people per call,
and participant minutes per business and for the whole site, per Philippine month.
"""

import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from loguru import logger
from pydantic import BaseModel, Field, model_validator

import calls_repo as repo
import crm_repo
import livekit_api
import orgs_repo
import store
from crm import _visible_lead
from deps import authenticate, limiter
from permissions import can, may
from workspace import _channel, _org

router = APIRouter()

kit = livekit_api.make()

CALL_MINUTES = int(os.getenv("CALL_MAX_MINUTES", "60"))
TOUR_LINK_HOURS = 2
HUDDLE_PEOPLE = 6
TOUR_PEOPLE = 4
ORG_MONTH_MINUTES = int(os.getenv("CALLS_ORG_MONTH_MINUTES", "600"))
SITE_MONTH_MINUTES = int(os.getenv("CALLS_SITE_MONTH_MINUTES", "4000"))

CALL_GONE = "Call not found"
TOUR_GONE = "This tour link doesn't work. Ask the seller for a new one."


def config() -> dict:
    return {"enabled": kit is not None, "max_minutes": CALL_MINUTES, "huddle_people": HUDDLE_PEOPLE, "tour_people": TOUR_PEOPLE}


def _on() -> livekit_api.LiveKit:
    if kit is None:
        raise HTTPException(status_code=503, detail="Calls aren't turned on yet.")
    return kit


def _now() -> datetime:
    return datetime.now(timezone.utc)


def tidy() -> None:
    """Ends calls that ran past their time, in LiveKit and here"""
    for call in repo.overdue():
        repo.end(call)
        if kit is not None:
            kit.end_room(repo.room_name(call["id"]))


def _check_minutes(org_id: str) -> None:
    if repo.minutes_used() >= SITE_MONTH_MINUTES:
        logger.warning("Calls paused: the site reached its monthly minutes")
        raise HTTPException(status_code=422, detail="Calls are paused for the rest of the month. They start again on the 1st.")
    if repo.minutes_used(org_id) >= ORG_MONTH_MINUTES:
        raise HTTPException(
            status_code=422,
            detail=f"This business has used its {ORG_MONTH_MINUTES} call minutes this month. They start again on the 1st.",
        )


def _check_room(call: dict, identity: str, limit: int) -> None:
    """Refuses a new person when the call is full. Asks LiveKit first, in case someone left without saying."""
    def others() -> int:
        return sum(1 for p in repo.people(call["id"]) if p["identity"] != identity)

    if others() >= limit:
        there = _on().people_in(repo.room_name(call["id"]))
        if there is not None:
            repo.keep_only(call, there)
        if others() >= limit:
            raise HTTPException(status_code=422, detail=f"This call is full. Up to {limit} people can join.")


def _end_if_empty(call: dict) -> None:
    """A huddle ends when its last person leaves. Tours wait for the buyer until the link expires."""
    if call["kind"] == "huddle" and call["ended_at"] is None and not repo.people(call["id"]):
        repo.end(call)


def view(call: dict, me: str | None = None) -> dict:
    return {
        "id": call["id"],
        "kind": call["kind"],
        "channel_id": call["channel_id"],
        "lead_id": call["lead_id"],
        "created_at": call["created_at"],
        "expires_at": call["expires_at"],
        "people": [{"name": p["name"], "me": p["identity"] == me} for p in repo.people(call["id"])],
    }


def _pass(call: dict, identity: str, name: str, *, limit: int, screen: bool) -> dict:
    lk = _on()
    repo.join(call["id"], identity, name)
    expires = datetime.fromisoformat(call["expires_at"])
    left = int((expires - _now()).total_seconds())
    # Each visit lasts at most CALL_MINUTES, even when a tour's link lasts longer
    ends = min(expires, _now() + timedelta(minutes=CALL_MINUTES))
    return {
        "call": view(call, identity),
        "ends_at": ends.isoformat(),
        "url": lk.url,
        "token": lk.join_pass(repo.room_name(call["id"]), identity, name, max_people=limit, seconds=max(60, min(left, 600)), can_share_screen=screen),
        "identity": identity,
    }


def _name(user: dict) -> str:
    return (user.get("name") or user["email"].split("@")[0])[:60]


def _me(user: dict) -> str:
    return f"u:{user['id']}"


def _team_call(user: dict, org_id: str, call_id: str) -> dict:
    """A call in the org that this person may see: its channel for a huddle, its lead for a tour"""
    can(user, "org.view", org_id)
    call = repo.get(call_id)
    if call is None or call["org_id"] != org_id:
        raise HTTPException(status_code=404, detail=CALL_GONE)
    if call["kind"] == "huddle":
        _channel(user, org_id, call["channel_id"])
    else:
        _visible_lead(user, org_id, call["lead_id"])
    return call


# Config ---------------------------------------------------------------------------

@router.get("/api/calls/config")
def calls_config():
    return config()


# Huddles --------------------------------------------------------------------------

@router.post("/api/business/orgs/{org_id}/workspace/channels/{channel_id}/huddle")
@limiter.limit("30/hour")
def join_huddle(request: Request, org_id: str, channel_id: str, user: dict = Depends(authenticate)):
    """Joins the channel's huddle, or starts one"""
    _on()
    _org(user, org_id, "workspace.view")
    ch = _channel(user, org_id, channel_id)
    if ch["archived_at"]:
        raise HTTPException(status_code=422, detail="This channel is archived.")
    tidy()
    call = repo.open_huddle(channel_id)
    if call is None:
        _org(user, org_id, "workspace.post")
        _check_minutes(org_id)
        call = repo.create(org_id, "huddle", user["id"], _now() + timedelta(minutes=CALL_MINUTES), channel_id=channel_id)
    else:
        _check_minutes(org_id)
        _check_room(call, _me(user), HUDDLE_PEOPLE)
    return _pass(call, _me(user), _name(user), limit=HUDDLE_PEOPLE, screen=True)


@router.post("/api/business/orgs/{org_id}/calls/{call_id}/join")
@limiter.limit("30/hour")
def join_call(request: Request, org_id: str, call_id: str, user: dict = Depends(authenticate)):
    """Rejoins a huddle or joins a live tour as the seller's team"""
    _on()
    tidy()
    call = _team_call(user, org_id, call_id)
    if not repo.is_live(call):
        raise HTTPException(status_code=410, detail="This call has ended.")
    _check_minutes(org_id)
    limit = HUDDLE_PEOPLE if call["kind"] == "huddle" else TOUR_PEOPLE
    _check_room(call, _me(user), limit)
    # The first person into a buyer call tells a buyer with an account, in their Messages
    if call["kind"] == "tour" and not repo.ever_joined(call["id"]) and crm_repo.buyer_has_account(call["lead_id"]):
        crm_repo.team_reply(org_id, call["lead_id"], user["id"], "I started a call. Join it here in Messages.")
    return _pass(call, _me(user), _name(user), limit=limit, screen=call["kind"] == "huddle")


@router.post("/api/business/orgs/{org_id}/calls/{call_id}/leave", status_code=204)
def leave_call(org_id: str, call_id: str, user: dict = Depends(authenticate)):
    call = _team_call(user, org_id, call_id)
    repo.leave(call, _me(user))
    _end_if_empty(call)
    return Response(status_code=204)


@router.post("/api/business/orgs/{org_id}/calls/{call_id}/end", status_code=204)
def end_call(org_id: str, call_id: str, user: dict = Depends(authenticate)):
    """Ends the call for everyone: a tour by the lead's team, a huddle by whoever started it or an owner or admin"""
    call = _team_call(user, org_id, call_id)
    if call["kind"] == "tour":
        _visible_lead(user, org_id, call["lead_id"], "leads.edit")
    elif call["started_by"] != user["id"] and not may(user, "channels.manage", org_id):
        raise HTTPException(status_code=403, detail="Only the person who started the huddle, or an owner or admin, can end it for everyone.")
    if call["ended_at"] is None:
        # Closed here first, so anyone reloading after LiveKit drops them sees that it ended
        repo.end(call)
        if kit is not None:
            kit.end_room(repo.room_name(call["id"]))
    return Response(status_code=204)


def huddles_by_channel(org_id: str) -> dict[str, dict]:
    """Open huddles for the team chat list, keyed by channel"""
    if kit is None:
        return {}
    tidy()
    return {c["channel_id"]: {"id": c["id"], "people": [p["name"] for p in repo.people(c["id"])]} for c in repo.open_huddles(org_id)}


# Live tours -----------------------------------------------------------------------

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.get("/api/business/orgs/{org_id}/leads/{lead_id}/tour")
def current_tour(org_id: str, lead_id: str, user: dict = Depends(authenticate)):
    _visible_lead(user, org_id, lead_id)
    tidy()
    call = repo.open_tour(lead_id) if kit is not None else None
    return {"enabled": kit is not None, "call": view(call, _me(user)) if call else None}


@router.post("/api/business/orgs/{org_id}/leads/{lead_id}/tour")
@limiter.limit("20/hour")
def start_tour(request: Request, org_id: str, lead_id: str, user: dict = Depends(authenticate)):
    """Makes the buyer's link. If a tour is already open, it gets a new link and the old one stops working."""
    _on()
    _visible_lead(user, org_id, lead_id, "leads.edit")
    tidy()
    _check_minutes(org_id)
    token = secrets.token_urlsafe(18)
    call = repo.open_tour(lead_id)
    if call is None:
        call = repo.create(org_id, "tour", user["id"], _now() + timedelta(hours=TOUR_LINK_HOURS), lead_id=lead_id, invite_hash=_hash(token))
    else:
        repo.set_invite(call["id"], _hash(token))
    return {"call": view(call, _me(user)), "link": f"/tour/{token}"}


def _tour(token: str) -> dict:
    call = repo.by_invite(_hash(token)) if len(token) < 80 else None
    if call is None or call["kind"] != "tour":
        raise HTTPException(status_code=404, detail=TOUR_GONE)
    return call


@router.get("/api/tours/{token}")
@limiter.limit("60/hour")
def tour_info(request: Request, token: str):
    """What the buyer sees before joining: whose tour, which property, and whether it's still on"""
    tidy()
    call = _tour(token)
    org = orgs_repo.get_org(call["org_id"])
    lead = repo.lead_listing(call["lead_id"]) if call["lead_id"] else None
    if org and org["kind"] == "personal":
        host = store.get_user(call["started_by"]) if call["started_by"] else None
        host_name = (host.get("name") or "The seller") if host else "The seller"
    else:
        host_name = org["name"] if org else "The seller"
    state = "live" if repo.is_live(call) else "ended"
    return {
        "state": state,
        "enabled": kit is not None,
        "host": host_name,
        "listing": lead,
        "expires_at": call["expires_at"],
        "people": len(repo.people(call["id"])) if state == "live" else 0,
        "max_minutes": CALL_MINUTES,
    }


class TourJoin(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    consent: bool

    @model_validator(mode="after")
    def check(self):
        self.name = " ".join(self.name.split())
        if not self.name:
            raise ValueError("Type your name.")
        if not self.consent:
            raise ValueError("Tick the box to join.")
        return self


@router.post("/api/tours/{token}/join")
@limiter.limit("20/hour")
def join_tour(request: Request, token: str, body: TourJoin):
    _on()
    tidy()
    call = _tour(token)
    if not repo.is_live(call):
        raise HTTPException(status_code=410, detail="This tour has ended. Message the seller to set up another.")
    _check_minutes(call["org_id"])
    identity = f"g:{secrets.token_urlsafe(9)}"
    _check_room(call, identity, TOUR_PEOPLE)
    return _pass(call, identity, body.name, limit=TOUR_PEOPLE, screen=False)


class TourLeave(BaseModel):
    identity: str = Field(min_length=3, max_length=40, pattern=r"^g:[A-Za-z0-9_-]+$")


@router.post("/api/tours/{token}/leave", status_code=204)
def leave_tour(token: str, body: TourLeave):
    call = _tour(token)
    repo.leave(call, body.identity)
    return Response(status_code=204)


# LiveKit webhooks -----------------------------------------------------------------

@router.post("/api/calls/livekit")
async def livekit_webhook(request: Request):
    """LiveKit tells us who joined and left, so minutes are counted from what really happened.
    Set this URL under Settings, Webhooks in LiveKit Cloud."""
    if kit is None:
        raise HTTPException(status_code=404, detail="Not found")
    body = await request.body()
    if not kit.verify_webhook(body, request.headers.get("authorization")):
        raise HTTPException(status_code=401, detail="Bad signature")
    try:
        event = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad body")
    room = (event.get("room") or {}).get("name", "")
    if not room.startswith("smartland-"):
        return {"ok": True}
    call = repo.get(room.removeprefix("smartland-"))
    if call is None:
        return {"ok": True}
    who = event.get("participant") or {}
    kind = event.get("event")
    if kind == "participant_joined" and who.get("identity"):
        repo.join(call["id"], who["identity"], (who.get("name") or "Guest")[:60])
    elif kind == "participant_left" and who.get("identity"):
        repo.leave(call, who["identity"])
        _end_if_empty(call)
    elif kind == "room_finished":
        # A tour's link keeps working until it expires, so the buyer can join after the seller steps out
        if call["kind"] == "huddle":
            repo.end(call)
        else:
            repo.keep_only(call, set())
    return {"ok": True}
