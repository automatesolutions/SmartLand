"""Team workspace: channels, direct messages, @mentions, read state, and tasks.
All SQL for the ws_ tables lives here. Callers check permissions first.
"""

import re
import secrets

import db
import team_files_repo

MENTION = re.compile(r"<@([A-Za-z0-9_-]{1,64})>")
PAGE = 100


def _id() -> str:
    return secrets.token_urlsafe(9)


def mentioned_ids(body: str) -> set[str]:
    return set(MENTION.findall(body))


# Channels ---------------------------------------------------------------------

def ensure_general(org_id: str, actor_id: str) -> None:
    """Every business starts with #general"""
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM ws_channels WHERE org_id = ? AND kind = 'channel' AND name = 'general'", (org_id,)).fetchone() is None:
            c.execute(
                "INSERT INTO ws_channels (id, org_id, kind, name, topic, created_by, created_at) VALUES (?, ?, 'channel', 'general', ?, ?, ?)",
                (_id(), org_id, "Everyone on the team", actor_id, db.now()),
            )


def _unread_sql(alias: str = "ch") -> str:
    # Messages from others since you last read the channel, and the ones among them that mention you
    return f"""
        (SELECT COUNT(*) FROM ws_messages m LEFT JOIN ws_reads r ON r.channel_id = m.channel_id AND r.user_id = :me
          WHERE m.channel_id = {alias}.id AND m.deleted_at IS NULL AND (m.author_id IS NULL OR m.author_id != :me)
            AND (r.read_at IS NULL OR m.created_at > r.read_at)) AS unread,
        (SELECT COUNT(*) FROM ws_messages m JOIN ws_mentions x ON x.message_id = m.id AND x.user_id = :me
          LEFT JOIN ws_reads r ON r.channel_id = m.channel_id AND r.user_id = :me
          WHERE m.channel_id = {alias}.id AND m.deleted_at IS NULL AND (r.read_at IS NULL OR m.created_at > r.read_at)) AS mentions,
        (SELECT MAX(created_at) FROM ws_messages m WHERE m.channel_id = {alias}.id AND m.deleted_at IS NULL) AS last_message_at
    """


def channels_for(org_id: str, user_id: str) -> list[dict]:
    """The org's open channels, then your DMs, each with your new-message and mention counts"""
    with db.lock:
        rows = db.conn().execute(
            f"""SELECT ch.*, {_unread_sql()},
                       (SELECT u.id FROM ws_dm_members d JOIN users u ON u.id = d.user_id
                         WHERE d.channel_id = ch.id AND d.user_id != :me) AS other_id,
                       (SELECT COALESCE(u.name, u.email) FROM ws_dm_members d JOIN users u ON u.id = d.user_id
                         WHERE d.channel_id = ch.id AND d.user_id != :me) AS other_name
                FROM ws_channels ch
                WHERE ch.org_id = :org AND ch.archived_at IS NULL
                  AND (ch.kind = 'channel' OR EXISTS (SELECT 1 FROM ws_dm_members d WHERE d.channel_id = ch.id AND d.user_id = :me))
                ORDER BY ch.kind = 'dm', ch.name = 'general' DESC, ch.name, last_message_at DESC""",
            {"org": org_id, "me": user_id},
        ).fetchall()
    return [_channel(r) for r in rows]


def _channel(r) -> dict:
    out = {
        "id": r["id"],
        "kind": r["kind"],
        "name": r["name"],
        "topic": r["topic"],
        "unread": r["unread"],
        "mentions": r["mentions"],
        "last_message_at": r["last_message_at"],
    }
    if r["kind"] == "dm":
        out["with"] = {"id": r["other_id"], "name": r["other_name"]} if r["other_id"] else None
    return out


def get_channel(org_id: str, channel_id: str):
    with db.lock:
        return db.conn().execute("SELECT * FROM ws_channels WHERE id = ? AND org_id = ?", (channel_id, org_id)).fetchone()


def is_dm_member(channel_id: str, user_id: str) -> bool:
    with db.lock:
        return db.conn().execute("SELECT 1 FROM ws_dm_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone() is not None


def create_channel(org_id: str, name: str, topic: str | None, actor_id: str) -> str | None:
    """Returns the new channel's id, or None if the name is taken"""
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM ws_channels WHERE org_id = ? AND kind = 'channel' AND name = ?", (org_id, name)).fetchone():
            return None
        cid = _id()
        c.execute(
            "INSERT INTO ws_channels (id, org_id, kind, name, topic, created_by, created_at) VALUES (?, ?, 'channel', ?, ?, ?, ?)",
            (cid, org_id, name, topic, actor_id, db.now()),
        )
    return cid


def update_channel(org_id: str, channel_id: str, changes: dict) -> str | None:
    """Applies name, topic, and archived. Returns None on success, or why it failed."""
    with db.transaction() as c:
        ch = c.execute("SELECT * FROM ws_channels WHERE id = ? AND org_id = ? AND kind = 'channel'", (channel_id, org_id)).fetchone()
        if ch is None:
            return "missing"
        if "name" in changes and changes["name"] != ch["name"]:
            if ch["name"] == "general":
                return "general"
            if c.execute("SELECT 1 FROM ws_channels WHERE org_id = ? AND kind = 'channel' AND name = ?", (org_id, changes["name"])).fetchone():
                return "taken"
            c.execute("UPDATE ws_channels SET name = ? WHERE id = ?", (changes["name"], channel_id))
        if "topic" in changes:
            c.execute("UPDATE ws_channels SET topic = ? WHERE id = ?", (changes["topic"], channel_id))
        if "archived" in changes:
            if ch["name"] == "general" and changes["archived"]:
                return "general"
            c.execute("UPDATE ws_channels SET archived_at = ? WHERE id = ?", (db.now() if changes["archived"] else None, channel_id))
    return None


def dm(org_id: str, a: str, b: str) -> str:
    """The DM between two members, made the first time"""
    key = ":".join(sorted((a, b)))
    with db.transaction() as c:
        row = c.execute("SELECT id FROM ws_channels WHERE org_id = ? AND kind = 'dm' AND dm_key = ?", (org_id, key)).fetchone()
        if row:
            return row["id"]
        cid = _id()
        c.execute(
            "INSERT INTO ws_channels (id, org_id, kind, dm_key, created_by, created_at) VALUES (?, ?, 'dm', ?, ?, ?)",
            (cid, org_id, key, a, db.now()),
        )
        for uid in {a, b}:
            c.execute("INSERT INTO ws_dm_members (channel_id, user_id) VALUES (?, ?)", (cid, uid))
    return cid


# Messages ---------------------------------------------------------------------

_MSG_SELECT = """
    SELECT m.*, COALESCE(u.name, u.email) AS author_name FROM ws_messages m LEFT JOIN users u ON u.id = m.author_id
"""


def _message(r) -> dict:
    deleted = r["deleted_at"] is not None
    return {
        "id": r["id"],
        "channel_id": r["channel_id"],
        "author": {"id": r["author_id"], "name": r["author_name"]} if r["author_id"] else None,
        "body": "" if deleted else r["body"],
        "created_at": r["created_at"],
        "edited_at": r["edited_at"],
        "deleted": deleted,
        "files": [],
    }


def _with_files(c, msgs: list[dict]) -> list[dict]:
    found = team_files_repo.for_messages(c, [m["id"] for m in msgs if not m["deleted"]])
    for m in msgs:
        m["files"] = found.get(m["id"], [])
    return msgs


def messages(channel_id: str, since: str | None = None, before: str | None = None) -> list[dict]:
    """Oldest first. `since`: new, edited, or deleted after that time, for polling.
    `before`: the page before that time. Neither: the newest page."""
    with db.lock:
        c = db.conn()
        if since:
            rows = c.execute(
                _MSG_SELECT + " WHERE m.channel_id = ? AND (m.created_at > ? OR m.edited_at > ? OR m.deleted_at > ?) ORDER BY m.created_at, m.rowid",
                (channel_id, since, since, since),
            ).fetchall()
            return _with_files(c, [_message(r) for r in rows])
        sql = _MSG_SELECT + " WHERE m.channel_id = ?"
        args: list = [channel_id]
        if before:
            sql += " AND m.created_at < ?"
            args.append(before)
        rows = c.execute(sql + " ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?", (*args, PAGE)).fetchall()
        return _with_files(c, [_message(r) for r in reversed(rows)])


def get_message(org_id: str, message_id: str):
    with db.lock:
        return db.conn().execute(
            """SELECT m.*, ch.kind AS channel_kind FROM ws_messages m JOIN ws_channels ch ON ch.id = m.channel_id
               WHERE m.id = ? AND ch.org_id = ?""",
            (message_id, org_id),
        ).fetchone()


def _set_mentions(c, message_id: str, user_ids: set[str]) -> None:
    c.execute("DELETE FROM ws_mentions WHERE message_id = ?", (message_id,))
    for uid in user_ids:
        c.execute("INSERT INTO ws_mentions (message_id, user_id) VALUES (?, ?)", (message_id, uid))


def post(channel_id: str, author_id: str, body: str, mentions: set[str], file_ids: list[str] | None = None) -> dict:
    mid = _id()
    now = db.now()
    with db.transaction() as c:
        c.execute("INSERT INTO ws_messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)", (mid, channel_id, author_id, body, now))
        _set_mentions(c, mid, mentions)
        team_files_repo.attach(c, mid, file_ids or [])
        _read(c, channel_id, author_id, now)
        row = c.execute(_MSG_SELECT + " WHERE m.id = ?", (mid,)).fetchone()
        return _with_files(c, [_message(row)])[0]


def edit(message_id: str, body: str, mentions: set[str]) -> dict:
    with db.transaction() as c:
        c.execute("UPDATE ws_messages SET body = ?, edited_at = ? WHERE id = ?", (body, db.now(), message_id))
        _set_mentions(c, message_id, mentions)
        row = c.execute(_MSG_SELECT + " WHERE m.id = ?", (message_id,)).fetchone()
        return _with_files(c, [_message(row)])[0]


def delete(message_id: str) -> None:
    with db.transaction() as c:
        c.execute("UPDATE ws_messages SET body = '', deleted_at = ? WHERE id = ?", (db.now(), message_id))
        c.execute("DELETE FROM ws_mentions WHERE message_id = ?", (message_id,))


def _read(c, channel_id: str, user_id: str, at: str) -> None:
    c.execute(
        """INSERT INTO ws_reads (channel_id, user_id, read_at) VALUES (?, ?, ?)
           ON CONFLICT (channel_id, user_id) DO UPDATE SET read_at = MAX(read_at, excluded.read_at)""",
        (channel_id, user_id, at),
    )


def mark_read(channel_id: str, user_id: str) -> None:
    with db.transaction() as c:
        _read(c, channel_id, user_id, db.now())


def unread_totals(user_id: str) -> dict:
    """What the nav badge counts: new DMs plus new @mentions, across every business you're on"""
    with db.lock:
        rows = db.conn().execute(
            f"""SELECT ch.org_id, ch.kind, {_unread_sql()}
                FROM ws_channels ch JOIN org_members om ON om.org_id = ch.org_id AND om.user_id = :me
                WHERE ch.archived_at IS NULL
                  AND (ch.kind = 'channel' OR EXISTS (SELECT 1 FROM ws_dm_members d WHERE d.channel_id = ch.id AND d.user_id = :me))""",
            {"me": user_id},
        ).fetchall()
    by_org: dict[str, int] = {}
    for r in rows:
        n = r["unread"] if r["kind"] == "dm" else r["mentions"]
        if n:
            by_org[r["org_id"]] = by_org.get(r["org_id"], 0) + n
    return {"count": sum(by_org.values()), "by_org": by_org}


# Tasks ------------------------------------------------------------------------

_TASK_SELECT = """
    SELECT t.*, COALESCE(a.name, a.email) AS assignee_name, c.name AS lead_name, li.title AS listing_title
    FROM ws_tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN leads l ON l.id = t.lead_id
    LEFT JOIN contacts c ON c.id = l.contact_id
    LEFT JOIN listings li ON li.id = t.listing_id AND li.status != 'removed'
"""


def _task(r) -> dict:
    return {
        "id": r["id"],
        "title": r["title"],
        "notes": r["notes"],
        "assignee": {"id": r["assignee_id"], "name": r["assignee_name"]} if r["assignee_id"] else None,
        "due_on": r["due_on"],
        "status": r["status"],
        "lead": {"id": r["lead_id"], "name": r["lead_name"]} if r["lead_id"] else None,
        "listing": {"id": r["listing_id"], "title": r["listing_title"]} if r["listing_id"] and r["listing_title"] else None,
        "created_by": r["created_by"],
        "created_at": r["created_at"],
        "done_at": r["done_at"],
    }


def tasks(org_id: str, status: str | None = None, assignee_id: str | None = None, lead_id: str | None = None) -> list[dict]:
    sql = _TASK_SELECT + " WHERE t.org_id = ?"
    args: list = [org_id]
    for col, val in (("t.status", status), ("t.assignee_id", assignee_id), ("t.lead_id", lead_id)):
        if val:
            sql += f" AND {col} = ?"
            args.append(val)
    # Open first, soonest due first, undated last
    sql += " ORDER BY t.status = 'done', t.due_on IS NULL, t.due_on, t.created_at DESC"
    with db.lock:
        return [_task(r) for r in db.conn().execute(sql, args).fetchall()]


def get_task(org_id: str, task_id: str) -> dict | None:
    with db.lock:
        r = db.conn().execute(_TASK_SELECT + " WHERE t.org_id = ? AND t.id = ?", (org_id, task_id)).fetchone()
    return _task(r) if r else None


def create_task(org_id: str, actor_id: str, fields: dict) -> dict:
    tid = _id()
    now = db.now()
    with db.transaction() as c:
        c.execute(
            """INSERT INTO ws_tasks (id, org_id, title, notes, assignee_id, due_on, lead_id, listing_id, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (tid, org_id, fields["title"], fields.get("notes"), fields.get("assignee_id"), fields.get("due_on"),
             fields.get("lead_id"), fields.get("listing_id"), actor_id, now, now),
        )
    return get_task(org_id, tid)


def update_task(org_id: str, task_id: str, changes: dict) -> dict | None:
    allowed = {"title", "notes", "assignee_id", "due_on", "status"}
    sets = {k: v for k, v in changes.items() if k in allowed}
    now = db.now()
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM ws_tasks WHERE id = ? AND org_id = ?", (task_id, org_id)).fetchone() is None:
            return None
        if "status" in sets:
            sets["done_at"] = now if sets["status"] == "done" else None
        sets["updated_at"] = now
        c.execute(f"UPDATE ws_tasks SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?", (*sets.values(), task_id))
    return get_task(org_id, task_id)


def delete_task(org_id: str, task_id: str) -> bool:
    with db.transaction() as c:
        cur = c.execute("DELETE FROM ws_tasks WHERE id = ? AND org_id = ?", (task_id, org_id))
    return cur.rowcount > 0
