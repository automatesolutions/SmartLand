"""CRM: pipeline stages, contacts, leads, their timeline, and buyer messages.
All SQL for those tables lives here. Callers check permissions first.
"""

import json
import re
import secrets
from datetime import datetime, timedelta, timezone

import db

DEFAULT_STAGES = [
    ("New", None),
    ("Contacted", None),
    ("Viewing set", None),
    ("Offer", None),
    ("Closed won", "won"),
    ("Closed lost", "lost"),
]
# A repeat inquiry from the same phone or email within this window joins the open lead
DEDUPE_HOURS = 24
# Contact details of leads closed this long ago are removed (Data Privacy Act of 2012)
KEEP_DAYS = 2 * 365


def _id() -> str:
    return secrets.token_urlsafe(9)


def normalize_phone(phone: str | None) -> str | None:
    """Digits only, with a leading + kept, so "0917 555 0100" and "09175550100" match"""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    return ("+" + digits if phone.strip().startswith("+") else digits) or None


# Stages ---------------------------------------------------------------------

def stages(org_id: str) -> list[dict]:
    """The org's stages in order, seeding the defaults the first time"""
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM pipeline_stages WHERE org_id = ? ORDER BY position", (org_id,)).fetchall()
        if not rows:
            for pos, (name, outcome) in enumerate(DEFAULT_STAGES):
                c.execute(
                    "INSERT INTO pipeline_stages (id, org_id, name, position, outcome) VALUES (?, ?, ?, ?, ?)",
                    (_id(), org_id, name, pos, outcome),
                )
            rows = c.execute("SELECT * FROM pipeline_stages WHERE org_id = ? ORDER BY position", (org_id,)).fetchall()
    return [{k: r[k] for k in ("id", "name", "position", "outcome")} for r in rows]


def _stage(c, org_id: str, stage_id: str):
    return c.execute("SELECT * FROM pipeline_stages WHERE id = ? AND org_id = ?", (stage_id, org_id)).fetchone()


# Writing --------------------------------------------------------------------

def _log(c, lead_id: str, actor_id: str | None, kind: str, body: dict) -> None:
    c.execute(
        "INSERT INTO lead_activities (id, lead_id, actor_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (_id(), lead_id, actor_id, kind, json.dumps(body), db.now()),
    )


def _message(c, lead_id: str, sender: str, author_id: str | None, body: str) -> None:
    now = db.now()
    c.execute(
        "INSERT INTO lead_messages (id, lead_id, sender, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (_id(), lead_id, sender, author_id, body, now),
    )
    # Sending a message means you've read the thread up to it
    read_col = "buyer_read_at" if sender == "buyer" else "team_read_at"
    c.execute(f"UPDATE leads SET last_message_at = ?, {read_col} = ?, updated_at = ? WHERE id = ?", (now, now, now, lead_id))


def add_inquiry(
    *,
    org_id: str,
    listing_id: str,
    assignee_id: str | None,
    name: str,
    phone: str | None,
    email: str | None,
    message: str,
    buyer_id: str | None,
    consent_version: str,
    ref: dict | None = None,
) -> tuple[str, bool]:
    """Files a buyer's inquiry as a lead in the first stage. Returns (lead id, created).

    A signed-in buyer with an open lead on this listing, or anyone repeating the same
    phone or email within DEDUPE_HOURS, adds to that lead's thread instead.
    `ref` is where the buyer came from ({source, medium, campaign}); a repeat keeps the first.
    """
    phone = normalize_phone(phone)
    email = email.lower() if email else None
    first = stages(org_id)[0]["id"]
    now = db.now()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=DEDUPE_HOURS)).isoformat()
    with db.transaction() as c:
        found = c.execute(
            """SELECT l.id, l.contact_id, c.user_id FROM leads l JOIN contacts c ON c.id = l.contact_id
               WHERE l.org_id = ? AND l.listing_id = ? AND l.closed_at IS NULL
                 AND ((? IS NOT NULL AND c.user_id = ?)
                      OR (l.created_at > ? AND ((? IS NOT NULL AND c.phone = ?) OR (? IS NOT NULL AND c.email = ?))))
               ORDER BY l.created_at DESC LIMIT 1""",
            (org_id, listing_id, buyer_id, buyer_id, cutoff, phone, phone, email, email),
        ).fetchone()
        if found:
            if buyer_id and not found["user_id"]:
                c.execute("UPDATE contacts SET user_id = ?, updated_at = ? WHERE id = ?", (buyer_id, now, found["contact_id"]))
            _message(c, found["id"], "buyer", buyer_id, message)
            _log(c, found["id"], None, "inquiry", {})
            return found["id"], False

        contact_id, lead_id = _id(), _id()
        c.execute(
            """INSERT INTO contacts (id, org_id, user_id, name, phone, email, consent_at, consent_version, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (contact_id, org_id, buyer_id, name, phone, email, now, consent_version, now, now),
        )
        c.execute(
            """INSERT INTO leads (id, org_id, contact_id, listing_id, stage_id, assignee_id, source, message,
                                  utm_source, utm_medium, utm_campaign, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'inquiry', ?, ?, ?, ?, ?, ?)""",
            (lead_id, org_id, contact_id, listing_id, first, assignee_id, message,
             ref and ref["source"], ref and (ref["medium"] or None), ref and (ref["campaign"] or None), now, now),
        )
        _log(c, lead_id, None, "created", {"source": "inquiry"})
        _message(c, lead_id, "buyer", buyer_id, message)
    return lead_id, True


def add_manual_lead(
    *,
    org_id: str,
    actor_id: str,
    name: str,
    phone: str | None,
    email: str | None,
    listing_id: str | None,
    note: str | None,
    assignee_id: str | None,
    follow_up_on: str | None,
) -> str:
    """A lead the team adds by hand, for example from a phone call"""
    first = stages(org_id)[0]["id"]
    now = db.now()
    contact_id, lead_id = _id(), _id()
    with db.transaction() as c:
        c.execute(
            """INSERT INTO contacts (id, org_id, name, phone, email, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (contact_id, org_id, name, normalize_phone(phone), email.lower() if email else None, actor_id, now, now),
        )
        c.execute(
            """INSERT INTO leads (id, org_id, contact_id, listing_id, stage_id, assignee_id, source, follow_up_on, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)""",
            (lead_id, org_id, contact_id, listing_id, first, assignee_id, follow_up_on, actor_id, now, now),
        )
        _log(c, lead_id, actor_id, "created", {"source": "manual"})
        if note:
            _log(c, lead_id, actor_id, "note", {"text": note})
    return lead_id


def update_lead(org_id: str, lead_id: str, actor_id: str, changes: dict) -> bool:
    """Applies stage_id, assignee_id, and follow_up_on from `changes`, one timeline entry each.
    Returns False if the lead or the stage isn't in this org."""
    now = db.now()
    with db.transaction() as c:
        lead = c.execute("SELECT * FROM leads WHERE id = ? AND org_id = ?", (lead_id, org_id)).fetchone()
        if lead is None:
            return False
        if "stage_id" in changes and changes["stage_id"] != lead["stage_id"]:
            new, old = _stage(c, org_id, changes["stage_id"]), _stage(c, org_id, lead["stage_id"])
            if new is None:
                return False
            closed = now if new["outcome"] else None
            c.execute("UPDATE leads SET stage_id = ?, closed_at = ?, updated_at = ? WHERE id = ?", (new["id"], closed, now, lead_id))
            _log(c, lead_id, actor_id, "stage", {"from": old["name"] if old else None, "to": new["name"]})
        if "assignee_id" in changes and changes["assignee_id"] != lead["assignee_id"]:
            c.execute("UPDATE leads SET assignee_id = ?, updated_at = ? WHERE id = ?", (changes["assignee_id"], now, lead_id))
            to = c.execute("SELECT name, email FROM users WHERE id = ?", (changes["assignee_id"],)).fetchone() if changes["assignee_id"] else None
            _log(c, lead_id, actor_id, "assigned", {"to": (to["name"] or to["email"]) if to else None})
        if "follow_up_on" in changes and changes["follow_up_on"] != lead["follow_up_on"]:
            c.execute("UPDATE leads SET follow_up_on = ?, updated_at = ? WHERE id = ?", (changes["follow_up_on"], now, lead_id))
            _log(c, lead_id, actor_id, "follow_up", {"on": changes["follow_up_on"]})
    return True


def add_note(org_id: str, lead_id: str, actor_id: str, text: str) -> bool:
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM leads WHERE id = ? AND org_id = ?", (lead_id, org_id)).fetchone() is None:
            return False
        _log(c, lead_id, actor_id, "note", {"text": text})
        c.execute("UPDATE leads SET updated_at = ? WHERE id = ?", (db.now(), lead_id))
    return True


def team_reply(org_id: str, lead_id: str, actor_id: str, body: str) -> bool:
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM leads WHERE id = ? AND org_id = ?", (lead_id, org_id)).fetchone() is None:
            return False
        _message(c, lead_id, "team", actor_id, body)
    return True


def buyer_reply(user_id: str, lead_id: str, body: str) -> bool:
    with db.transaction() as c:
        if _buyer_lead(c, user_id, lead_id) is None:
            return False
        _message(c, lead_id, "buyer", user_id, body)
    return True


def mark_read(lead_id: str, side: str) -> None:
    col = "buyer_read_at" if side == "buyer" else "team_read_at"
    with db.transaction() as c:
        c.execute(f"UPDATE leads SET {col} = ? WHERE id = ?", (db.now(), lead_id))


def delete_lead(org_id: str, lead_id: str) -> bool:
    """Removes the lead, and its contact when no other lead uses it"""
    with db.transaction() as c:
        lead = c.execute("SELECT contact_id FROM leads WHERE id = ? AND org_id = ?", (lead_id, org_id)).fetchone()
        if lead is None:
            return False
        c.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
        c.execute("DELETE FROM contacts WHERE id = ? AND NOT EXISTS (SELECT 1 FROM leads WHERE contact_id = ?)", (lead["contact_id"], lead["contact_id"]))
    return True


def purge_expired() -> int:
    """Removes the contact details and messages of leads closed more than KEEP_DAYS ago.
    The stage history stays. Returns how many contacts were cleared."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()
    with db.transaction() as c:
        # Contacts not cleared yet, with at least one lead, every one of them closed before the cutoff
        ids = [
            r["id"]
            for r in c.execute(
                """SELECT c.id FROM contacts c
                   WHERE c.name != 'Former contact'
                     AND EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id)
                     AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id AND (l.closed_at IS NULL OR l.closed_at > ?))""",
                (cutoff,),
            )
        ]
        for i in ids:
            c.execute(
                "UPDATE contacts SET name = 'Former contact', phone = NULL, email = NULL, user_id = NULL, updated_at = ? WHERE id = ?",
                (db.now(), i),
            )
            c.execute("DELETE FROM lead_messages WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = ?)", (i,))
            c.execute("UPDATE leads SET message = NULL WHERE contact_id = ?", (i,))
            c.execute("DELETE FROM lead_activities WHERE kind = 'note' AND lead_id IN (SELECT id FROM leads WHERE contact_id = ?)", (i,))
    return len(ids)


# Reading for the team -------------------------------------------------------

_LEAD_SELECT = """
    SELECT l.*, c.name AS contact_name, c.phone, c.email, c.user_id AS buyer_id, c.consent_at, c.consent_version,
           s.name AS stage_name, li.title AS listing_title, li.status AS listing_status,
           u.name AS assignee_name, u.email AS assignee_email,
           (SELECT COUNT(*) FROM lead_messages m
             WHERE m.lead_id = l.id AND m.sender = 'buyer' AND (l.team_read_at IS NULL OR m.created_at > l.team_read_at)) AS unread
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id
    JOIN pipeline_stages s ON s.id = l.stage_id
    LEFT JOIN listings li ON li.id = l.listing_id AND li.status != 'removed'
    LEFT JOIN users u ON u.id = l.assignee_id
"""


def _summary(r) -> dict:
    return {
        "id": r["id"],
        "org_id": r["org_id"],
        "contact_name": r["contact_name"],
        "stage_id": r["stage_id"],
        "stage": r["stage_name"],
        "listing": {"id": r["listing_id"], "title": r["listing_title"], "status": r["listing_status"]} if r["listing_title"] else None,
        "assignee": {"id": r["assignee_id"], "name": r["assignee_name"] or r["assignee_email"]} if r["assignee_id"] else None,
        "source": r["source"],
        # Where an inquiry's buyer came from, such as {"source": "facebook", ...}; null for direct visits and manual leads
        "ref": {"source": r["utm_source"], "medium": r["utm_medium"], "campaign": r["utm_campaign"]} if r["utm_source"] else None,
        "follow_up_on": r["follow_up_on"],
        "unread": r["unread"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "closed_at": r["closed_at"],
        "last_message_at": r["last_message_at"],
    }


def leads(org_id: str, assignee_id: str | None = None) -> list[dict]:
    """The org's leads, newest activity first. With `assignee_id`, only theirs."""
    sql = _LEAD_SELECT + " WHERE l.org_id = ?"
    args: list = [org_id]
    if assignee_id:
        sql += " AND l.assignee_id = ?"
        args.append(assignee_id)
    with db.lock:
        rows = db.conn().execute(sql + " ORDER BY l.updated_at DESC", args).fetchall()
    return [_summary(r) for r in rows]


def lead(org_id: str, lead_id: str) -> dict | None:
    """One lead with the contact's details, timeline, and messages"""
    with db.lock:
        c = db.conn()
        r = c.execute(_LEAD_SELECT + " WHERE l.org_id = ? AND l.id = ?", (org_id, lead_id)).fetchone()
        if r is None:
            return None
        acts = c.execute(
            """SELECT a.*, u.name AS actor_name, u.email AS actor_email FROM lead_activities a LEFT JOIN users u ON u.id = a.actor_id
               WHERE a.lead_id = ? ORDER BY a.created_at, a.rowid""",
            (lead_id,),
        ).fetchall()
        msgs = _messages(c, lead_id)
    return {
        **_summary(r),
        "contact": {
            "id": r["contact_id"],
            "name": r["contact_name"],
            "phone": r["phone"],
            "email": r["email"],
            "has_account": r["buyer_id"] is not None,
            "consent_at": r["consent_at"],
            "consent_version": r["consent_version"],
        },
        "message": r["message"],
        "activities": [
            {
                "id": a["id"],
                "kind": a["kind"],
                "body": json.loads(a["body"]),
                "actor": (a["actor_name"] or a["actor_email"]) if a["actor_id"] else None,
                "created_at": a["created_at"],
            }
            for a in acts
        ],
        "messages": msgs,
    }


def _messages(c, lead_id: str) -> list[dict]:
    rows = c.execute(
        """SELECT m.*, u.name AS author_name FROM lead_messages m LEFT JOIN users u ON u.id = m.author_id
           WHERE m.lead_id = ? ORDER BY m.created_at, m.rowid""",
        (lead_id,),
    ).fetchall()
    return [{"id": m["id"], "sender": m["sender"], "author": m["author_name"], "body": m["body"], "created_at": m["created_at"]} for m in rows]


def lead_org(lead_id: str) -> str | None:
    with db.lock:
        row = db.conn().execute("SELECT org_id FROM leads WHERE id = ?", (lead_id,)).fetchone()
    return row["org_id"] if row else None


# Reading for the buyer ------------------------------------------------------

def _buyer_lead(c, user_id: str, lead_id: str):
    return c.execute(
        "SELECT l.* FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE l.id = ? AND c.user_id = ?", (lead_id, user_id)
    ).fetchone()


_THREAD_SELECT = """
    SELECT l.id, l.listing_id, l.last_message_at, l.created_at, l.closed_at,
           li.title AS listing_title, li.contact_name AS seller_name, o.name AS org_name, o.kind AS org_kind,
           (SELECT body FROM lead_messages m WHERE m.lead_id = l.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_body,
           (SELECT COUNT(*) FROM lead_messages m
             WHERE m.lead_id = l.id AND m.sender = 'team' AND (l.buyer_read_at IS NULL OR m.created_at > l.buyer_read_at)) AS unread
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id
    JOIN orgs o ON o.id = l.org_id
    LEFT JOIN listings li ON li.id = l.listing_id AND li.status != 'removed'
"""


def _thread(r) -> dict:
    # Buyers see the seller's name from the listing, and the business name for business listings
    seller = r["seller_name"] or "The seller"
    if r["org_kind"] != "personal":
        seller = f"{seller}, {r['org_name']}" if r["seller_name"] else r["org_name"]
    return {
        "id": r["id"],
        "listing": {"id": r["listing_id"], "title": r["listing_title"]} if r["listing_title"] else None,
        "seller": seller,
        "last_message": r["last_body"],
        "last_message_at": r["last_message_at"] or r["created_at"],
        "unread": r["unread"],
    }


def buyer_threads(user_id: str) -> list[dict]:
    with db.lock:
        rows = db.conn().execute(_THREAD_SELECT + " WHERE c.user_id = ? ORDER BY COALESCE(l.last_message_at, l.created_at) DESC", (user_id,)).fetchall()
    return [_thread(r) for r in rows]


def buyer_thread(user_id: str, lead_id: str) -> dict | None:
    with db.lock:
        c = db.conn()
        r = c.execute(_THREAD_SELECT + " WHERE c.user_id = ? AND l.id = ?", (user_id, lead_id)).fetchone()
        if r is None:
            return None
        msgs = _messages(c, lead_id)
    thread = _thread(r)
    # The buyer sees who on the team wrote, by name only, never their email
    for m in msgs:
        if m["sender"] == "team":
            m["author"] = m["author"] or thread["seller"]
        else:
            m["author"] = None
    return {**thread, "messages": msgs}


def unread_for_buyer(user_id: str) -> int:
    with db.lock:
        row = db.conn().execute(
            """SELECT COUNT(*) FROM lead_messages m JOIN leads l ON l.id = m.lead_id JOIN contacts c ON c.id = l.contact_id
               WHERE c.user_id = ? AND m.sender = 'team' AND (l.buyer_read_at IS NULL OR m.created_at > l.buyer_read_at)""",
            (user_id,),
        ).fetchone()
    return row[0]


def buyer_lead(user_id: str, lead_id: str) -> dict | None:
    """The lead behind a buyer's conversation, with the name they gave, or None if it isn't theirs"""
    with db.lock:
        r = db.conn().execute(
            """SELECT l.id, l.org_id, c.name AS contact_name FROM leads l JOIN contacts c ON c.id = l.contact_id
               WHERE l.id = ? AND c.user_id = ?""",
            (lead_id, user_id),
        ).fetchone()
    return dict(r) if r else None


def buyer_has_account(lead_id: str) -> bool:
    with db.lock:
        r = db.conn().execute(
            "SELECT c.user_id FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE l.id = ?", (lead_id,)
        ).fetchone()
    return bool(r and r["user_id"])
