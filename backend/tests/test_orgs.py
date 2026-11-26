"""Business accounts: creating orgs, roles, invites, and keeping orgs apart"""

from datetime import datetime, timedelta, timezone

import db
import deps
from tests.conftest import LISTING, add_member, make_org


# Creating an org ---------------------------------------------------------------

def test_creator_becomes_owner(client, person):
    ana = person("ana@example.com")
    org = make_org(client, ana)
    assert org["role"] == "owner"
    mine = client.get("/api/business/orgs/mine", headers=ana.headers).json()
    assert [(o["id"], o["role"], o["members"]) for o in mine] == [(org["id"], "owner", 1)]


def test_brokerage_needs_prc_license(client, person):
    ana = person("ana@example.com")
    res = client.post("/api/business/orgs", json={"name": "Cruz Realty", "kind": "brokerage"}, headers=ana.headers)
    assert res.status_code == 422
    org = make_org(client, ana, "Cruz Realty", "brokerage", prc_license="0012345")
    assert org["prc_license"] == "0012345"


def test_license_dropped_for_other_kinds(client, person):
    org = make_org(client, person("ana@example.com"), kind="developer", prc_license="0012345")
    assert org["prc_license"] is None


def test_personal_kind_cant_be_created_directly(client, person):
    ana = person("ana@example.com")
    res = client.post("/api/business/orgs", json={"name": "Mine", "kind": "personal"}, headers=ana.headers)
    assert res.status_code == 422


def test_sign_in_required(client):
    assert client.get("/api/business/orgs/mine").status_code == 401
    assert client.post("/api/business/orgs", json={"name": "Acme", "kind": "agency"}).status_code == 401


# Roles -------------------------------------------------------------------------

def test_only_owner_and_admin_manage_members(client, person):
    owner, admin, member, guest, extra = (person(f"{n}@example.com") for n in ("owner", "admin", "member", "guest", "extra"))
    org = make_org(client, owner)
    add_member(client, org, owner, admin, "admin")
    add_member(client, org, owner, member, "member")
    add_member(client, org, admin, guest, "guest")
    add_member(client, org, owner, extra, "member")
    oid = org["id"]

    for who in (member, guest):
        assert client.post(f"/api/business/orgs/{oid}/invites", json={"email": "new@example.com", "role": "member"}, headers=who.headers).status_code == 403
        assert client.patch(f"/api/business/orgs/{oid}/members/{extra.id}", json={"role": "guest"}, headers=who.headers).status_code == 403
        assert client.delete(f"/api/business/orgs/{oid}/members/{extra.id}", headers=who.headers).status_code == 403

    assert client.patch(f"/api/business/orgs/{oid}/members/{extra.id}", json={"role": "guest"}, headers=admin.headers).json()["role"] == "guest"
    assert client.delete(f"/api/business/orgs/{oid}/members/{extra.id}", headers=admin.headers).status_code == 204
    roles = {m["email"]: m["role"] for m in client.get(f"/api/business/orgs/{oid}/members", headers=owner.headers).json()["members"]}
    assert roles == {"owner@example.com": "owner", "admin@example.com": "admin", "member@example.com": "member", "guest@example.com": "guest"}


def test_owner_cant_be_removed_or_demoted(client, person):
    owner, admin = person("owner@example.com"), person("admin@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, admin, "admin")
    oid = org["id"]
    for who in (owner, admin):
        assert client.delete(f"/api/business/orgs/{oid}/members/{owner.id}", headers=who.headers).status_code == 403
        assert client.patch(f"/api/business/orgs/{oid}/members/{owner.id}", json={"role": "member"}, headers=who.headers).status_code == 403
    # Owner is never a role you can give
    assert client.patch(f"/api/business/orgs/{oid}/members/{admin.id}", json={"role": "owner"}, headers=owner.headers).status_code == 422
    assert client.post(f"/api/business/orgs/{oid}/invites", json={"email": "x@example.com", "role": "owner"}, headers=owner.headers).status_code == 422


def test_admin_cant_change_another_admin(client, person):
    owner, a1, a2 = person("owner@example.com"), person("a1@example.com"), person("a2@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, a1, "admin")
    add_member(client, org, owner, a2, "admin")
    oid = org["id"]
    assert client.patch(f"/api/business/orgs/{oid}/members/{a2.id}", json={"role": "member"}, headers=a1.headers).status_code == 403
    assert client.delete(f"/api/business/orgs/{oid}/members/{a2.id}", headers=a1.headers).status_code == 403
    assert client.patch(f"/api/business/orgs/{oid}/members/{a2.id}", json={"role": "member"}, headers=owner.headers).status_code == 200


def test_members_can_leave(client, person):
    owner, member = person("owner@example.com"), person("member@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, member, "guest")
    assert client.delete(f"/api/business/orgs/{org['id']}/members/{member.id}", headers=member.headers).status_code == 204
    assert client.get(f"/api/business/orgs/{org['id']}", headers=member.headers).status_code == 404


def test_only_managers_see_pending_invites(client, person):
    owner, member = person("owner@example.com"), person("member@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, member)
    client.post(f"/api/business/orgs/{org['id']}/invites", json={"email": "later@example.com", "role": "member"}, headers=owner.headers)
    assert len(client.get(f"/api/business/orgs/{org['id']}/members", headers=owner.headers).json()["invites"]) == 1
    assert client.get(f"/api/business/orgs/{org['id']}/members", headers=member.headers).json()["invites"] == []


# Keeping orgs apart --------------------------------------------------------------

def test_member_of_org_a_cant_reach_org_b(client, person):
    a_owner, b_owner, b_member = person("a@example.com"), person("b@example.com"), person("bm@example.com")
    make_org(client, a_owner, "Org A")
    org_b = make_org(client, b_owner, "Org B")
    add_member(client, org_b, b_owner, b_member)
    bid = org_b["id"]
    h = a_owner.headers
    calls = [
        client.get(f"/api/business/orgs/{bid}", headers=h),
        client.get(f"/api/business/orgs/{bid}/members", headers=h),
        client.post(f"/api/business/orgs/{bid}/invites", json={"email": "x@example.com", "role": "admin"}, headers=h),
        client.delete(f"/api/business/orgs/{bid}/invites/whatever", headers=h),
        client.patch(f"/api/business/orgs/{bid}/members/{b_member.id}", json={"role": "guest"}, headers=h),
        client.delete(f"/api/business/orgs/{bid}/members/{b_member.id}", headers=h),
    ]
    # 404, not 403: outsiders can't even tell the org exists
    assert [r.status_code for r in calls] == [404] * len(calls)
    assert [o["id"] for o in client.get("/api/business/orgs/mine", headers=h).json()] != [bid]
    # Nothing changed in org B
    assert {m["email"] for m in client.get(f"/api/business/orgs/{bid}/members", headers=b_owner.headers).json()["members"]} == {
        "b@example.com",
        "bm@example.com",
    }


def test_unknown_org_is_404(client, person):
    assert client.get("/api/business/orgs/nope", headers=person("a@example.com").headers).status_code == 404


# Invites -----------------------------------------------------------------------------

def _invite(client, org, owner, email, role="member"):
    res = client.post(f"/api/business/orgs/{org['id']}/invites", json={"email": email, "role": role}, headers=owner.headers)
    assert res.status_code == 201
    return res.json()


def test_invite_preview_and_accept(client, person):
    owner, ben = person("owner@example.com"), person("ben@example.com")
    org = make_org(client, owner, "Acme Realty")
    inv = _invite(client, org, owner, "Ben@Example.com", "admin")
    preview = client.get(f"/api/invites/{inv['token']}").json()
    assert preview == {**preview, "email": "ben@example.com", "role": "admin", "org_name": "Acme Realty"}
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=ben.headers).json() == {"org_id": org["id"]}
    assert client.get(f"/api/business/orgs/{org['id']}", headers=ben.headers).json()["role"] == "admin"


def test_invite_token_isnt_stored(client, person):
    owner = person("owner@example.com")
    inv = _invite(client, make_org(client, owner), owner, "ben@example.com")
    with db.lock:
        rows = [dict(r) for r in db.conn().execute("SELECT * FROM org_invites").fetchall()]
    assert inv["token"] not in str(rows)


def test_invite_only_for_its_email(client, person):
    owner, eve = person("owner@example.com"), person("eve@example.com")
    org = make_org(client, owner)
    inv = _invite(client, org, owner, "ben@example.com")
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=eve.headers).status_code == 403
    assert client.get(f"/api/business/orgs/{org['id']}", headers=eve.headers).status_code == 404


def test_invite_works_once(client, person):
    owner, ben = person("owner@example.com"), person("ben@example.com")
    org = make_org(client, owner)
    inv = _invite(client, org, owner, "ben@example.com")
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=ben.headers).status_code == 200
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=ben.headers).status_code == 404
    assert client.get(f"/api/invites/{inv['token']}").status_code == 404


def test_invite_expires_after_seven_days(client, person):
    owner, ben = person("owner@example.com"), person("ben@example.com")
    org = make_org(client, owner)
    inv = _invite(client, org, owner, "ben@example.com")
    expires = datetime.fromisoformat(inv["expires_at"]) - datetime.fromisoformat(inv["created_at"])
    assert expires == timedelta(days=7)
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    with db.transaction() as c:
        c.execute("UPDATE org_invites SET expires_at = ?", (past,))
    assert client.get(f"/api/invites/{inv['token']}").status_code == 404
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=ben.headers).status_code == 404


def test_canceled_invite_stops_working(client, person):
    owner, ben = person("owner@example.com"), person("ben@example.com")
    org = make_org(client, owner)
    inv = _invite(client, org, owner, "ben@example.com")
    assert client.delete(f"/api/business/orgs/{org['id']}/invites/{inv['id']}", headers=owner.headers).status_code == 204
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=ben.headers).status_code == 404


def test_new_invite_replaces_old_one(client, person):
    owner, ben = person("owner@example.com"), person("ben@example.com")
    org = make_org(client, owner)
    old = _invite(client, org, owner, "ben@example.com", "guest")
    new = _invite(client, org, owner, "ben@example.com", "admin")
    assert client.post(f"/api/invites/{old['token']}/accept", headers=ben.headers).status_code == 404
    assert client.post(f"/api/invites/{new['token']}/accept", headers=ben.headers).status_code == 200


def test_cant_invite_existing_member(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    res = client.post(f"/api/business/orgs/{org['id']}/invites", json={"email": "OWNER@example.com", "role": "member"}, headers=owner.headers)
    assert res.status_code == 409


def test_invite_rate_limited(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    deps.limiter.enabled = True
    codes = [
        client.post(f"/api/business/orgs/{org['id']}/invites", json={"email": f"p{i}@example.com", "role": "member"}, headers=owner.headers).status_code
        for i in range(31)
    ]
    assert codes[:30] == [201] * 30 and codes[30] == 429


# Org listings ---------------------------------------------------------------------------

def test_org_listing_shows_org_and_license(client, person):
    broker = person("broker@example.com")
    org = make_org(client, broker, "Cruz Realty", "brokerage", prc_license="0012345")
    res = client.post("/api/listings", json={**LISTING, "org_id": org["id"]}, headers=broker.headers)
    assert res.status_code == 201
    listing = client.get(f"/api/listings/{res.json()['id']}").json()
    assert listing["org"] == {"id": org["id"], "name": "Cruz Realty", "kind": "brokerage", "prc_license": "0012345"}
    found = client.get("/api/listings", params={"lat": 13.94, "lon": 121.16}).json()["listings"]
    assert found[0]["org"]["name"] == "Cruz Realty"
    assert "contact_phone" not in found[0]


def test_solo_listing_still_works(client, person):
    ana = person("ana@example.com")
    res = client.post("/api/listings", json=LISTING, headers=ana.headers)
    assert res.status_code == 201 and res.json()["org"] is None
    lid = res.json()["id"]
    assert client.patch(f"/api/listings/{lid}", json={"price": 2_400_000}, headers=ana.headers).json()["price"] == 2_400_000
    assert client.patch(f"/api/listings/{lid}", json={"price": 1}, headers=person("eve@example.com").headers).status_code == 404
    assert client.delete(f"/api/listings/{lid}", headers=ana.headers).status_code == 204


def test_only_members_post_for_org(client, person):
    owner, guest, outsider = person("owner@example.com"), person("guest@example.com"), person("out@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, guest, "guest")
    assert client.post("/api/listings", json={**LISTING, "org_id": org["id"]}, headers=guest.headers).status_code == 403
    assert client.post("/api/listings", json={**LISTING, "org_id": org["id"]}, headers=outsider.headers).status_code == 404


def test_org_admin_edits_org_listing(client, person):
    owner, admin, member, other = (person(f"{n}@example.com") for n in ("owner", "admin", "member", "other"))
    org = make_org(client, owner)
    add_member(client, org, owner, admin, "admin")
    add_member(client, org, owner, member, "member")
    add_member(client, org, owner, other, "member")
    lid = client.post("/api/listings", json={**LISTING, "org_id": org["id"]}, headers=member.headers).json()["id"]

    assert client.get(f"/api/listings/{lid}", headers=admin.headers).json()["mine"] is True
    assert client.get(f"/api/listings/{lid}", headers=other.headers).json()["mine"] is False
    assert client.patch(f"/api/listings/{lid}", json={"status": "sold"}, headers=admin.headers).json()["status"] == "sold"
    assert client.patch(f"/api/listings/{lid}", json={"status": "active"}, headers=other.headers).status_code == 404

    # A poster who leaves the org can't edit its listing anymore
    client.delete(f"/api/business/orgs/{org['id']}/members/{member.id}", headers=member.headers)
    assert client.patch(f"/api/listings/{lid}", json={"status": "active"}, headers=member.headers).status_code == 404


# Email verified flag -------------------------------------------------------------------

def test_password_accounts_start_unverified(client):
    res = client.post("/api/auth/register", json={"email": "new@example.com", "password": "password123"})
    assert res.json()["user"]["email_verified"] is False
