"""The one database connection, shared by store.py and the business repos.

Today it's SQLite. Moving to Postgres means changing this file (connection,
placeholders) and the SQL files in migrations/; the repos above it keep their
SQL, which sticks to what SQLite and Postgres both understand.

Tables for the original app live in store.SCHEMA. Tables added since live in
numbered files in migrations/, each run once and recorded in schema_migrations.
"""

import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

DATABASE_PATH = os.getenv("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "smartland.db"))
MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")

# Reentrant, so a repo function can call another while holding it
lock = threading.RLock()
_conn: sqlite3.Connection | None = None
# Run once when the connection opens, before migrations (store.py's base schema)
_on_open: list = []


def on_open(fn) -> None:
    _on_open.append(fn)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_migrations(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
    for name in sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql")):
        if name in done:
            continue
        with open(os.path.join(MIGRATIONS_DIR, name), encoding="utf-8") as fh:
            conn.executescript(fh.read())
        conn.execute("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", (name, now()))
        conn.commit()


def conn() -> sqlite3.Connection:
    global _conn
    with lock:
        if _conn is None:
            os.makedirs(os.path.dirname(os.path.abspath(DATABASE_PATH)), exist_ok=True)
            c = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA foreign_keys = ON")
            # Write-ahead log: what Litestream copies to the bucket (see start.sh)
            c.execute("PRAGMA journal_mode = WAL")
            c.execute("PRAGMA busy_timeout = 5000")
            for fn in _on_open:
                fn(c)
            _run_migrations(c)
            _conn = c
        return _conn


@contextmanager
def transaction():
    """Holds the lock and commits at the end, or rolls back on any error"""
    with lock:
        c = conn()
        try:
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise


def use(path: str) -> None:
    """Points at another database file. For tests."""
    global _conn, DATABASE_PATH
    with lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        DATABASE_PATH = path
