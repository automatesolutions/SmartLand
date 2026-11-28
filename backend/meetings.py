"""Calls with buyers, inside the conversation. See docs/business-suite.md, section 10.

- The team starts a video or voice call on a lead (calls.py, kind 'tour'). A buyer with an
  account joins from their Messages; a buyer without one joins from the tour link.
- A buyer asks for a call, now or at a time. The team accepts, picks another time, or declines.
- Either side books a call for a time. The join button shows from 10 minutes before until an
  hour after, and either side can open the call in that window.

Each change is also written into the conversation, so the other side sees it as a new message.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import calls
import calls_repo
import crm_repo
import db
from crm import _visible_lead
from deps import authenticate, limiter
from performance_repo import PH
from permissions import can

router = APIRouter()

EARLY = timedelta(minutes=10)
LATE = timedelta(minutes=60)
OPEN_REQUESTS = 3
MEETING_GONE = "Call not found"
THREAD_GONE = "Conversation not found"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def when(starts_at: str | None) -> str:
    """'Tue, Dec 2 at 3:00 PM' in Philippine time, or 'as soon as you can'"""
    if not starts_at:
        return "as soon as you can"
    t = datetime.fromisoformat(starts_at).astimezone(PH)
    return f"{t:%a, %b} {t.day} at {t.hour % 12 or 12}:{t:%M %p}"


# Storage ------------------------------------------------------------------------------

def _get(meeting_id: str) -> dict | None:
    with db.transaction() as c:
        r = c.execute("SELECT * FROM lead_meetings WHERE id = ?", (meeting_id,)).fetchone()
    return dict(r) if r else None


def _for_lead(lead_id: str) -> list[dict]:
    """Open requests and booked calls that haven't passed, soonest first"""
    since = (_now() - LATE).isoformat()
    with db.transaction() as c:
        rows = c.execute(
            """SELECT * FROM lead_meetings WHERE lead_id = ? AND status != 'canceled' AND (starts_at IS NULL OR starts_at >= ?)
               ORDER BY starts_at IS NOT NULL, starts_at, created_at""",
            (lead_id, since),
        ).fetchall()
    return [dict(r) for r in rows]


def _create(org_id: str, lead_id: str, kind: str, status: str, starts_at: str | None, asked_by: str, note: str | None, user_id: str) -> dict:
    mid = secrets.token_urlsafe(9)
    now = db.now()
    with db.transaction() as c:
        c.execute(
            """INSERT INTO lead_meetings (id, org_id, lead_id, kind, status, starts_at, asked_by, note, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (mid, org_id, lead_id, kind, status, starts_at, asked_by, note, user_id, now, now),
        )
    return _get(mid)


def _update(meeting_id: str, **changes) -> dict:
    sets = ", ".join(f"{k} = ?" for k in changes)
    with db.transaction() as c:
        c.execute(f"UPDATE lead_meetings SET {sets}, updated_at = ? WHERE id = ?", (*changes.values(), db.now(), meeting_id))
    return _get(meeting_id)


def view(m: dict) -> dict:
    starts = m["starts_at"]
    joinable = m["status"] == "scheduled" and starts is not None and (
        datetime.fromisoformat(starts) - EARLY <= _now() <= datetime.fromisoformat(starts) + LATE
    )
    return {
        "id": m["id"],
        "kind": m["kind"],
        "status": m["status"],
        "starts_at": starts,
        "when": when(starts),
        "asked_by": m["asked_by"],
        "note": m["note"],
        "joinable": joinable,
    }


def _joinable_meeting(lead_id: str) -> dict | None:
    return next((m for m in _for_lead(lead_id) if view(m)["joinable"]), None)


# Input --------------------------------------------------------------------------------

class MeetingIn(BaseModel):
    kind: Literal["video", "voice"] = "video"
    # Null: as soon as you can (buyers only)
    starts_at: datetime | None = None
    note: str | None = Field(default=None, max_length=300)


def _future(starts_at: datetime | None, required: bool) -> str | None:
    if starts_at is None:
        if required:
            raise HTTPException(status_code=422, detail="Pick a day and time for the call.")
        return None
    if starts_at.tzinfo is None:
        starts_at = starts_at.replace(tzinfo=PH)
    if starts_at < _now() - timedelta(minutes=5):
        raise HTTPException(status_code=422, detail="Pick a time that hasn't passed.")
    if starts_at > _now() + timedelta(days=60):
        raise HTTPException(status_code=422, detail="Pick a time in the next 60 days.")
    return starts_at.astimezone(timezone.utc).isoformat()


def _label(kind: str) -> str:
    return "video call" if kind == "video" else "voice call"


# The team's side ----------------------------------------------------------------------

@router.get("/api/business/orgs/{org_id}/leads/{lead_id}/meetings")
def lead_meetings(org_id: str, lead_id: str, user: dict = Depends(authenticate)):
    _visible_lead(user, org_id, lead_id)
    return [view(m) for m in _for_lead(lead_id)]


@router.post("/api/business/orgs/{org_id}/leads/{lead_id}/meetings", status_code=201)
@limiter.limit("30/hour")
def book(request: Request, org_id: str, lead_id: str, body: MeetingIn, user: dict = Depends(authenticate)):
    """The team books a call with the buyer"""
    _visible_lead(user, org_id, lead_id, "leads.edit")
    starts = _future(body.starts_at, required=True)
    m = _create(org_id, lead_id, body.kind, "scheduled", starts, "team", (body.note or "").strip() or None, user["id"])
    crm_repo.team_reply(org_id, lead_id, user["id"], f"I booked a {_label(body.kind)} with you for {when(starts)}. Join it here in Messages when it’s time.")
    return view(m)


class MeetingPatch(BaseModel):
    status: Literal["scheduled", "canceled"]
    # Set to book a requested call for a time, or move a booked one
    starts_at: datetime | None = None


@router.patch("/api/business/orgs/{org_id}/leads/{lead_id}/meetings/{meeting_id}")
def answer(org_id: str, lead_id: str, meeting_id: str, body: MeetingPatch, user: dict = Depends(authenticate)):
    """Accept a request (now or at another time), move a booked call, or cancel"""
    _visible_lead(user, org_id, lead_id, "leads.edit")
    m = _get(meeting_id)
    if m is None or m["lead_id"] != lead_id or m["status"] == "canceled":
        raise HTTPException(status_code=404, detail=MEETING_GONE)
    label = _label(m["kind"])
    if body.status == "canceled":
        m = _update(meeting_id, status="canceled")
        crm_repo.team_reply(org_id, lead_id, user["id"], f"I canceled the {label} for {when(m['starts_at'])}. Message me to set up another time.")
        return view(m)
    if body.starts_at is not None:
        starts = _future(body.starts_at, required=True)
    else:
        # Accepting "as soon as you can" means now
        starts = m["starts_at"] or _now().isoformat()
    moved = m["status"] == "scheduled" or (m["starts_at"] and starts != m["starts_at"])
    m = _update(meeting_id, status="scheduled", starts_at=starts)
    text = (
        f"I moved our {label} to {when(starts)}." if moved else f"Your {label} is booked for {when(starts)}."
    ) + " Join it here in Messages when it’s time."
    crm_repo.team_reply(org_id, lead_id, user["id"], text)
    return view(m)


@router.get("/api/business/orgs/{org_id}/meetings")
def upcoming(org_id: str, user: dict = Depends(authenticate)):
    """Requests waiting for an answer and calls booked in the next 14 days, for the Business page"""
    role = can(user, "leads.view", org_id)
    since, until = (_now() - LATE).isoformat(), (_now() + timedelta(days=14)).isoformat()
    with db.transaction() as c:
        rows = c.execute(
            """SELECT m.*, ct.name AS contact_name, li.title AS listing_title, l.assignee_id FROM lead_meetings m
               JOIN leads l ON l.id = m.lead_id JOIN contacts ct ON ct.id = l.contact_id
               LEFT JOIN listings li ON li.id = l.listing_id
               WHERE m.org_id = ? AND (m.status = 'requested' OR (m.status = 'scheduled' AND m.starts_at BETWEEN ? AND ?))
               ORDER BY m.status = 'scheduled', m.starts_at, m.created_at""",
            (org_id, since, until),
        ).fetchall()
    out = []
    for r in rows:
        if role == "guest" and r["assignee_id"] != user["id"]:
            continue
        out.append({**view(dict(r)), "lead_id": r["lead_id"], "contact_name": r["contact_name"], "listing_title": r["listing_title"]})
    return out


# The buyer's side ---------------------------------------------------------------------

def _thread(user: dict, thread_id: str) -> dict:
    lead = crm_repo.buyer_lead(user["id"], thread_id)
    if lead is None:
        raise HTTPException(status_code=404, detail=THREAD_GONE)
    return lead


@router.get("/api/messages/{thread_id}/calls")
def buyer_calls(thread_id: str, user: dict = Depends(authenticate)):
    """The call going on now, if any, and requested or booked calls"""
    lead = _thread(user, thread_id)
    if calls.kit is None:
        return {"enabled": False, "call": None, "meetings": []}
    calls.tidy()
    call = calls_repo.open_tour(lead["id"])
    live = bool(call and calls_repo.people(call["id"]))
    return {
        "enabled": True,
        # A call shows as joinable when someone's in it, or a booked time has come
        "call": {"live": live, "people": len(calls_repo.people(call["id"])) if call else 0} if (live or _joinable_meeting(lead["id"])) else None,
        "meetings": [view(m) for m in _for_lead(lead["id"])],
    }


@router.post("/api/messages/{thread_id}/meetings", status_code=201)
@limiter.limit("10/day")
def ask_for_call(request: Request, thread_id: str, body: MeetingIn, user: dict = Depends(authenticate)):
    lead = _thread(user, thread_id)
    if sum(1 for m in _for_lead(lead["id"]) if m["status"] == "requested") >= OPEN_REQUESTS:
        raise HTTPException(status_code=422, detail="You’ve asked for a few calls already. Wait for the seller to answer.")
    starts = _future(body.starts_at, required=False)
    note = (body.note or "").strip() or None
    m = _create(lead["org_id"], lead["id"], body.kind, "requested", starts, "buyer", note, user["id"])
    text = f"I’d like a {_label(body.kind)} about this property, {when(starts)}." + (f" {note}" if note else "")
    crm_repo.buyer_reply(user["id"], lead["id"], text)
    return view(m)


@router.delete("/api/messages/{thread_id}/meetings/{meeting_id}", status_code=204)
def buyer_cancel(thread_id: str, meeting_id: str, user: dict = Depends(authenticate)):
    lead = _thread(user, thread_id)
    m = _get(meeting_id)
    if m is None or m["lead_id"] != lead["id"] or m["status"] == "canceled":
        raise HTTPException(status_code=404, detail=MEETING_GONE)
    _update(meeting_id, status="canceled")
    crm_repo.buyer_reply(user["id"], lead["id"], f"I canceled the {_label(m['kind'])} for {when(m['starts_at'])}.")
    return Response(status_code=204)


def _buyer_identity(user: dict) -> str:
    return f"b:{user['id']}"


@router.post("/api/messages/{thread_id}/call")
@limiter.limit("30/hour")
def buyer_join(request: Request, thread_id: str, user: dict = Depends(authenticate)):
    """Joins the call on this conversation. Opens it when a booked time has come."""
    lead = _thread(user, thread_id)
    calls._on()
    calls.tidy()
    call = calls_repo.open_tour(lead["id"])
    if call is None or not calls_repo.people(call["id"]):
        if call is None and _joinable_meeting(lead["id"]) is None:
            raise HTTPException(status_code=409, detail="The seller hasn’t started a call yet. You can join once they do, or at the time you booked.")
        if call is None:
            calls._check_minutes(lead["org_id"])
            call = calls_repo.create(lead["org_id"], "tour", user["id"], _now() + timedelta(hours=calls.TOUR_LINK_HOURS), lead_id=lead["id"])
    calls._check_minutes(lead["org_id"])
    calls._check_room(call, _buyer_identity(user), calls.TOUR_PEOPLE)
    return calls._pass(call, _buyer_identity(user), lead["contact_name"][:60], limit=calls.TOUR_PEOPLE, screen=False)


@router.post("/api/messages/{thread_id}/call/leave", status_code=204)
def buyer_leave(thread_id: str, user: dict = Depends(authenticate)):
    lead = _thread(user, thread_id)
    call = calls_repo.open_tour(lead["id"])
    if call:
        calls_repo.leave(call, _buyer_identity(user))
    return Response(status_code=204)
