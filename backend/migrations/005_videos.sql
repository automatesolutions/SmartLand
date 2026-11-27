-- Walkthrough videos on listings. See docs/business-suite.md, section 4.
-- The file itself lives in Cloudflare R2 (or a local folder in development);
-- this table keeps what the caps need: who uploaded it, its size, and its state.

-- 'pending' from the moment the upload link is handed out until the file is
-- checked; pending rows that never finish are cleared after a few hours.
CREATE TABLE IF NOT EXISTS listing_videos (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    duration_s INTEGER,
    status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
    created_at TEXT NOT NULL,
    ready_at TEXT
);
CREATE INDEX IF NOT EXISTS listing_videos_listing ON listing_videos (listing_id, status);
CREATE INDEX IF NOT EXISTS listing_videos_user ON listing_videos (user_id);
