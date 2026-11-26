-- Team workspace: channels, direct messages, @mentions, and tasks, per business account.
-- See docs/business-suite.md, section 5.

-- A channel is open to everyone in the org. A dm is between exactly two members (ws_dm_members).
CREATE TABLE IF NOT EXISTS ws_channels (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('channel', 'dm')),
    -- Lowercase, no spaces, for channels; null for DMs
    name TEXT,
    topic TEXT,
    -- "userA:userB" with the ids sorted, so a pair has one DM
    dm_key TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    archived_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ws_channels_name ON ws_channels (org_id, name) WHERE kind = 'channel';
CREATE UNIQUE INDEX IF NOT EXISTS ws_channels_dm ON ws_channels (org_id, dm_key) WHERE kind = 'dm';

CREATE TABLE IF NOT EXISTS ws_dm_members (
    channel_id TEXT NOT NULL REFERENCES ws_channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS ws_dm_members_user ON ws_dm_members (user_id);

CREATE TABLE IF NOT EXISTS ws_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES ws_channels(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    -- Mentions are stored as <@user_id>
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    edited_at TEXT,
    -- A deleted message keeps its place with an empty body
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ws_messages_channel ON ws_messages (channel_id, created_at);

CREATE TABLE IF NOT EXISTS ws_mentions (
    message_id TEXT NOT NULL REFERENCES ws_messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS ws_mentions_user ON ws_mentions (user_id);

-- When each person last read each channel, for new-message counts
CREATE TABLE IF NOT EXISTS ws_reads (
    channel_id TEXT NOT NULL REFERENCES ws_channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS ws_tasks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    due_on TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    done_at TEXT
);
CREATE INDEX IF NOT EXISTS ws_tasks_org ON ws_tasks (org_id, status, due_on);
CREATE INDEX IF NOT EXISTS ws_tasks_lead ON ws_tasks (lead_id);
