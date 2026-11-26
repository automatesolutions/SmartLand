"""Who may do what in an org. Every business route calls can() before it reads or writes.

Someone outside the org gets 404, so org IDs can't be probed. A member whose
role is too low gets 403. The role table is in docs/business-suite.md.
"""

from fastapi import HTTPException

import orgs_repo

ROLES = ("owner", "admin", "member", "guest")

ALLOWED: dict[str, set[str]] = {
    "org.view": {"owner", "admin", "member", "guest"},
    "org.edit": {"owner", "admin"},
    "members.manage": {"owner", "admin"},
    "listing.post_as_org": {"owner", "admin", "member"},
    "listing.edit_any": {"owner", "admin"},
    # Team workspace: guests read, members chat and work tasks, owners and admins run the channels
    "workspace.view": {"owner", "admin", "member", "guest"},
    "workspace.post": {"owner", "admin", "member"},
    "channels.manage": {"owner", "admin"},
    # Guests see only the leads assigned to them
    "leads.view": {"owner", "admin", "member", "guest"},
    "leads.edit": {"owner", "admin", "member"},
    "leads.delete": {"owner", "admin"},
    # Visits and inquiries per listing and source. Guests see only their own leads, so not this.
    "performance.view": {"owner", "admin", "member"},
}

NOT_FOUND = "Business account not found"


def role(user: dict, org_id: str) -> str | None:
    return orgs_repo.role_of(user["id"], org_id)


def can(user: dict, action: str, org_id: str) -> str:
    """Returns the user's role in the org, or raises 404 (not a member) or 403 (role too low)"""
    r = role(user, org_id)
    if r is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    if r not in ALLOWED[action]:
        raise HTTPException(status_code=403, detail="Your role in this business account can't do that.")
    return r


def may(user: dict | None, action: str, org_id: str) -> bool:
    """can() without raising, for deciding what to show"""
    if user is None:
        return False
    r = role(user, org_id)
    return r is not None and r in ALLOWED[action]


def can_edit_listing(user: dict | None, poster: dict | None) -> bool:
    """The person who posted a listing may edit it. For an org listing, so may its
    owner and admins, and the poster only while they're still a member."""
    if user is None or poster is None:
        return False
    if not poster["org_id"]:
        return poster["user_id"] == user["id"]
    if may(user, "listing.edit_any", poster["org_id"]):
        return True
    return poster["user_id"] == user["id"] and may(user, "listing.post_as_org", poster["org_id"])
