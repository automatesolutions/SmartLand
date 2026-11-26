"""CRM: inquiries become leads for the right org, orgs stay apart, and every change is logged"""

from datetime import datetime, timedelta, timezone

import crm_repo
import db
import deps
from tests.conftest import LISTING, add_member, make_org

ASK = {"name": "Ben Reyes", "phone": "0918 222 3344", "message": "Is the title clean?", "consent": True}


def post_listing(client, who, org=None) -> dict:
    res = client.post("/api/listings", json={**LISTING, **({"org_id": org["id"]} if org else {})}, headers=who.headers)
    assert res.status_code == 201, res.text
    return res.json()


def ask(client, listing, headers=None, **extra):
    return client.post(f"/api/listings/{listing['id']}/inquiries", json={**ASK, **extra}, headers=headers or {})


def board(client, org_id, who):
    res = client.get(f"/api/business/orgs/{org_id}/crm", headers=who.headers)
    assert res.status_code == 200, res.text
    return res.json()


def personal(client, who) -> dict:
    return client.post("/api/business/personal", headers=who.headers).json()


# Inquiries -------------------------------------------------------------------

def test_inquiry_on_org_listing_goes_to_that_org(client, person):
    owner, agent, other = person("owner@example.com"), person("agent@example.com"), person("other@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, agent)
    make_org(client, other, "Other Realty")
    listing = post_listing(client, agent, org)

    assert ask(client, listing).status_code == 201
    crm = board(client, org["id"], owner)
    assert [s["name"] for s in crm["stages"]] == ["New", "Contacted", "Viewing set", "Offer", "Closed won", "Closed lost"]
    [lead] = crm["leads"]
    assert lead["contact_name"] == "Ben Reyes"
    assert lead["stage"] == "New"
    assert lead["listing"]["id"] == listing["id"]
    # The agent who posted it works it
    assert lead["assignee"]["id"] == agent.id
    # Nothing landed in anyone's personal CRM
    assert board(client, personal(client, agent)["id"], agent)["leads"] == []


def test_inquiry_on_solo_listing_goes_to_sellers_personal_crm(client, person):
    ana = person("ana@example.com")
    listing = post_listing(client, ana)
    assert ask(client, listing).status_code == 201
    crm_org = personal(client, ana)
    assert crm_org["kind"] == "personal"
    [lead] = board(client, crm_org["id"], ana)["leads"]
    assert lead["assignee"]["id"] == ana.id
    # The personal CRM still isn't a business account anyone else can see
    assert client.get("/api/business/orgs/mine", headers=ana.headers).json()[0]["kind"] == "personal"


def test_personal_crm_is_made_once(client, person):
    ana = person("ana@example.com")
    assert personal(client, ana)["id"] == personal(client, ana)["id"]


def test_consent_required(client, person):
    listing = post_listing(client, person("ana@example.com"))
    assert ask(client, listing, consent=False).status_code == 422


def test_phone_or_email_required_when_signed_out(client, person):
    listing = post_listing(client, person("ana@example.com"))
    assert ask(client, listing, phone=None).status_code == 422


def test_signed_in_buyer_can_skip_contact_fields(client, person):
    ana, ben = person("ana@example.com"), person("ben@example.com")
    listing = post_listing(client, ana)
    res = ask(client, listing, ben.headers, phone=None)
    assert res.status_code == 201
    assert res.json()["thread_id"]
    lead_id = board(client, personal(client, ana)["id"], ana)["leads"][0]["id"]
    detail = client.get(f"/api/business/orgs/{personal(client, ana)['id']}/leads/{lead_id}", headers=ana.headers).json()
    assert detail["contact"]["email"] == "ben@example.com"
    assert detail["contact"]["consent_version"] == "2026-11-v1"


def test_honeypot_keeps_nothing(client, person):
    ana = person("ana@example.com")
    listing = post_listing(client, ana)
    assert ask(client, listing, website="http://spam.example").status_code == 201
    assert board(client, personal(client, ana)["id"], ana)["leads"] == []


def test_no_inquiries_on_sold_listings(client, person):
    ana = person("ana@example.com")
    listing = post_listing(client, ana)
    client.patch(f"/api/listings/{listing['id']}", json={"status": "sold"}, headers=ana.headers)
    assert ask(client, listing).status_code == 409


def test_no_inquiry_on_your_own_listing(client, person):
    ana = person("ana@example.com")
    listing = post_listing(client, ana)
    assert ask(client, listing, ana.headers).status_code == 422


def test_repeat_inquiry_joins_the_open_lead(client, person):
    ana = person("ana@example.com")
    listing = post_listing(client, ana)
    ask(client, listing)
    # Same phone written differently
    ask(client, listing, phone="09182223344", message="Can I visit on Saturday?")
    crm_org = personal(client, ana)
    [lead] = board(client, crm_org["id"], ana)["leads"]
    detail = client.get(f"/api/business/orgs/{crm_org['id']}/leads/{lead['id']}", headers=ana.headers).json()
    assert [m["body"] for m in detail["messages"]] == ["Is the title clean?", "Can I visit on Saturday?"]


def test_repeat_after_a_day_makes_a_new_lead(client, person):
    ana = person("ana@example.com")
    listing = post_listing(client, ana)
    ask(client, listing)
    old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    with db.transaction() as c:
        c.execute("UPDATE leads SET created_at = ?", (old,))
    ask(client, listing)
    assert len(board(client, personal(client, ana)["id"], ana)["leads"]) == 2


def test_inquiry_rate_limit(client, person):
    listing = post_listing(client, person("ana@example.com"))
    deps.limiter.enabled = True
    codes = [ask(client, listing, phone=f"0918 222 33{i:02d}").status_code for i in range(6)]
    assert codes == [201] * 5 + [429]


# Keeping orgs apart ------------------------------------------------------------

def test_other_org_cant_see_the_lead_or_the_buyers_phone(client, person):
    owner, outsider = person("owner@example.com"), person("outsider@example.com")
    org = make_org(client, owner)
    other = make_org(client, outsider, "Other Realty")
    listing = post_listing(client, owner, org)
    ask(client, listing)
    lead_id = board(client, org["id"], owner)["leads"][0]["id"]
    base = f"/api/business/orgs/{org['id']}"

    h = outsider.headers
    assert client.get(f"{base}/crm", headers=h).status_code == 404
    assert client.get(f"{base}/leads/{lead_id}", headers=h).status_code == 404
    assert client.patch(f"{base}/leads/{lead_id}", json={"follow_up_on": "2026-12-01"}, headers=h).status_code == 404
    assert client.post(f"{base}/leads/{lead_id}/notes", json={"text": "hi"}, headers=h).status_code == 404
    assert client.post(f"{base}/leads/{lead_id}/messages", json={"text": "hi"}, headers=h).status_code == 404
    assert client.delete(f"{base}/leads/{lead_id}", headers=h).status_code == 404
    # Their own org id with this lead id doesn't work either
    assert client.get(f"/api/business/orgs/{other['id']}/leads/{lead_id}", headers=h).status_code == 404
    assert client.get(f"/api/messages/{lead_id}", headers=h).status_code == 404
    assert client.get(f"/api/business/leads/{lead_id}", headers=h).status_code == 404
    assert client.get(f"/api/business/leads/{lead_id}", headers=owner.headers).json()["org_id"] == org["id"]

    # The phone never shows in listing responses or search
    for res in (
        client.get(f"/api/listings/{listing['id']}", headers=h),
        client.get("/api/listings", params={"lat": LISTING["lat"], "lon": LISTING["lon"], "radius_km": 5}),
        client.get("/api/listings/mine", headers=owner.headers),
    ):
        assert "2223344" not in res.text.replace(" ", "")


def test_guest_sees_only_assigned_leads_and_cant_edit(client, person):
    owner, guest = person("owner@example.com"), person("guest@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, guest, "guest")
    listing = post_listing(client, owner, org)
    ask(client, listing)
    ask(client, listing, phone="0918 999 0000", name="Cara Diaz")
    leads = board(client, org["id"], owner)["leads"]
    base = f"/api/business/orgs/{org['id']}"
    assert board(client, org["id"], guest)["leads"] == []
    assert client.get(f"{base}/leads/{leads[0]['id']}", headers=guest.headers).status_code == 404

    client.patch(f"{base}/leads/{leads[0]['id']}", json={"assignee_id": guest.id}, headers=owner.headers)
    assert [lead["id"] for lead in board(client, org["id"], guest)["leads"]] == [leads[0]["id"]]
    assert client.patch(f"{base}/leads/{leads[0]['id']}", json={"follow_up_on": "2026-12-01"}, headers=guest.headers).status_code == 403


def test_only_owner_and_admin_delete_leads(client, person):
    owner, member = person("owner@example.com"), person("member@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, member)
    listing = post_listing(client, owner, org)
    ask(client, listing)
    lead_id = board(client, org["id"], owner)["leads"][0]["id"]
    base = f"/api/business/orgs/{org['id']}/leads/{lead_id}"
    assert client.delete(base, headers=member.headers).status_code == 403
    assert client.delete(base, headers=owner.headers).status_code == 204
    assert board(client, org["id"], owner)["leads"] == []
    with db.lock:
        assert db.conn().execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 0


# Working a lead -----------------------------------------------------------------

def test_each_change_adds_one_timeline_entry(client, person):
    owner, member = person("owner@example.com"), person("member@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, member)
    listing = post_listing(client, owner, org)
    ask(client, listing)
    crm = board(client, org["id"], owner)
    lead_id = crm["leads"][0]["id"]
    contacted = crm["stages"][1]["id"]
    base = f"/api/business/orgs/{org['id']}/leads/{lead_id}"

    client.patch(base, json={"stage_id": contacted}, headers=member.headers)
    client.patch(base, json={"assignee_id": member.id}, headers=owner.headers)
    client.patch(base, json={"follow_up_on": "2026-12-01"}, headers=member.headers)
    client.post(f"{base}/notes", json={"text": "Called, will visit Saturday"}, headers=member.headers)
    # Setting the same stage again logs nothing
    detail = client.patch(base, json={"stage_id": contacted}, headers=member.headers).json()

    kinds = [(a["kind"], a["body"]) for a in detail["activities"]]
    assert kinds == [
        ("created", {"source": "inquiry"}),
        ("stage", {"from": "New", "to": "Contacted"}),
        ("assigned", {"to": "member"}),
        ("follow_up", {"on": "2026-12-01"}),
        ("note", {"text": "Called, will visit Saturday"}),
    ]
    assert detail["follow_up_on"] == "2026-12-01"


def test_closing_stage_sets_closed_at(client, person):
    ana = person("ana@example.com")
    ask(client, post_listing(client, ana))
    org_id = personal(client, ana)["id"]
    crm = board(client, org_id, ana)
    won = next(s for s in crm["stages"] if s["outcome"] == "won")
    detail = client.patch(f"/api/business/orgs/{org_id}/leads/{crm['leads'][0]['id']}", json={"stage_id": won["id"]}, headers=ana.headers).json()
    assert detail["closed_at"]


def test_stage_and_assignee_must_belong_to_the_org(client, person):
    owner, outsider = person("owner@example.com"), person("outsider@example.com")
    org = make_org(client, owner)
    other = make_org(client, outsider, "Other Realty")
    ask(client, post_listing(client, owner, org))
    lead_id = board(client, org["id"], owner)["leads"][0]["id"]
    foreign_stage = board(client, other["id"], outsider)["stages"][1]["id"]
    base = f"/api/business/orgs/{org['id']}/leads/{lead_id}"
    assert client.patch(base, json={"stage_id": foreign_stage}, headers=owner.headers).status_code == 404
    assert client.patch(base, json={"assignee_id": outsider.id}, headers=owner.headers).status_code == 422


def test_manual_lead(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    base = f"/api/business/orgs/{org['id']}/leads"
    assert client.post(base, json={"name": "Dina"}, headers=owner.headers).status_code == 422
    res = client.post(base, json={"name": "Dina", "email": "dina@example.com", "note": "Walk-in", "follow_up_on": "2026-12-02"}, headers=owner.headers)
    assert res.status_code == 201
    lead = res.json()
    assert lead["source"] == "manual"
    assert lead["contact"]["consent_at"] is None
    assert [a["kind"] for a in lead["activities"]] == ["created", "note"]


def test_manual_lead_cant_point_at_another_orgs_listing(client, person):
    owner, outsider = person("owner@example.com"), person("outsider@example.com")
    org = make_org(client, owner)
    theirs = post_listing(client, outsider, make_org(client, outsider, "Other Realty"))
    res = client.post(f"/api/business/orgs/{org['id']}/leads", json={"name": "Dina", "phone": "0918 111 2222", "listing_id": theirs["id"]}, headers=owner.headers)
    assert res.status_code == 422


# Messages between buyer and seller ------------------------------------------------

def test_buyer_and_seller_message_each_other(client, person):
    ana, ben = person("ana@example.com"), person("ben@example.com")
    listing = post_listing(client, ana)
    thread_id = ask(client, listing, ben.headers).json()["thread_id"]
    org_id = personal(client, ana)["id"]

    assert board(client, org_id, ana)["leads"][0]["unread"] == 1
    lead = client.post(f"/api/business/orgs/{org_id}/leads/{thread_id}/messages", json={"text": "Yes, it's clean."}, headers=ana.headers).json()
    assert [m["sender"] for m in lead["messages"]] == ["buyer", "team"]

    assert client.get("/api/messages/unread", headers=ben.headers).json() == {"count": 1}
    [thread] = client.get("/api/messages", headers=ben.headers).json()
    assert thread["seller"] == "Ana Cruz"
    assert thread["listing"]["title"] == LISTING["title"]
    opened = client.get(f"/api/messages/{thread_id}", headers=ben.headers).json()
    assert [m["body"] for m in opened["messages"]] == ["Is the title clean?", "Yes, it's clean."]
    assert client.get("/api/messages/unread", headers=ben.headers).json() == {"count": 0}

    client.post(f"/api/messages/{thread_id}", json={"text": "Great, thanks"}, headers=ben.headers)
    assert board(client, org_id, ana)["leads"][0]["unread"] == 1


def test_buyer_thread_hides_team_details(client, person):
    owner, ben = person("owner@example.com"), person("ben@example.com")
    org = make_org(client, owner, "Cruz Realty")
    listing = post_listing(client, owner, org)
    thread_id = ask(client, listing, ben.headers).json()["thread_id"]
    client.post(f"/api/business/orgs/{org['id']}/leads/{thread_id}/notes", json={"text": "Private note"}, headers=owner.headers)
    client.post(f"/api/business/orgs/{org['id']}/leads/{thread_id}/messages", json={"text": "Hello"}, headers=owner.headers)
    res = client.get(f"/api/messages/{thread_id}", headers=ben.headers)
    assert res.json()["seller"] == "Ana Cruz, Cruz Realty"
    assert "Private note" not in res.text
    assert "owner@example.com" not in res.text
    assert "activities" not in res.json()


def test_only_the_buyer_sees_their_thread(client, person):
    ana, ben, cara = person("ana@example.com"), person("ben@example.com"), person("cara@example.com")
    thread_id = ask(client, post_listing(client, ana), ben.headers).json()["thread_id"]
    assert client.get(f"/api/messages/{thread_id}", headers=cara.headers).status_code == 404
    assert client.post(f"/api/messages/{thread_id}", json={"text": "hi"}, headers=cara.headers).status_code == 404
    assert client.get("/api/messages", headers=cara.headers).json() == []


def test_cant_message_a_buyer_without_an_account(client, person):
    ana = person("ana@example.com")
    res = ask(client, post_listing(client, ana))
    assert res.json()["thread_id"] is None
    org_id = personal(client, ana)["id"]
    lead_id = board(client, org_id, ana)["leads"][0]["id"]
    assert client.post(f"/api/business/orgs/{org_id}/leads/{lead_id}/messages", json={"text": "hi"}, headers=ana.headers).status_code == 409


# Keeping only what's needed ------------------------------------------------------

def test_old_closed_leads_lose_contact_details(client, person):
    ana, ben = person("ana@example.com"), person("ben@example.com")
    listing = post_listing(client, ana)
    ask(client, listing, ben.headers)
    ask(client, listing, phone="0918 999 0000", name="Cara Diaz")
    org_id = personal(client, ana)["id"]
    crm = board(client, org_id, ana)
    lost = next(s for s in crm["stages"] if s["outcome"] == "lost")
    old_id = next(lead["id"] for lead in crm["leads"] if lead["contact_name"] == "Ben Reyes")
    client.patch(f"/api/business/orgs/{org_id}/leads/{old_id}", json={"stage_id": lost["id"]}, headers=ana.headers)
    long_ago = (datetime.now(timezone.utc) - timedelta(days=crm_repo.KEEP_DAYS + 1)).isoformat()
    with db.transaction() as c:
        c.execute("UPDATE leads SET closed_at = ? WHERE id = ?", (long_ago, old_id))

    assert crm_repo.purge_expired() == 1
    detail = client.get(f"/api/business/orgs/{org_id}/leads/{old_id}", headers=ana.headers).json()
    assert detail["contact"] == {**detail["contact"], "name": "Former contact", "phone": None, "email": None, "has_account": False}
    assert detail["messages"] == []
    assert [a["kind"] for a in detail["activities"]] == ["created", "stage"]
    # The open lead is untouched, and running it again clears nothing new
    assert crm_repo.purge_expired() == 0
    assert client.get("/api/messages", headers=ben.headers).json() == []
