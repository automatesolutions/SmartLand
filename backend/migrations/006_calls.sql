-- Huddles (team calls in a chat channel or DM) and live tours (a seller shows a buyer the property).
-- The audio and video go through LiveKit; nothing is recorded. See docs/business-suite.md, section 10.

CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('huddle', 'tour')),
    -- Huddles belong to a channel or DM, tours to a lead
    channel_id TEXT REFERENCES ws_channels(id) ON DELETE CASCADE,
    lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
    started_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    -- Tours: SHA-256 of the buyer's link, so a database copy can't be used to join
    invite_hash TEXT UNIQUE,
    created_at TEXT NOT NULL,
    -- Huddles end here; a tour's link stops working here
    expires_at TEXT NOT NULL,
    ended_at TEXT
);
CREATE INDEX IF NOT EXISTS calls_open ON calls (org_id, ended_at);
CREATE INDEX IF NOT EXISTS calls_channel ON calls (channel_id, ended_at);
CREATE INDEX IF NOT EXISTS calls_lead ON calls (lead_id);

-- Who joined, from our own join links and LiveKit's webhooks. Removed 30 days after the call ends.
CREATE TABLE IF NOT EXISTS call_people (
    call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    -- "u:<user id>" for the team, "g:<random>" for a buyer on a tour
    identity TEXT NOT NULL,
    name TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    PRIMARY KEY (call_id, identity, joined_at)
);
CREATE INDEX IF NOT EXISTS call_people_open ON call_people (call_id, left_at);

-- Participant minutes per business per Philippine month, for the caps. No names, kept after calls are removed.
CREATE TABLE IF NOT EXISTS call_minutes (
    org_id TEXT NOT NULL,
    month TEXT NOT NULL,
    minutes REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, month)
);
