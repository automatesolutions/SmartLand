"""Accounts, saved reports, and share links in SQLite.

One file, no server to run. Set DATABASE_PATH to keep it somewhere durable;
on Cloud Run the container disk is wiped on every deploy (see README.md)."""

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

DATABASE_PATH = os.getenv("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "smartland.db"))
PBKDF2_ITERATIONS = 600_000

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, report_id),
    FOREIGN KEY (user_id, report_id) REFERENCES reports(user_id, id) ON DELETE CASCADE
);
"""


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(os.path.abspath(DATABASE_PATH)), exist_ok=True)
        _conn = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys = ON")
        _conn.executescript(SCHEMA)
    return _conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Passwords ------------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(check.hex(), digest)
    except ValueError:
        return False


# Users ----------------------------------------------------------------------

def _public_user(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


def create_user(email: str, password: str, name: str | None) -> dict | None:
    """Returns the new user, or None when the email is taken."""
    user_id = uuid.uuid4().hex
    with _lock:
        try:
            _db().execute(
                "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email.lower(), name, hash_password(password), _now()),
            )
            _db().commit()
        except sqlite3.IntegrityError:
            return None
    return {"id": user_id, "email": email.lower(), "name": name}


def authenticate(email: str, password: str) -> dict | None:
    with _lock:
        row = _db().execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
    if row and verify_password(password, row["password_hash"]):
        return _public_user(row)
    return None


def get_user(user_id: str) -> dict | None:
    with _lock:
        row = _db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _public_user(row) if row else None


# Reports --------------------------------------------------------------------

def list_reports(user_id: str) -> list[dict]:
    with _lock:
        rows = _db().execute(
            """SELECT r.body, s.token FROM reports r
               LEFT JOIN shares s ON s.user_id = r.user_id AND s.report_id = r.id
               WHERE r.user_id = ? ORDER BY r.created_at DESC""",
            (user_id,),
        ).fetchall()
    return [{**json.loads(row["body"]), "shareToken": row["token"]} for row in rows]


def put_report(user_id: str, report: dict) -> None:
    body = {k: v for k, v in report.items() if k != "shareToken"}
    with _lock:
        _db().execute(
            """INSERT INTO reports (user_id, id, body, created_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (user_id, id) DO UPDATE SET body = excluded.body""",
            (user_id, report["id"], json.dumps(body), report.get("createdAt") or _now()),
        )
        _db().commit()


def delete_report(user_id: str, report_id: str) -> bool:
    with _lock:
        cur = _db().execute("DELETE FROM reports WHERE user_id = ? AND id = ?", (user_id, report_id))
        _db().commit()
    return cur.rowcount > 0


def share_report(user_id: str, report_id: str) -> str | None:
    """Returns the share token for a saved report, creating one if needed."""
    with _lock:
        if not _db().execute("SELECT 1 FROM reports WHERE user_id = ? AND id = ?", (user_id, report_id)).fetchone():
            return None
        row = _db().execute("SELECT token FROM shares WHERE user_id = ? AND report_id = ?", (user_id, report_id)).fetchone()
        if row:
            return row["token"]
        token = secrets.token_urlsafe(12)
        _db().execute(
            "INSERT INTO shares (token, user_id, report_id, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, report_id, _now()),
        )
        _db().commit()
    return token


def unshare_report(user_id: str, report_id: str) -> None:
    with _lock:
        _db().execute("DELETE FROM shares WHERE user_id = ? AND report_id = ?", (user_id, report_id))
        _db().commit()


def shared_report(token: str) -> dict | None:
    with _lock:
        row = _db().execute(
            """SELECT r.body FROM shares s JOIN reports r ON r.user_id = s.user_id AND r.id = s.report_id
               WHERE s.token = ?""",
            (token,),
        ).fetchone()
    return json.loads(row["body"]) if row else None
