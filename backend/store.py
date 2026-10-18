"""Accounts, saved reports, share links, and property listings in SQLite.

One file, no server to run. Set DATABASE_PATH to keep it somewhere durable;
on Cloud Run the container disk is wiped on every deploy (see README.md)."""

import hashlib
import hmac
import json
import math
import os
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

import listing_rules

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
CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL,
    lot_sqm REAL,
    floor_sqm REAL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    place TEXT NOT NULL,
    town TEXT,
    province TEXT,
    seller_type TEXT NOT NULL,
    prc_license TEXT,
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_near ON listings (status, lat, lon);
CREATE INDEX IF NOT EXISTS listings_owner ON listings (user_id);
-- Files live on disk under UPLOAD_DIR, named by their SHA-256
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    review_note TEXT,
    uploaded_at TEXT NOT NULL,
    reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS documents_listing ON documents (listing_id);
CREATE INDEX IF NOT EXISTS documents_status ON documents (status);
-- Every change to a listing, each one fingerprinted together with the one before
CREATE TABLE IF NOT EXISTS listing_events (
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (listing_id, seq)
);
"""


def _migrate(conn: sqlite3.Connection) -> None:
    user_cols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
    if "google_sub" not in user_cols:
        # Google's stable account ID, for people who sign in with Google
        conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users (google_sub)")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(listings)")}
    if "details" not in cols:
        conn.execute("ALTER TABLE listings ADD COLUMN details TEXT NOT NULL DEFAULT '{}'")
    for old, new in listing_rules.RENAMED.items():
        conn.execute("UPDATE listings SET category = ? WHERE category = ?", (new, old))
    conn.commit()


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(os.path.abspath(DATABASE_PATH)), exist_ok=True)
        _conn = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys = ON")
        _conn.executescript(SCHEMA)
        _migrate(_conn)
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


# Accounts made with Google have no password. "!" can't match any PBKDF2 hash,
# so password sign-in stays closed until the person sets one.
NO_PASSWORD = "!"


def google_user(sub: str, email: str, name: str | None) -> dict:
    """The account for a Google sign-in: the one already linked to this Google
    account, else the one with the same (Google-verified) email, which gets
    linked, else a new one."""
    email = email.lower()
    with _lock:
        conn = _db()
        row = conn.execute("SELECT * FROM users WHERE google_sub = ?", (sub,)).fetchone()
        if row is None:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if row is not None:
                conn.execute("UPDATE users SET google_sub = ?, name = COALESCE(name, ?) WHERE id = ?", (sub, name, row["id"]))
            else:
                user_id = uuid.uuid4().hex
                conn.execute(
                    "INSERT INTO users (id, email, name, password_hash, created_at, google_sub) VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, email, name, NO_PASSWORD, _now(), sub),
                )
            conn.commit()
            row = conn.execute("SELECT * FROM users WHERE google_sub = ?", (sub,)).fetchone()
    return _public_user(row)


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


# Listings -------------------------------------------------------------------

LISTING_FIELDS = (
    "category", "title", "description", "price", "lot_sqm", "floor_sqm", "lat", "lon", "place", "town",
    "province", "seller_type", "prc_license", "contact_name", "contact_phone", "details",
)


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def _listing(row: sqlite3.Row, viewer_id: str | None = None) -> dict:
    out = {k: row[k] for k in row.keys() if k != "user_id"}
    out["details"] = json.loads(row["details"] or "{}")
    out["mine"] = viewer_id is not None and row["user_id"] == viewer_id
    return out


def _append_event(conn: sqlite3.Connection, listing_id: str, kind: str, payload: dict) -> None:
    """Adds the next fingerprinted event. Call with _lock held, inside the same commit."""
    last = conn.execute(
        "SELECT seq, hash FROM listing_events WHERE listing_id = ? ORDER BY seq DESC LIMIT 1", (listing_id,)
    ).fetchone()
    seq, prev = (last["seq"] + 1, last["hash"]) if last else (1, listing_rules.GENESIS)
    at = _now()
    conn.execute(
        "INSERT INTO listing_events VALUES (?, ?, ?, ?, ?, ?, ?)",
        (listing_id, seq, kind, listing_rules.canonical(payload), at, prev, listing_rules.event_hash(prev, seq, kind, payload, at)),
    )


def create_listing(user_id: str, data: dict) -> dict:
    listing_id = secrets.token_urlsafe(9)
    now = _now()
    values = [json.dumps(data.get(k) or {}) if k == "details" else data.get(k) for k in LISTING_FIELDS]
    public = {k: data.get(k) for k in ("category", "title", "price", "lot_sqm", "floor_sqm", "lat", "lon", "place", "seller_type", "details")}
    with _lock:
        conn = _db()
        conn.execute(
            f"""INSERT INTO listings (id, user_id, {", ".join(LISTING_FIELDS)}, status, created_at, updated_at)
                VALUES (?, ?, {", ".join("?" for _ in LISTING_FIELDS)}, 'active', ?, ?)""",
            (listing_id, user_id, *values, now, now),
        )
        _append_event(conn, listing_id, "listed", public)
        conn.commit()
    return get_listing(listing_id, user_id)


def get_listing(listing_id: str, viewer_id: str | None = None) -> dict | None:
    """Active listings for everyone; sold ones too, so old links still explain themselves"""
    with _lock:
        row = _db().execute("SELECT * FROM listings WHERE id = ? AND status != 'removed'", (listing_id,)).fetchone()
    return _listing(row, viewer_id) if row else None


def listing_owner(listing_id: str) -> str | None:
    with _lock:
        row = _db().execute("SELECT user_id FROM listings WHERE id = ? AND status != 'removed'", (listing_id,)).fetchone()
    return row["user_id"] if row else None


def listings_near(lat: float, lon: float, radius_km: float, category: str | None = None, limit: int = 100) -> dict:
    """Active listings within radius_km of a point, nearest first, and the count
    per category in that circle"""
    # A bounding box keeps the scan to the indexed rows near the point; the
    # exact distance then trims the corners
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    with _lock:
        rows = _db().execute(
            "SELECT * FROM listings WHERE status = 'active' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
            (lat - dlat, lat + dlat, lon - dlon, lon + dlon),
        ).fetchall()
    counts: dict[str, int] = {}
    matched = []
    for row in rows:
        d = _km(lat, lon, row["lat"], row["lon"])
        if d > radius_km:
            continue
        counts[row["category"]] = counts.get(row["category"], 0) + 1
        if category is None or row["category"] == category:
            matched.append({**_listing(row), "distance_km": round(d, 2)})
    matched.sort(key=lambda r: r["distance_km"])
    return {"counts": counts, "count": len(matched), "listings": matched[:limit]}


def user_listings(user_id: str) -> list[dict]:
    with _lock:
        rows = _db().execute(
            "SELECT * FROM listings WHERE user_id = ? AND status != 'removed' ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [_listing(r, user_id) for r in rows]


def set_listing_status(user_id: str, listing_id: str, status: str) -> dict | None:
    """Marks a seller's own listing active, sold, or removed. None if it isn't theirs."""
    with _lock:
        conn = _db()
        cur = conn.execute(
            "UPDATE listings SET status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status != 'removed'",
            (status, _now(), listing_id, user_id),
        )
        if cur.rowcount:
            _append_event(conn, listing_id, "status", {"status": status})
        conn.commit()
    if cur.rowcount == 0:
        return None
    return get_listing(listing_id, user_id) if status != "removed" else {"id": listing_id, "status": "removed"}


def set_listing_price(user_id: str, listing_id: str, price: int) -> dict | None:
    """Changes the asking price. The old and new prices go on the public record,
    so a price can't move quietly between buyers."""
    with _lock:
        conn = _db()
        row = conn.execute(
            "SELECT price FROM listings WHERE id = ? AND user_id = ? AND status != 'removed'", (listing_id, user_id)
        ).fetchone()
        if row is None:
            return None
        if row["price"] != price:
            conn.execute("UPDATE listings SET price = ?, updated_at = ? WHERE id = ?", (price, _now(), listing_id))
            _append_event(conn, listing_id, "price", {"from": row["price"], "to": price})
            conn.commit()
    return get_listing(listing_id, user_id)


def listing_events(listing_id: str) -> list[dict]:
    with _lock:
        rows = _db().execute("SELECT * FROM listing_events WHERE listing_id = ? ORDER BY seq", (listing_id,)).fetchall()
    return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]


# Documents ------------------------------------------------------------------

def list_documents(listing_id: str) -> list[dict]:
    with _lock:
        rows = _db().execute("SELECT * FROM documents WHERE listing_id = ? ORDER BY uploaded_at", (listing_id,)).fetchall()
    return [dict(r) for r in rows]


def get_document(doc_id: str) -> dict | None:
    with _lock:
        row = _db().execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    return dict(row) if row else None


def add_document(listing_id: str, doc_type: str, filename: str, mime: str, size: int, sha256: str) -> dict:
    doc_id = secrets.token_urlsafe(9)
    with _lock:
        conn = _db()
        conn.execute(
            """INSERT INTO documents (id, listing_id, type, filename, mime, size, sha256, status, uploaded_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (doc_id, listing_id, doc_type, filename, mime, size, sha256, _now()),
        )
        _append_event(conn, listing_id, "document", {"id": doc_id, "type": doc_type, "sha256": sha256})
        conn.commit()
    return get_document(doc_id)


def review_document(doc_id: str, status: str, note: str | None) -> dict | None:
    with _lock:
        conn = _db()
        row = conn.execute("SELECT listing_id, type, sha256 FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if row is None:
            return None
        conn.execute("UPDATE documents SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?", (status, note, _now(), doc_id))
        _append_event(conn, row["listing_id"], "review", {"id": doc_id, "type": row["type"], "sha256": row["sha256"], "status": status})
        conn.commit()
    return get_document(doc_id)


def documents_for_review(status: str = "pending") -> list[dict]:
    with _lock:
        rows = _db().execute(
            """SELECT d.*, l.title AS listing_title, l.place AS listing_place, l.category AS listing_category
               FROM documents d JOIN listings l ON l.id = d.listing_id
               WHERE d.status = ? AND l.status != 'removed' ORDER BY d.uploaded_at""",
            (status,),
        ).fetchall()
    return [dict(r) for r in rows]
