-- Business accounts: orgs, their members, and invites. See docs/business-suite.md.

-- Set when the email is confirmed. Google sign-ins come with a Google-verified email.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
UPDATE users SET email_verified = 1 WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- brokerage, developer, agency, other; personal is a seller's own CRM, with no other members
    kind TEXT NOT NULL CHECK (kind IN ('brokerage', 'developer', 'agency', 'other', 'personal')),
    prc_license TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS orgs_one_personal ON orgs (created_by) WHERE kind = 'personal';

CREATE TABLE IF NOT EXISTS org_members (
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (org_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_one_owner ON org_members (org_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS org_members_user ON org_members (user_id);

-- The invite token is shown once; only its SHA-256 is kept
CREATE TABLE IF NOT EXISTS org_invites (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
    token_hash TEXT NOT NULL UNIQUE,
    invited_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    accepted_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS org_invites_org ON org_invites (org_id);

-- Null for solo sellers. user_id stays "who posted it".
ALTER TABLE listings ADD COLUMN org_id TEXT REFERENCES orgs(id);
CREATE INDEX IF NOT EXISTS listings_org ON listings (org_id);
