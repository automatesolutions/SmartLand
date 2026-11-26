"""Performance: daily listing visits by source, and inquiries by source, per org.
All SQL for listing_visits lives here. Callers check permissions first.
"""

from datetime import datetime, timedelta, timezone

import db

# Daily totals older than this are removed, the same as leads (crm_repo.KEEP_DAYS)
KEEP_DAYS = 2 * 365
# Days are Philippine days, so "today" turns over at midnight in Manila
PH = timezone(timedelta(hours=8))


def ph_today() -> str:
    return datetime.now(PH).date().isoformat()


def add_visit(listing_id: str, source: str, medium: str = "", campaign: str = "") -> None:
    with db.transaction() as c:
        c.execute(
            """INSERT INTO listing_visits (listing_id, day, source, medium, campaign, visits) VALUES (?, ?, ?, ?, ?, 1)
               ON CONFLICT (listing_id, day, source, medium, campaign) DO UPDATE SET visits = visits + 1""",
            (listing_id, ph_today(), source, medium, campaign),
        )


def _org_listings(org: dict) -> str:
    """SQL selecting the org's listing ids. A personal org's listings are the owner's own, posted for no business."""
    if org["kind"] == "personal":
        return "SELECT id FROM listings WHERE org_id IS NULL AND user_id = :owner AND status != 'removed'"
    return "SELECT id FROM listings WHERE org_id = :org AND status != 'removed'"


def report(org: dict, owner_id: str, days: int) -> dict:
    """Visits and inquiries for the org's listings over the last `days` Philippine days, today included.
    `owner_id` is whose listings a personal org covers."""
    since_day = (datetime.now(PH).date() - timedelta(days=days - 1)).isoformat()
    # Leads store UTC times; the day starts at midnight in Manila
    since_ts = datetime.fromisoformat(since_day).replace(tzinfo=PH).astimezone(timezone.utc).isoformat()
    args = {"org": org["id"], "owner": owner_id, "day": since_day, "ts": since_ts}
    with db.transaction() as c:
        mine = _org_listings(org)
        listings = c.execute(
            f"""SELECT li.id, li.title, li.status,
                       COALESCE((SELECT SUM(v.visits) FROM listing_visits v WHERE v.listing_id = li.id AND v.day >= :day), 0) AS visits,
                       (SELECT COUNT(*) FROM leads l WHERE l.listing_id = li.id AND l.org_id = :org AND l.source = 'inquiry'
                          AND l.created_at >= :ts) AS inquiries
                FROM listings li WHERE li.id IN ({mine})
                ORDER BY visits DESC, inquiries DESC, li.created_at DESC""",
            args,
        ).fetchall()
        visits = c.execute(
            f"""SELECT source, SUM(visits) AS n FROM listing_visits
                WHERE day >= :day AND listing_id IN ({mine}) GROUP BY source""",
            args,
        ).fetchall()
        inquiries = c.execute(
            f"""SELECT COALESCE(utm_source, 'direct') AS source, COUNT(*) AS n FROM leads
                WHERE org_id = :org AND source = 'inquiry' AND created_at >= :ts AND listing_id IN ({mine})
                GROUP BY COALESCE(utm_source, 'direct')""",
            args,
        ).fetchall()
        daily = c.execute(
            f"""SELECT day, SUM(visits) AS n FROM listing_visits
                WHERE day >= :day AND listing_id IN ({mine}) GROUP BY day ORDER BY day""",
            args,
        ).fetchall()

    by_source: dict[str, dict] = {}
    for r in visits:
        by_source.setdefault(r["source"], {"source": r["source"], "visits": 0, "inquiries": 0})["visits"] = r["n"]
    for r in inquiries:
        by_source.setdefault(r["source"], {"source": r["source"], "visits": 0, "inquiries": 0})["inquiries"] = r["n"]
    rows = [dict(r) for r in listings]
    return {
        "days": days,
        "since": since_day,
        "totals": {"visits": sum(r["visits"] for r in rows), "inquiries": sum(r["inquiries"] for r in rows)},
        "listings": rows,
        "sources": sorted(by_source.values(), key=lambda s: (-s["visits"], -s["inquiries"], s["source"])),
        "daily": [{"day": r["day"], "visits": r["n"]} for r in daily],
    }


def purge_old() -> int:
    """Removes daily totals older than KEEP_DAYS. Returns how many rows went."""
    cutoff = (datetime.now(PH).date() - timedelta(days=KEEP_DAYS)).isoformat()
    with db.transaction() as c:
        return c.execute("DELETE FROM listing_visits WHERE day < ?", (cutoff,)).rowcount
