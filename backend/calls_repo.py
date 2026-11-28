"""Calls, the people in them, and minutes used (migrations/006_calls.sql). Callers check permissions."""

import secrets
from datetime import datetime, timedelta, timezone

import db
from performance_repo import PH

# Rows of who joined are removed this long after a call ends. Minute totals stay.
KEEP_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _at(s: str) -> datetime:
    return datetime.fromisoformat(s)


def month(at: datetime | None = None) -> str:
    return (at or _now()).astimezone(PH).strftime("%Y-%m")


def room_name(call_id: str) -> str:
    return f"smartland-{call_id}"


def create(org_id: str, kind: str, started_by: str, expires_at: datetime, *, channel_id: str | None = None,
           lead_id: str | None = None, invite_hash: str | None = None) -> dict:
    call_id = secrets.token_urlsafe(12)
    with db.transaction() as c:
        c.execute(
            """INSERT INTO calls (id, org_id, kind, channel_id, lead_id, started_by, invite_hash, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (call_id, org_id, kind, channel_id, lead_id, started_by, invite_hash, db.now(), expires_at.isoformat()),
        )
    return get(call_id)


def get(call_id: str) -> dict | None:
    with db.transaction() as c:
        row = c.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
    return dict(row) if row else None


def by_invite(invite_hash: str) -> dict | None:
    with db.transaction() as c:
        row = c.execute("SELECT * FROM calls WHERE invite_hash = ?", (invite_hash,)).fetchone()
    return dict(row) if row else None


def is_live(call: dict) -> bool:
    return call["ended_at"] is None and _at(call["expires_at"]) > _now()


def open_huddle(channel_id: str) -> dict | None:
    with db.transaction() as c:
        row = c.execute(
            "SELECT * FROM calls WHERE channel_id = ? AND kind = 'huddle' AND ended_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
            (channel_id, db.now()),
        ).fetchone()
    return dict(row) if row else None


def open_tour(lead_id: str) -> dict | None:
    with db.transaction() as c:
        row = c.execute(
            "SELECT * FROM calls WHERE lead_id = ? AND kind = 'tour' AND ended_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
            (lead_id, db.now()),
        ).fetchone()
    return dict(row) if row else None


def open_huddles(org_id: str) -> list[dict]:
    with db.transaction() as c:
        rows = c.execute(
            "SELECT * FROM calls WHERE org_id = ? AND kind = 'huddle' AND ended_at IS NULL AND expires_at > ?",
            (org_id, db.now()),
        ).fetchall()
    return [dict(r) for r in rows]


def people(call_id: str) -> list[dict]:
    """Who's in the call now, earliest first, one row per person"""
    with db.transaction() as c:
        rows = c.execute(
            """SELECT identity, name, MIN(joined_at) AS joined_at FROM call_people
               WHERE call_id = ? AND left_at IS NULL GROUP BY identity ORDER BY joined_at""",
            (call_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def join(call_id: str, identity: str, name: str) -> None:
    """Counts someone in from now, unless they're already counted"""
    with db.transaction() as c:
        there = c.execute("SELECT 1 FROM call_people WHERE call_id = ? AND identity = ? AND left_at IS NULL", (call_id, identity)).fetchone()
        if not there:
            c.execute("INSERT OR IGNORE INTO call_people (call_id, identity, name, joined_at) VALUES (?, ?, ?, ?)", (call_id, identity, name, db.now()))


def _close(c, call: dict, rows, at: datetime) -> None:
    """Ends the given open rows at `at`, capped at the call's end, and adds their minutes"""
    end = min(at, _at(call["expires_at"]))
    total = 0.0
    for r in rows:
        left = max(end, _at(r["joined_at"]))
        total += (left - _at(r["joined_at"])).total_seconds() / 60
        c.execute("UPDATE call_people SET left_at = ? WHERE call_id = ? AND identity = ? AND joined_at = ?",
                  (left.isoformat(), call["id"], r["identity"], r["joined_at"]))
    if total:
        c.execute(
            """INSERT INTO call_minutes (org_id, month, minutes) VALUES (?, ?, ?)
               ON CONFLICT (org_id, month) DO UPDATE SET minutes = minutes + excluded.minutes""",
            (call["org_id"], month(end), total),
        )


def leave(call: dict, identity: str, at: datetime | None = None) -> None:
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM call_people WHERE call_id = ? AND identity = ? AND left_at IS NULL", (call["id"], identity)).fetchall()
        _close(c, call, rows, at or _now())


def keep_only(call: dict, identities: set[str]) -> None:
    """Closes anyone LiveKit says isn't in the room any more"""
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM call_people WHERE call_id = ? AND left_at IS NULL", (call["id"],)).fetchall()
        _close(c, call, [r for r in rows if r["identity"] not in identities], _now())


def end(call: dict, at: datetime | None = None) -> None:
    at = at or _now()
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM call_people WHERE call_id = ? AND left_at IS NULL", (call["id"],)).fetchall()
        _close(c, call, rows, at)
        c.execute("UPDATE calls SET ended_at = ? WHERE id = ? AND ended_at IS NULL", (min(at, _at(call["expires_at"])).isoformat(), call["id"]))


def overdue() -> list[dict]:
    """Calls past their end time that haven't been closed"""
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM calls WHERE ended_at IS NULL AND expires_at <= ?", (db.now(),)).fetchall()
    return [dict(r) for r in rows]


def minutes_used(org_id: str | None = None) -> float:
    """This Philippine month's participant minutes, including people in a call right now"""
    now = _now()
    where, args = ("WHERE org_id = ?", [org_id]) if org_id else ("", [])
    with db.transaction() as c:
        done = c.execute(f"SELECT COALESCE(SUM(minutes), 0) FROM call_minutes {where} {'AND' if where else 'WHERE'} month = ?", (*args, month(now))).fetchone()[0]
        live = c.execute(
            f"""SELECT p.joined_at, k.expires_at FROM call_people p JOIN calls k ON k.id = p.call_id
                WHERE p.left_at IS NULL {'AND k.org_id = ?' if org_id else ''}""",
            args,
        ).fetchall()
    running = sum(max(0.0, (min(now, _at(r["expires_at"])) - _at(r["joined_at"])).total_seconds() / 60) for r in live)
    return done + running


def purge_old() -> int:
    """Removes calls, and who was in them, KEEP_DAYS after they ended"""
    cutoff = (_now() - timedelta(days=KEEP_DAYS)).isoformat()
    with db.transaction() as c:
        return c.execute("DELETE FROM calls WHERE ended_at IS NOT NULL AND ended_at < ?", (cutoff,)).rowcount


def set_invite(call_id: str, invite_hash: str) -> None:
    with db.transaction() as c:
        c.execute("UPDATE calls SET invite_hash = ? WHERE id = ?", (invite_hash, call_id))


def lead_listing(lead_id: str) -> dict | None:
    """The listing a tour is about, for the buyer's page: title and link only"""
    with db.transaction() as c:
        row = c.execute(
            "SELECT li.id, li.title FROM leads l JOIN listings li ON li.id = l.listing_id WHERE l.id = ? AND li.status != 'removed'",
            (lead_id,),
        ).fetchone()
    return dict(row) if row else None
