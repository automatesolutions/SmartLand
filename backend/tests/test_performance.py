"""Performance: visit counts by source, inquiries by source, who can see them, and keeping orgs apart"""

from datetime import datetime, timedelta

import db
import performance_repo
from tests.conftest import add_member, make_org
from tests.test_crm import ask, personal, post_listing


def visit(client, listing, headers=None, **ref):
    return client.post(f"/api/listings/{listing['id']}/visits", json=ref, headers=headers or {})


def report(client, org_id, who, days=30):
    res = client.get(f"/api/business/orgs/{org_id}/performance", params={"days": days}, headers=who.headers)
    assert res.status_code == 200, res.text
    return res.json()


def by_source(rep):
    return {s["source"]: (s["visits"], s["inquiries"]) for s in rep["sources"]}


def test_visits_count_by_source_and_tags_are_cleaned(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    listing = post_listing(client, owner, org)

    assert visit(client, listing, source="facebook", medium="social", campaign="Lipa Farm Lots").status_code == 204
    assert visit(client, listing, source="Facebook").status_code == 204
    assert visit(client, listing).status_code == 204
    # Odd characters are dropped rather than refused
    assert visit(client, listing, source="tik tok<script>").status_code == 204

    rep = report(client, org["id"], owner)
    assert rep["totals"] == {"visits": 4, "inquiries": 0}
    assert by_source(rep) == {"facebook": (2, 0), "direct": (1, 0), "tik-tokscript": (1, 0)}
    [row] = rep["listings"]
    assert (row["id"], row["visits"]) == (listing["id"], 4)
    assert rep["daily"] == [{"day": performance_repo.ph_today(), "visits": 4}]
    with db.transaction() as c:
        campaigns = {r[0] for r in c.execute("SELECT campaign FROM listing_visits")}
    assert "lipa-farm-lots" in campaigns


def test_the_team_viewing_its_own_listing_isnt_a_visit(client, person):
    owner, agent, buyer = person("owner@example.com"), person("agent@example.com"), person("buyer@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, agent)
    listing = post_listing(client, agent, org)

    for who in (owner, agent):
        assert visit(client, listing, who.headers, source="facebook").status_code == 204
    assert report(client, org["id"], owner)["totals"]["visits"] == 0
    # A signed-in buyer counts
    visit(client, listing, buyer.headers, source="facebook")
    assert report(client, org["id"], owner)["totals"]["visits"] == 1


def test_inquiry_keeps_where_the_buyer_came_from(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    listing = post_listing(client, owner, org)

    assert ask(client, listing, ref={"source": "TikTok", "medium": "video", "campaign": "lipa"}).status_code == 201
    # A repeat from the same phone joins the lead and keeps the first source
    assert ask(client, listing, ref={"source": "viber"}).status_code == 201
    assert ask(client, listing, name="Carla Diaz", phone="0919 111 2222").status_code == 201

    leads = client.get(f"/api/business/orgs/{org['id']}/crm", headers=owner.headers).json()["leads"]
    refs = {l["contact_name"]: l["ref"] for l in leads}
    assert refs == {"Ben Reyes": {"source": "tiktok", "medium": "video", "campaign": "lipa"}, "Carla Diaz": None}
    rep = report(client, org["id"], owner)
    assert rep["totals"]["inquiries"] == 2
    assert by_source(rep) == {"tiktok": (0, 1), "direct": (0, 1)}


def test_only_owner_admin_and_member_see_performance(client, person):
    owner, member, guest, outsider = (person(f"{n}@example.com") for n in ("owner", "member", "guest", "outsider"))
    org = make_org(client, owner)
    add_member(client, org, owner, member, "member")
    add_member(client, org, owner, guest, "guest")
    url = f"/api/business/orgs/{org['id']}/performance"

    assert client.get(url, headers=member.headers).status_code == 200
    assert client.get(url, headers=guest.headers).status_code == 403
    assert client.get(url, headers=outsider.headers).status_code == 404
    assert client.get(url).status_code == 401
    assert client.get(url, params={"days": 45}, headers=owner.headers).status_code == 422


def test_orgs_and_personal_crms_see_only_their_own_listings(client, person):
    ana, ben = person("ana@example.com"), person("ben@example.com")
    org = make_org(client, ana, "Cruz Realty")
    org_listing = post_listing(client, ana, org)
    solo_listing = post_listing(client, ana)
    bens = post_listing(client, ben)
    for listing in (org_listing, solo_listing, solo_listing, bens):
        visit(client, listing, source="facebook")

    assert [(r["id"], r["visits"]) for r in report(client, org["id"], ana)["listings"]] == [(org_listing["id"], 1)]
    mine = personal(client, ana)
    assert [(r["id"], r["visits"]) for r in report(client, mine["id"], ana)["listings"]] == [(solo_listing["id"], 2)]
    # Ben can't open Ana's business
    assert client.get(f"/api/business/orgs/{org['id']}/performance", headers=ben.headers).status_code == 404


def test_period_and_cleanup(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    listing = post_listing(client, owner, org)
    today = datetime.fromisoformat(performance_repo.ph_today()).date()
    with db.transaction() as c:
        for days_ago, n in ((0, 1), (10, 2), (60, 4), (performance_repo.KEEP_DAYS + 5, 8)):
            c.execute(
                "INSERT INTO listing_visits (listing_id, day, source, visits) VALUES (?, ?, 'facebook', ?)",
                (listing["id"], (today - timedelta(days=days_ago)).isoformat(), n),
            )
    assert report(client, org["id"], owner, 7)["totals"]["visits"] == 1
    assert report(client, org["id"], owner, 30)["totals"]["visits"] == 3
    assert report(client, org["id"], owner, 90)["totals"]["visits"] == 7
    assert performance_repo.purge_old() == 1


def test_visit_to_a_missing_listing(client):
    assert client.post("/api/listings/nope/visits", json={"source": "facebook"}).status_code == 404
