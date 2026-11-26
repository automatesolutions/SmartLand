-- Listing visits and where leads came from, for the performance page.
-- See docs/business-suite.md, section 7. Counts only: no IP address, cookie, or
-- anything else that identifies a visitor.

-- One row per listing, Philippine day, and source. `source` is 'direct' when the
-- visitor had no UTM tags and no outside referrer; medium and campaign are '' when unset.
CREATE TABLE IF NOT EXISTS listing_visits (
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    source TEXT NOT NULL,
    medium TEXT NOT NULL DEFAULT '',
    campaign TEXT NOT NULL DEFAULT '',
    visits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (listing_id, day, source, medium, campaign)
);
CREATE INDEX IF NOT EXISTS listing_visits_day ON listing_visits (day);

-- Where the buyer came from when they first asked, kept on the lead.
-- New columns rather than a new `source` value, so the existing CHECK stays as it is.
ALTER TABLE leads ADD COLUMN utm_source TEXT;
ALTER TABLE leads ADD COLUMN utm_medium TEXT;
ALTER TABLE leads ADD COLUMN utm_campaign TEXT;
