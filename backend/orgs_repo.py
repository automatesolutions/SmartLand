"""Business accounts: orgs, members, and invites. All SQL for those tables lives here."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import db

INVITE_DAYS = 7


def _org(row) -> dict:
    return {k: row[k] for k in ("id", "name", "kind", "prc_license", "created_at")}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# Orgs -----------------------------------------------------------------------

def create_org(user_id: str, name: str, kind: str, prc_license: str | None) -> dict:
    """Creates an org with `user_id` as its owner"""
    org_id = secrets.token_urlsafe(9)
    now = db.now()
    with db.transaction() as c:
        c.execute(
            "INSERT INTO orgs (id, name, kind, prc_license, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (org_id, name, kind, prc_license, user_id, now),
        )
        c.execute("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", (org_id, user_id, now))
    return get_org(org_id)


def personal_org(user_id: str) -> dict:
    """A seller's own CRM, made the first time they need it. Only they are on it."""
    with db.lock:
        row = db.conn().execute("SELECT * FROM orgs WHERE created_by = ? AND kind = 'personal'", (user_id,)).fetchone()
        if row is None:
            return create_org(user_id, "Personal CRM", "personal", None)
    return _org(row)


def get_org(org_id: str) -> dict | None:
    with db.lock:
        row = db.conn().execute("SELECT * FROM orgs WHERE id = ?", (org_id,)).fetchone()
    return _org(row) if row else None


def user_orgs(user_id: str) -> list[dict]:
    """The orgs a user belongs to, each with their role and the member count"""
    with db.lock:
        rows = db.conn().execute(
            """SELECT o.*, m.role, (SELECT COUNT(*) FROM org_members x WHERE x.org_id = o.id) AS members
               FROM org_members m JOIN orgs o ON o.id = m.org_id
               WHERE m.user_id = ? ORDER BY o.kind = 'personal', o.name""",
            (user_id,),
        ).fetchall()
    return [{**_org(r), "role": r["role"], "members": r["members"]} for r in rows]


def orgs_by_id(org_ids: list[str]) -> dict[str, dict]:
    """Many orgs at once, for listing results"""
    ids = list({i for i in org_ids if i})
    if not ids:
        return {}
    marks = ", ".join("?" for _ in ids)
    with db.lock:
        rows = db.conn().execute(f"SELECT * FROM orgs WHERE id IN ({marks})", ids).fetchall()
    return {r["id"]: _org(r) for r in rows}


# Members --------------------------------------------------------------------

def role_of(user_id: str, org_id: str) -> str | None:
    with db.lock:
        row = db.conn().execute("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?", (org_id, user_id)).fetchone()
    return row["role"] if row else None


def members(org_id: str) -> list[dict]:
    with db.lock:
        rows = db.conn().execute(
            """SELECT u.id, u.email, u.name, m.role, m.joined_at FROM org_members m JOIN users u ON u.id = m.user_id
               WHERE m.org_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.email""",
            (org_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def set_role(org_id: str, user_id: str, role: str) -> bool:
    with db.transaction() as c:
        cur = c.execute("UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ? AND role != 'owner'", (role, org_id, user_id))
    return cur.rowcount > 0


def remove_member(org_id: str, user_id: str) -> bool:
    with db.transaction() as c:
        cur = c.execute("DELETE FROM org_members WHERE org_id = ? AND user_id = ? AND role != 'owner'", (org_id, user_id))
    return cur.rowcount > 0


# Invites --------------------------------------------------------------------

def _invite(row) -> dict:
    return {k: row[k] for k in ("id", "email", "role", "created_at", "expires_at")}


def create_invite(org_id: str, email: str, role: str, invited_by: str) -> tuple[dict, str]:
    """Returns the invite and its token. The token is shown once and never stored."""
    token = secrets.token_urlsafe(24)
    invite_id = secrets.token_urlsafe(9)
    now = datetime.now(timezone.utc)
    with db.transaction() as c:
        # A new invite for the same email replaces the old one
        c.execute("DELETE FROM org_invites WHERE org_id = ? AND email = ? AND accepted_at IS NULL", (org_id, email.lower()))
        c.execute(
            """INSERT INTO org_invites (id, org_id, email, role, token_hash, invited_by, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (invite_id, org_id, email.lower(), role, _hash(token), invited_by, now.isoformat(), (now + timedelta(days=INVITE_DAYS)).isoformat()),
        )
        row = c.execute("SELECT * FROM org_invites WHERE id = ?", (invite_id,)).fetchone()
    return _invite(row), token


def pending_invites(org_id: str) -> list[dict]:
    with db.lock:
        rows = db.conn().execute(
            "SELECT * FROM org_invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
            (org_id, db.now()),
        ).fetchall()
    return [_invite(r) for r in rows]


def cancel_invite(org_id: str, invite_id: str) -> bool:
    with db.transaction() as c:
        cur = c.execute("DELETE FROM org_invites WHERE id = ? AND org_id = ? AND accepted_at IS NULL", (invite_id, org_id))
    return cur.rowcount > 0


def find_invite(token: str) -> dict | None:
    """An open invite by its token, with the org and inviter. None if used, expired, or unknown."""
    with db.lock:
        row = db.conn().execute(
            """SELECT i.*, o.name AS org_name, o.kind AS org_kind, u.name AS inviter_name, u.email AS inviter_email
               FROM org_invites i JOIN orgs o ON o.id = i.org_id JOIN users u ON u.id = i.invited_by
               WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?""",
            (_hash(token), db.now()),
        ).fetchone()
    if row is None:
        return None
    return {
        **_invite(row),
        "org_id": row["org_id"],
        "org_name": row["org_name"],
        "org_kind": row["org_kind"],
        "inviter": row["inviter_name"] or row["inviter_email"],
    }


def accept_invite(token: str, user_id: str) -> str | None:
    """Adds the user with the invite's role and closes the invite. Returns the org id.
    Someone already in the org keeps their current role."""
    with db.transaction() as c:
        row = c.execute(
            "SELECT * FROM org_invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?", (_hash(token), db.now())
        ).fetchone()
        if row is None:
            return None
        c.execute(
            "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT (org_id, user_id) DO NOTHING",
            (row["org_id"], user_id, row["role"], db.now()),
        )
        c.execute("UPDATE org_invites SET accepted_at = ?, accepted_by = ? WHERE id = ?", (db.now(), user_id, row["id"]))
    return row["org_id"]
