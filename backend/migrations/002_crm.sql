-- CRM: pipeline stages, contacts, leads, their timeline, and buyer messages.
-- Every lead belongs to an org. A solo seller's leads go to their personal org.
-- See docs/business-suite.md.

-- Seeded per org the first time its CRM is used: New, Contacted, Viewing set, Offer, Closed won, Closed lost
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    outcome TEXT CHECK (outcome IN ('won', 'lost'))
);
CREATE INDEX IF NOT EXISTS pipeline_stages_org ON pipeline_stages (org_id, position);

-- The person behind a lead. Only what's needed to reply: no address, birthday, IDs, or IP addresses.
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    -- The buyer's SmartLand account, when they asked while signed in. Lets them see replies.
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    -- Set from the inquiry form; null for contacts added by hand
    consent_at TEXT,
    consent_version TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contacts_org ON contacts (org_id);
CREATE INDEX IF NOT EXISTS contacts_user ON contacts (user_id);

CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
    stage_id TEXT NOT NULL REFERENCES pipeline_stages(id),
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('inquiry', 'manual')),
    -- The buyer's first message
    message TEXT,
    follow_up_on TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    -- Newest message, and when each side last read the thread, for unread counts
    last_message_at TEXT,
    team_read_at TEXT,
    buyer_read_at TEXT
);
CREATE INDEX IF NOT EXISTS leads_org_stage ON leads (org_id, stage_id);
CREATE INDEX IF NOT EXISTS leads_follow_up ON leads (org_id, follow_up_on);
CREATE INDEX IF NOT EXISTS leads_listing ON leads (listing_id);
CREATE INDEX IF NOT EXISTS leads_contact ON leads (contact_id);

-- The timeline. Append only.
CREATE TABLE IF NOT EXISTS lead_activities (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    -- Null for the buyer
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('created', 'note', 'stage', 'assigned', 'follow_up', 'inquiry')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_activities_lead ON lead_activities (lead_id, created_at);

-- Messages between the buyer and the seller's team, one thread per lead.
-- Notes are private to the team and live in lead_activities instead.
CREATE TABLE IF NOT EXISTS lead_messages (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('buyer', 'team')),
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_messages_lead ON lead_messages (lead_id, created_at);
