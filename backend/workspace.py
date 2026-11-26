"""Team workspace for business accounts: channels, direct messages, @mentions, and tasks.

Every route checks permissions.can() first: outsiders get 404. DMs are visible only to
the two people in them, owners and admins included. See docs/business-suite.md, section 5.
"""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator

import crm_repo
import db
import orgs_repo
import store
import workspace_repo as ws
from deps import authenticate, limiter
from permissions import can, may

router = APIRouter()

CHANNEL_GONE = "Channel not found"
TASK_GONE = "Task not found"


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    topic: str | None = Field(default=None, max_length=200)

    @field_validator("name")
    @classmethod
    def slug(cls, v: str) -> str:
        v = "-".join(v.strip().lower().lstrip("#").split())
        if not v or not all(ch.isalnum() or ch == "-" for ch in v):
            raise ValueError("Use letters, numbers, and dashes, like viewings or batangas-lots.")
        return v


class ChannelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    topic: str | None = Field(default=None, max_length=200)
    archived: bool | None = None

    @field_validator("name")
    @classmethod
    def slug(cls, v: str | None) -> str | None:
        return ChannelIn.slug(v) if v is not None else v


class DmIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def check(self):
        self.body = self.body.strip()
        if not self.body:
            raise ValueError("Write a message first.")
        return self


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    assignee_id: str | None = Field(default=None, max_length=64)
    due_on: date | None = None
    lead_id: str | None = Field(default=None, max_length=40)
    listing_id: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def check(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Give the task a title.")
        self.notes = (self.notes or "").strip() or None
        return self


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    assignee_id: str | None = Field(default=None, max_length=64)
    due_on: date | None = None
    status: Literal["open", "done"] | None = None


# Checks ---------------------------------------------------------------------------

def _org(user: dict, org_id: str, action: str) -> str:
    role = can(user, action, org_id)
    if orgs_repo.get_org(org_id)["kind"] == "personal":
        raise HTTPException(status_code=422, detail="Your personal CRM has no team workspace. Create a business account to get one.")
    return role


def _channel(user: dict, org_id: str, channel_id: str):
    ch = ws.get_channel(org_id, channel_id)
    if ch is None or (ch["kind"] == "dm" and not ws.is_dm_member(channel_id, user["id"])):
        raise HTTPException(status_code=404, detail=CHANNEL_GONE)
    return ch


def _member_ids(org_id: str) -> set[str]:
    return {m["id"] for m in orgs_repo.members(org_id)}


def _check_assignee(org_id: str, assignee_id: str | None) -> None:
    if assignee_id and orgs_repo.role_of(assignee_id, org_id) is None:
        raise HTTPException(status_code=422, detail="Assign the task to someone on the team.")


# Channels and DMs -----------------------------------------------------------------

@router.get("/api/business/orgs/{org_id}/workspace")
def workspace(org_id: str, user: dict = Depends(authenticate)):
    role = _org(user, org_id, "workspace.view")
    ws.ensure_general(org_id, user["id"])
    members = [{"id": m["id"], "name": m["name"] or m["email"], "role": m["role"]} for m in orgs_repo.members(org_id)]
    return {"channels": ws.channels_for(org_id, user["id"]), "members": members, "role": role}


@router.post("/api/business/orgs/{org_id}/workspace/channels", status_code=201)
@limiter.limit("30/hour")
def create_channel(request: Request, org_id: str, body: ChannelIn, user: dict = Depends(authenticate)):
    _org(user, org_id, "channels.manage")
    ws.ensure_general(org_id, user["id"])
    cid = ws.create_channel(org_id, body.name, (body.topic or "").strip() or None, user["id"])
    if cid is None:
        raise HTTPException(status_code=409, detail=f"There's already a #{body.name} channel.")
    return next(c for c in ws.channels_for(org_id, user["id"]) if c["id"] == cid)


@router.patch("/api/business/orgs/{org_id}/workspace/channels/{channel_id}")
def update_channel(org_id: str, channel_id: str, body: ChannelPatch, user: dict = Depends(authenticate)):
    _org(user, org_id, "channels.manage")
    changes = {k: getattr(body, k) for k in body.model_fields_set}
    if "topic" in changes:
        changes["topic"] = (changes["topic"] or "").strip() or None
    problem = ws.update_channel(org_id, channel_id, changes)
    if problem == "missing":
        raise HTTPException(status_code=404, detail=CHANNEL_GONE)
    if problem == "general":
        raise HTTPException(status_code=422, detail="#general can't be renamed or archived.")
    if problem == "taken":
        raise HTTPException(status_code=409, detail=f"There's already a #{changes['name']} channel.")
    return {"ok": True}


@router.post("/api/business/orgs/{org_id}/workspace/dms")
def open_dm(org_id: str, body: DmIn, user: dict = Depends(authenticate)):
    _org(user, org_id, "workspace.view")
    if body.user_id == user["id"] or orgs_repo.role_of(body.user_id, org_id) is None:
        raise HTTPException(status_code=422, detail="Pick someone else on the team.")
    cid = ws.dm(org_id, user["id"], body.user_id)
    return next(c for c in ws.channels_for(org_id, user["id"]) if c["id"] == cid)


# Messages -------------------------------------------------------------------------

@router.get("/api/business/orgs/{org_id}/workspace/channels/{channel_id}/messages")
def channel_messages(
    org_id: str,
    channel_id: str,
    since: str | None = Query(default=None, max_length=40),
    before: str | None = Query(default=None, max_length=40),
    user: dict = Depends(authenticate),
):
    """The newest page, an older page (`before`), or what changed since the last poll (`since`).
    Pass the returned cursor as `since` next time."""
    _org(user, org_id, "workspace.view")
    _channel(user, org_id, channel_id)
    # Taken before reading, so nothing written in between is missed; the client drops repeats by id
    cursor = db.now()
    found = ws.messages(channel_id, since=since, before=before)
    if not before:
        ws.mark_read(channel_id, user["id"])
    return {"messages": found, "cursor": cursor}


@router.post("/api/business/orgs/{org_id}/workspace/channels/{channel_id}/messages", status_code=201)
@limiter.limit("600/hour")
def post_message(request: Request, org_id: str, channel_id: str, body: MessageIn, user: dict = Depends(authenticate)):
    _org(user, org_id, "workspace.post")
    ch = _channel(user, org_id, channel_id)
    if ch["archived_at"]:
        raise HTTPException(status_code=409, detail="This channel is archived.")
    mentions = ws.mentioned_ids(body.body) & _member_ids(org_id)
    return ws.post(channel_id, user["id"], body.body, mentions)


def _own_message(user: dict, org_id: str, message_id: str):
    msg = ws.get_message(org_id, message_id)
    if msg is None or msg["deleted_at"] or (msg["channel_kind"] == "dm" and not ws.is_dm_member(msg["channel_id"], user["id"])):
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


@router.patch("/api/business/orgs/{org_id}/workspace/messages/{message_id}")
def edit_message(org_id: str, message_id: str, body: MessageIn, user: dict = Depends(authenticate)):
    _org(user, org_id, "workspace.post")
    msg = _own_message(user, org_id, message_id)
    if msg["author_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own messages.")
    return ws.edit(message_id, body.body, ws.mentioned_ids(body.body) & _member_ids(org_id))


@router.delete("/api/business/orgs/{org_id}/workspace/messages/{message_id}", status_code=204)
def delete_message(org_id: str, message_id: str, user: dict = Depends(authenticate)):
    _org(user, org_id, "workspace.view")
    msg = _own_message(user, org_id, message_id)
    # Owners and admins can remove anything in a channel, never in someone's DM
    moderator = msg["channel_kind"] == "channel" and may(user, "channels.manage", org_id)
    if msg["author_id"] != user["id"] and not moderator:
        raise HTTPException(status_code=403, detail="You can only delete your own messages.")
    ws.delete(message_id)
    return Response(status_code=204)


@router.get("/api/business/workspace/unread")
def unread(user: dict = Depends(authenticate)):
    """New DMs plus new @mentions, for the nav badge"""
    return ws.unread_totals(user["id"])


# Tasks ----------------------------------------------------------------------------

@router.get("/api/business/orgs/{org_id}/workspace/tasks")
def list_tasks(
    org_id: str,
    status: Literal["open", "done"] | None = None,
    mine: bool = False,
    lead_id: str | None = Query(default=None, max_length=40),
    user: dict = Depends(authenticate),
):
    _org(user, org_id, "workspace.view")
    return ws.tasks(org_id, status=status, assignee_id=user["id"] if mine else None, lead_id=lead_id)


@router.post("/api/business/orgs/{org_id}/workspace/tasks", status_code=201)
@limiter.limit("120/hour")
def create_task(request: Request, org_id: str, body: TaskIn, user: dict = Depends(authenticate)):
    _org(user, org_id, "workspace.post")
    _check_assignee(org_id, body.assignee_id)
    if body.lead_id and crm_repo.lead_org(body.lead_id) != org_id:
        raise HTTPException(status_code=422, detail="Link the task to one of this account's leads.")
    if body.listing_id and (store.listing_poster(body.listing_id) or {}).get("org_id") != org_id:
        raise HTTPException(status_code=422, detail="Link the task to one of this account's listings.")
    fields = body.model_dump()
    fields["due_on"] = body.due_on.isoformat() if body.due_on else None
    return ws.create_task(org_id, user["id"], fields)


@router.patch("/api/business/orgs/{org_id}/workspace/tasks/{task_id}")
def update_task(org_id: str, task_id: str, body: TaskPatch, user: dict = Depends(authenticate)):
    _org(user, org_id, "workspace.post")
    changes = {k: getattr(body, k) for k in body.model_fields_set}
    if "title" in changes:
        changes["title"] = (changes["title"] or "").strip()
        if not changes["title"]:
            raise HTTPException(status_code=422, detail="Give the task a title.")
    if "status" in changes and changes["status"] is None:
        raise HTTPException(status_code=422, detail="Pick open or done.")
    if "due_on" in changes:
        changes["due_on"] = changes["due_on"].isoformat() if changes["due_on"] else None
    if "notes" in changes:
        changes["notes"] = (changes["notes"] or "").strip() or None
    _check_assignee(org_id, changes.get("assignee_id"))
    updated = ws.update_task(org_id, task_id, changes)
    if updated is None:
        raise HTTPException(status_code=404, detail=TASK_GONE)
    return updated


@router.delete("/api/business/orgs/{org_id}/workspace/tasks/{task_id}", status_code=204)
def delete_task(org_id: str, task_id: str, user: dict = Depends(authenticate)):
    role = _org(user, org_id, "workspace.post")
    task = ws.get_task(org_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=TASK_GONE)
    if task["created_by"] != user["id"] and role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only the person who made a task, or an owner or admin, can delete it.")
    ws.delete_task(org_id, task_id)
    return Response(status_code=204)
