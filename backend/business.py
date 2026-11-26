"""Business accounts: create an org, manage its team, and accept invites.

Every route checks permissions.can() first. See docs/business-suite.md.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator

import orgs_repo
from deps import authenticate, limiter
from permissions import can

router = APIRouter()

OrgKind = Literal["brokerage", "developer", "agency", "other"]
# Owner is never given out: each org has exactly one, its creator
InviteRole = Literal["admin", "member", "guest"]


class OrgIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    kind: OrgKind
    prc_license: str | None = Field(default=None, pattern=r"^\d{4,10}$")

    @model_validator(mode="after")
    def check(self):
        self.name = self.name.strip()
        if len(self.name) < 2:
            raise ValueError("Enter the business name.")
        if self.kind == "brokerage" and not self.prc_license:
            raise ValueError("Brokerages must give the broker's PRC license number")
        if self.kind != "brokerage":
            self.prc_license = None
        return self


class InviteIn(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: InviteRole


class RoleIn(BaseModel):
    role: InviteRole


def _personal_has_no_team(org: dict) -> None:
    if org["kind"] == "personal":
        raise HTTPException(status_code=422, detail="Your personal CRM has no team. Create a business account to invite people.")


@router.post("/api/business/orgs", status_code=201)
@limiter.limit("5/hour")
def create_org(request: Request, body: OrgIn, user: dict = Depends(authenticate)):
    org = orgs_repo.create_org(user["id"], body.name, body.kind, body.prc_license)
    return {**org, "role": "owner", "members": 1}


@router.get("/api/business/orgs/mine")
def my_orgs(user: dict = Depends(authenticate)):
    return orgs_repo.user_orgs(user["id"])


@router.get("/api/business/orgs/{org_id}")
def get_org(org_id: str, user: dict = Depends(authenticate)):
    role = can(user, "org.view", org_id)
    return {**orgs_repo.get_org(org_id), "role": role}


@router.get("/api/business/orgs/{org_id}/members")
def list_members(org_id: str, user: dict = Depends(authenticate)):
    role = can(user, "org.view", org_id)
    manage = role in ("owner", "admin")
    return {"members": orgs_repo.members(org_id), "invites": orgs_repo.pending_invites(org_id) if manage else []}


@router.post("/api/business/orgs/{org_id}/invites", status_code=201)
@limiter.limit("30/hour")
def invite(request: Request, org_id: str, body: InviteIn, user: dict = Depends(authenticate)):
    can(user, "members.manage", org_id)
    _personal_has_no_team(orgs_repo.get_org(org_id))
    email = body.email.strip().lower()
    if any(m["email"] == email for m in orgs_repo.members(org_id)):
        raise HTTPException(status_code=409, detail=f"{email} is already on the team.")
    created, token = orgs_repo.create_invite(org_id, email, body.role, user["id"])
    # The token is shown this once. Only its fingerprint is stored.
    return {**created, "token": token, "path": f"/invite/{token}"}


@router.delete("/api/business/orgs/{org_id}/invites/{invite_id}", status_code=204)
def cancel_invite(org_id: str, invite_id: str, user: dict = Depends(authenticate)):
    can(user, "members.manage", org_id)
    if not orgs_repo.cancel_invite(org_id, invite_id):
        raise HTTPException(status_code=404, detail="Invite not found")
    return Response(status_code=204)


def _check_target(user: dict, my_role: str, org_id: str, target_id: str) -> str:
    """The target's role, after the rules every role change and removal share"""
    target = orgs_repo.role_of(target_id, org_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if target == "owner":
        raise HTTPException(status_code=403, detail="The owner can't be removed or given another role.")
    if my_role == "admin" and target == "admin" and target_id != user["id"]:
        raise HTTPException(status_code=403, detail="Only the owner can change another admin.")
    return target


@router.patch("/api/business/orgs/{org_id}/members/{member_id}")
def change_role(org_id: str, member_id: str, body: RoleIn, user: dict = Depends(authenticate)):
    my_role = can(user, "members.manage", org_id)
    _check_target(user, my_role, org_id, member_id)
    orgs_repo.set_role(org_id, member_id, body.role)
    return {"user_id": member_id, "role": body.role}


@router.delete("/api/business/orgs/{org_id}/members/{member_id}", status_code=204)
def remove_member(org_id: str, member_id: str, user: dict = Depends(authenticate)):
    # Anyone but the owner may leave; removing someone else takes owner or admin
    my_role = can(user, "org.view" if member_id == user["id"] else "members.manage", org_id)
    _check_target(user, my_role, org_id, member_id)
    orgs_repo.remove_member(org_id, member_id)
    return Response(status_code=204)


GONE = "This invite was used, expired, or never existed. Ask for a new one."


@router.get("/api/invites/{token}")
@limiter.limit("30/15minute")
def invite_preview(request: Request, token: str):
    found = orgs_repo.find_invite(token)
    if found is None:
        raise HTTPException(status_code=404, detail=GONE)
    return {k: found[k] for k in ("email", "role", "expires_at", "org_name", "inviter")}


@router.post("/api/invites/{token}/accept")
@limiter.limit("20/hour")
def accept(request: Request, token: str, user: dict = Depends(authenticate)):
    found = orgs_repo.find_invite(token)
    if found is None:
        raise HTTPException(status_code=404, detail=GONE)
    if found["email"] != user["email"].lower():
        raise HTTPException(status_code=403, detail=f"This invite is for {found['email']}. Sign in with that email to join.")
    org_id = orgs_repo.accept_invite(token, user["id"])
    if org_id is None:
        raise HTTPException(status_code=404, detail=GONE)
    return {"org_id": org_id}
