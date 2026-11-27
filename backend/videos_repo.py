"""Listing video rows (migrations/005_videos.sql). The files are in video_storage."""

import secrets
from datetime import datetime, timedelta, timezone

import db


def add(listing_id: str, user_id: str, ext: str, mime: str, size: int, duration_s: int | None) -> dict:
    video_id = secrets.token_urlsafe(9)
    key = f"listings/{listing_id}/{video_id}.{ext}"
    with db.transaction() as c:
        c.execute(
            """INSERT INTO listing_videos (id, listing_id, user_id, object_key, mime, size, duration_s, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (video_id, listing_id, user_id, key, mime, size, duration_s, db.now()),
        )
    return get(video_id)


def get(video_id: str) -> dict | None:
    with db.transaction() as c:
        row = c.execute("SELECT * FROM listing_videos WHERE id = ?", (video_id,)).fetchone()
    return dict(row) if row else None


def mark_ready(video_id: str, size: int) -> dict | None:
    with db.transaction() as c:
        c.execute("UPDATE listing_videos SET status = 'ready', size = ?, ready_at = ? WHERE id = ?", (size, db.now(), video_id))
    return get(video_id)


def remove(video_id: str) -> None:
    with db.transaction() as c:
        c.execute("DELETE FROM listing_videos WHERE id = ?", (video_id,))


def for_listing(listing_id: str, ready_only: bool = True) -> list[dict]:
    where = "listing_id = ? AND status = 'ready'" if ready_only else "listing_id = ?"
    with db.transaction() as c:
        rows = c.execute(f"SELECT * FROM listing_videos WHERE {where} ORDER BY created_at", (listing_id,)).fetchall()
    return [dict(r) for r in rows]


def count_for_listing(listing_id: str) -> int:
    """Ready videos and uploads in progress, so two at once can't pass the limit"""
    with db.transaction() as c:
        return c.execute("SELECT COUNT(*) FROM listing_videos WHERE listing_id = ?", (listing_id,)).fetchone()[0]


def bytes_used(user_id: str | None = None) -> int:
    """Everything stored and promised, for one uploader or the whole site. An
    upload in progress counts at the size it said it would be."""
    with db.transaction() as c:
        if user_id is None:
            return c.execute("SELECT COALESCE(SUM(size), 0) FROM listing_videos").fetchone()[0]
        return c.execute("SELECT COALESCE(SUM(size), 0) FROM listing_videos WHERE user_id = ?", (user_id,)).fetchone()[0]


def stale_pending(hours: int = 3) -> list[dict]:
    """Uploads that started but never finished"""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    with db.transaction() as c:
        rows = c.execute("SELECT * FROM listing_videos WHERE status = 'pending' AND created_at < ?", (since,)).fetchall()
    return [dict(r) for r in rows]
