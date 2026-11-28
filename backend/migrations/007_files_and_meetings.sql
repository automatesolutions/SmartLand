-- Files attached to team chat messages, and calls booked with buyers.
-- See docs/business-suite.md, section 10.

-- Private to the business. The file itself is in the same storage as listing videos (video_storage.py).
CREATE TABLE IF NOT EXISTS ws_files (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES ws_channels(id) ON DELETE CASCADE,
    -- Null until the message is sent
    message_id TEXT REFERENCES ws_messages(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    object_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ws_files_message ON ws_files (message_id);
CREATE INDEX IF NOT EXISTS ws_files_org ON ws_files (org_id, status);

-- A call with a lead's buyer: asked for by the buyer, or booked by the team.
-- The call itself is a row in `calls` (kind 'tour'), made when someone joins.
CREATE TABLE IF NOT EXISTS lead_meetings (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('video', 'voice')),
    status TEXT NOT NULL CHECK (status IN ('requested', 'scheduled', 'canceled')),
    -- Null means "as soon as you can"
    starts_at TEXT,
    asked_by TEXT NOT NULL CHECK (asked_by IN ('buyer', 'team')),
    note TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_meetings_lead ON lead_meetings (lead_id, status);
CREATE INDEX IF NOT EXISTS lead_meetings_org ON lead_meetings (org_id, status, starts_at);
