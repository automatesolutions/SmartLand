"""Files in team chat (migrations/007): the rows, and removing a file from storage and here.
Routes are in team_files.py. Callers check permissions."""

import secrets
from datetime import datetime, timedelta, timezone

from loguru import logger

import db
import video_storage


def add(org_id: str, channel_id: str, user_id: str, name: str, mime: str, ext: str, size: int) -> dict:
    file_id = secrets.token_urlsafe(9)
    # The name stays in the database; the key is safe for any storage
    key = f"team/{org_id}/{file_id}.{ext}"
    with db.transaction() as c:
        c.execute(
            """INSERT INTO ws_files (id, org_id, channel_id, user_id, object_key, name, mime, size, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (file_id, org_id, channel_id, user_id, key, name, mime, size, db.now()),
        )
    return get(file_id)


def get(file_id: str) -> dict | None:
    with db.transaction() as c:
        row = c.execute("SELECT * FROM ws_files WHERE id = ?", (file_id,)).fetchone()
    return dict(row) if row else None


def mark_ready(file_id: str, size: int) -> dict:
    with db.transaction() as c:
        c.execute("UPDATE ws_files SET status = 'ready', size = ? WHERE id = ?", (size, file_id))
    return get(file_id)


def bytes_used(org_id: str) -> int:
    with db.transaction() as c:
        return c.execute("SELECT COALESCE(SUM(size), 0) FROM ws_files WHERE org_id = ?", (org_id,)).fetchone()[0]


def attach(c, message_id: str, file_ids: list[str]) -> None:
    for fid in file_ids:
        c.execute("UPDATE ws_files SET message_id = ? WHERE id = ?", (message_id, fid))


def view(f: dict) -> dict:
    return {"id": f["id"], "name": f["name"], "mime": f["mime"], "size": f["size"]}


def for_messages(c, message_ids: list[str]) -> dict[str, list[dict]]:
    """Ready files by message, in upload order"""
    out: dict[str, list[dict]] = {}
    if not message_ids:
        return out
    marks = ",".join("?" * len(message_ids))
    rows = c.execute(
        f"SELECT * FROM ws_files WHERE status = 'ready' AND message_id IN ({marks}) ORDER BY created_at, rowid", message_ids
    ).fetchall()
    for r in rows:
        out.setdefault(r["message_id"], []).append(view(dict(r)))
    return out


def drop(f: dict) -> None:
    """Deletes the stored file, then the row. A failed delete keeps the row so cleanup can retry."""
    vs = video_storage.videos
    if vs is not None:
        try:
            vs.delete(f["object_key"])
        except Exception as e:
            logger.warning(f"Couldn't delete team file {f['id']}: {e}")
            return
    with db.transaction() as c:
        c.execute("DELETE FROM ws_files WHERE id = ?", (f["id"],))


def drop_for_message(message_id: str) -> None:
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM ws_files WHERE message_id = ?", (message_id,)).fetchall()
    for r in rows:
        drop(dict(r))


def clear_unsent(hours: int = 6) -> int:
    """Uploads never finished, or finished but never sent in a message"""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM ws_files WHERE message_id IS NULL AND created_at < ?", (cutoff,)).fetchall()
    for r in rows:
        drop(dict(r))
    return len(rows)
