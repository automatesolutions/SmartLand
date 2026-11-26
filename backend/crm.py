"""CRM: buyer inquiries become leads, the team works them, and buyer and seller message each other.

Team routes check permissions.can() first. Buyer routes only ever show the buyer's
own threads. See docs/business-suite.md, sections 3 and 4.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator
from slowapi.util import get_remote_address

import crm_repo
import orgs_repo
import store
from deps import authenticate, limiter, optional_user
from permissions import can

router = APIRouter()

# Bump when the consent wording in the inquiry form changes (frontend/src/pages/Listing.tsx)
CONSENT_VERSION = "2026-11-v2"

PHONE = r"^\+?[\d\s()-]{7,20}$"
EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
LEAD_GONE = "Lead not found"


class ContactFields(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str | None = Field(default=None, max_length=20, pattern=PHONE)
    email: str | None = Field(default=None, max_length=254, pattern=EMAIL)

    @model_validator(mode="after")
    def tidy(self):
        self.name = self.name.strip()
        self.phone = (self.phone or "").strip() or None
        self.email = (self.email or "").strip().lower() or None
        if len(self.name) < 2:
            raise ValueError("Enter a name.")
        return self


class InquiryIn(ContactFields):
    message: str = Field(min_length=1, max_length=1000)
    consent: bool
    # Hidden from people. Bots fill it in.
    website: str = ""

    @model_validator(mode="after")
    def check(self):
        if not self.consent:
            raise ValueError("Agree to share your details with the seller to send the message.")
        self.message = self.message.strip()
        if not self.message:
            raise ValueError("Write a message to the seller.")
        return self


class LeadIn(ContactFields):
    listing_id: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=2000)
    assignee_id: str | None = Field(default=None, max_length=40)
    follow_up_on: date | None = None

    @model_validator(mode="after")
    def check(self):
        if not self.phone and not self.email:
            raise ValueError("Add a phone number or an email, so you can reach them.")
        return self


class LeadPatch(BaseModel):
    stage_id: str | None = Field(default=None, max_length=40)
    assignee_id: str | None = Field(default=None, max_length=40)
    follow_up_on: date | None = None


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def check(self):
        self.text = self.text.strip()
        if not self.text:
            raise ValueError("Write something first.")
        return self


# Inquiries ------------------------------------------------------------------

@router.post("/api/listings/{listing_id}/inquiries", status_code=201)
# Per IP, whether signed in or not, so one person can't flood a seller
@limiter.limit("5/hour;20/day", key_func=get_remote_address)
def inquire(request: Request, listing_id: str, body: InquiryIn, user: dict | None = Depends(optional_user)):
    listing = store.get_listing(listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    seller = listing["contact_name"]
    if body.website:
        # A bot: answer as if it worked, and keep nothing
        return {"sent": True, "thread_id": None, "seller": seller}
    if listing["status"] != "active":
        raise HTTPException(status_code=409, detail="This property is marked as sold, so the seller isn't taking messages about it.")
    poster = store.listing_poster(listing_id)
    if user and user["id"] == poster["user_id"]:
        raise HTTPException(status_code=422, detail="This is your listing.")

    email = body.email or (user["email"].lower() if user else None)
    if not body.phone and not email:
        raise HTTPException(status_code=422, detail="Add a phone number or an email, so the seller can reply.")

    if poster["org_id"]:
        org_id = poster["org_id"]
        # The poster works the lead while they're still on the team; otherwise an admin assigns it
        assignee = poster["user_id"] if orgs_repo.role_of(poster["user_id"], org_id) else None
    else:
        org_id = orgs_repo.personal_org(poster["user_id"])["id"]
        assignee = poster["user_id"]

    lead_id, _ = crm_repo.add_inquiry(
        org_id=org_id,
        listing_id=listing_id,
        assignee_id=assignee,
        name=body.name,
        phone=body.phone,
        email=email,
        message=body.message,
        buyer_id=user["id"] if user else None,
        consent_version=CONSENT_VERSION,
    )
    # Only a signed-in buyer gets the thread back, to read replies in Messages
    return {"sent": True, "thread_id": lead_id if user else None, "seller": seller}


# The team's CRM -------------------------------------------------------------

@router.post("/api/business/personal")
def personal_crm(user: dict = Depends(authenticate)):
    """Your own CRM, made the first time you open it"""
    org = orgs_repo.personal_org(user["id"])
    return {**org, "role": "owner", "members": 1}


def _org_members(org_id: str) -> list[dict]:
    return [{"id": m["id"], "name": m["name"] or m["email"], "role": m["role"]} for m in orgs_repo.members(org_id)]


@router.get("/api/business/orgs/{org_id}/crm")
def crm_board(org_id: str, user: dict = Depends(authenticate)):
    role = can(user, "leads.view", org_id)
    return {
        "stages": crm_repo.stages(org_id),
        "leads": crm_repo.leads(org_id, assignee_id=user["id"] if role == "guest" else None),
        "members": _org_members(org_id),
        "role": role,
    }


def _check_assignee(org_id: str, assignee_id: str | None) -> None:
    if assignee_id and orgs_repo.role_of(assignee_id, org_id) is None:
        raise HTTPException(status_code=422, detail="Assign the lead to someone on the team.")


def _check_listing(org_id: str, user: dict, listing_id: str | None) -> None:
    """A manual lead may only point at one of the org's listings (or, in a personal CRM, your own)"""
    if not listing_id:
        return
    poster = store.listing_poster(listing_id)
    org = orgs_repo.get_org(org_id)
    ok = poster is not None and (
        poster["org_id"] == org_id or (org["kind"] == "personal" and not poster["org_id"] and poster["user_id"] == user["id"])
    )
    if not ok:
        raise HTTPException(status_code=422, detail="Pick one of this account's listings.")


@router.post("/api/business/orgs/{org_id}/leads", status_code=201)
@limiter.limit("60/hour")
def add_lead(request: Request, org_id: str, body: LeadIn, user: dict = Depends(authenticate)):
    can(user, "leads.edit", org_id)
    _check_assignee(org_id, body.assignee_id)
    _check_listing(org_id, user, body.listing_id)
    lead_id = crm_repo.add_manual_lead(
        org_id=org_id,
        actor_id=user["id"],
        name=body.name,
        phone=body.phone,
        email=body.email,
        listing_id=body.listing_id,
        note=(body.note or "").strip() or None,
        assignee_id=body.assignee_id,
        follow_up_on=body.follow_up_on.isoformat() if body.follow_up_on else None,
    )
    return crm_repo.lead(org_id, lead_id)


def _visible_lead(user: dict, org_id: str, lead_id: str, action: str = "leads.view") -> dict:
    role = can(user, action, org_id)
    found = crm_repo.lead(org_id, lead_id)
    if found is None or (role == "guest" and (found["assignee"] or {}).get("id") != user["id"]):
        raise HTTPException(status_code=404, detail=LEAD_GONE)
    return found


@router.get("/api/business/orgs/{org_id}/leads/{lead_id}")
def get_lead(org_id: str, lead_id: str, user: dict = Depends(authenticate)):
    found = _visible_lead(user, org_id, lead_id)
    crm_repo.mark_read(lead_id, "team")
    return {**found, "unread": 0}


@router.get("/api/business/leads/{lead_id}")
def find_lead(lead_id: str, user: dict = Depends(authenticate)):
    """A lead by its id alone, for links. Same checks as above: outsiders get 404."""
    org_id = crm_repo.lead_org(lead_id)
    if org_id is None:
        raise HTTPException(status_code=404, detail=LEAD_GONE)
    return get_lead(org_id, lead_id, user)


@router.patch("/api/business/orgs/{org_id}/leads/{lead_id}")
def update_lead(org_id: str, lead_id: str, body: LeadPatch, user: dict = Depends(authenticate)):
    can(user, "leads.edit", org_id)
    changes = {}
    for key in body.model_fields_set:
        value = getattr(body, key)
        changes[key] = value.isoformat() if isinstance(value, date) else value
    if "stage_id" in changes and not changes["stage_id"]:
        raise HTTPException(status_code=422, detail="Pick a stage.")
    _check_assignee(org_id, changes.get("assignee_id"))
    if not crm_repo.update_lead(org_id, lead_id, user["id"], changes):
        raise HTTPException(status_code=404, detail=LEAD_GONE)
    return crm_repo.lead(org_id, lead_id)


@router.post("/api/business/orgs/{org_id}/leads/{lead_id}/notes", status_code=201)
@limiter.limit("120/hour")
def add_note(request: Request, org_id: str, lead_id: str, body: TextIn, user: dict = Depends(authenticate)):
    can(user, "leads.edit", org_id)
    if not crm_repo.add_note(org_id, lead_id, user["id"], body.text):
        raise HTTPException(status_code=404, detail=LEAD_GONE)
    return crm_repo.lead(org_id, lead_id)


@router.post("/api/business/orgs/{org_id}/leads/{lead_id}/messages", status_code=201)
@limiter.limit("120/hour")
def reply(request: Request, org_id: str, lead_id: str, body: TextIn, user: dict = Depends(authenticate)):
    found = _visible_lead(user, org_id, lead_id, "leads.edit")
    if not found["contact"]["has_account"]:
        raise HTTPException(status_code=409, detail="This buyer asked without a SmartLand account, so they can't see messages here. Reply by phone or email.")
    crm_repo.team_reply(org_id, lead_id, user["id"], body.text)
    return crm_repo.lead(org_id, lead_id)


@router.delete("/api/business/orgs/{org_id}/leads/{lead_id}", status_code=204)
def delete_lead(org_id: str, lead_id: str, user: dict = Depends(authenticate)):
    can(user, "leads.delete", org_id)
    if not crm_repo.delete_lead(org_id, lead_id):
        raise HTTPException(status_code=404, detail=LEAD_GONE)
    return Response(status_code=204)


# The buyer's messages -------------------------------------------------------

THREAD_GONE = "Conversation not found"


@router.get("/api/messages")
def my_threads(user: dict = Depends(authenticate)):
    return crm_repo.buyer_threads(user["id"])


@router.get("/api/messages/unread")
def my_unread(user: dict = Depends(authenticate)):
    return {"count": crm_repo.unread_for_buyer(user["id"])}


@router.get("/api/messages/{thread_id}")
def my_thread(thread_id: str, user: dict = Depends(authenticate)):
    found = crm_repo.buyer_thread(user["id"], thread_id)
    if found is None:
        raise HTTPException(status_code=404, detail=THREAD_GONE)
    crm_repo.mark_read(thread_id, "buyer")
    return {**found, "unread": 0}


@router.post("/api/messages/{thread_id}", status_code=201)
@limiter.limit("30/hour")
def send_to_seller(request: Request, thread_id: str, body: TextIn, user: dict = Depends(authenticate)):
    if not crm_repo.buyer_reply(user["id"], thread_id, body.text):
        raise HTTPException(status_code=404, detail=THREAD_GONE)
    return crm_repo.buyer_thread(user["id"], thread_id)
