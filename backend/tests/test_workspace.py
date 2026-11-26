"""Team workspace: channels, DMs, mentions, unread counts, tasks, and keeping orgs apart"""

import pytest

from tests.conftest import LISTING, add_member, make_org


def base(org):
    return f"/api/business/orgs/{org['id']}/workspace"


def load(client, org, who):
    res = client.get(base(org), headers=who.headers)
    assert res.status_code == 200, res.text
    return res.json()


def general(client, org, who):
    return next(c for c in load(client, org, who)["channels"] if c["name"] == "general")


def say(client, org, who, channel, body):
    return client.post(f"{base(org)}/channels/{channel['id']}/messages", json={"body": body}, headers=who.headers)


def read(client, org, who, channel, **params):
    res = client.get(f"{base(org)}/channels/{channel['id']}/messages", params=params, headers=who.headers)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.fixture
def team(client, person):
    """An org with an owner, an admin, a member, and a guest"""
    owner, admin, member, guest = (person(f"{n}@example.com") for n in ("owner", "admin", "member", "guest"))
    org = make_org(client, owner, "Cruz Realty")
    add_member(client, org, owner, admin, "admin")
    add_member(client, org, owner, member, "member")
    add_member(client, org, owner, guest, "guest")
    return org, owner, admin, member, guest


# Channels ----------------------------------------------------------------------

def test_every_business_starts_with_general(client, team):
    org, owner, *_ = team
    ws = load(client, org, owner)
    assert [c["name"] for c in ws["channels"]] == ["general"]
    assert len(ws["members"]) == 4
    # Loading again doesn't make another
    assert [c["name"] for c in load(client, org, owner)["channels"]] == ["general"]


def test_only_owner_and_admin_manage_channels(client, team):
    org, owner, admin, member, guest = team
    url = f"{base(org)}/channels"
    for who in (member, guest):
        assert client.post(url, json={"name": "viewings"}, headers=who.headers).status_code == 403
    made = client.post(url, json={"name": "Batangas Lots", "topic": "South"}, headers=admin.headers)
    assert made.status_code == 201
    assert made.json()["name"] == "batangas-lots"
    assert client.post(url, json={"name": "batangas-lots"}, headers=owner.headers).status_code == 409
    assert client.post(url, json={"name": "no spaces!"}, headers=owner.headers).status_code == 422

    cid = made.json()["id"]
    assert client.patch(f"{url}/{cid}", json={"archived": True}, headers=member.headers).status_code == 403
    assert client.patch(f"{url}/{cid}", json={"archived": True}, headers=owner.headers).status_code == 200
    assert [c["name"] for c in load(client, org, member)["channels"]] == ["general"]


def test_general_cant_be_renamed_or_archived(client, team):
    org, owner, *_ = team
    g = general(client, org, owner)
    url = f"{base(org)}/channels/{g['id']}"
    assert client.patch(url, json={"archived": True}, headers=owner.headers).status_code == 422
    assert client.patch(url, json={"name": "lobby"}, headers=owner.headers).status_code == 422


def test_cant_post_in_archived_channel(client, team):
    org, owner, admin, member, _ = team
    ch = client.post(f"{base(org)}/channels", json={"name": "old"}, headers=owner.headers).json()
    client.patch(f"{base(org)}/channels/{ch['id']}", json={"archived": True}, headers=owner.headers)
    assert say(client, org, member, ch, "hello").status_code == 409


def test_personal_crm_has_no_workspace(client, person):
    ana = person("ana@example.com")
    org = client.post("/api/business/personal", headers=ana.headers).json()
    assert client.get(base(org), headers=ana.headers).status_code == 422


# Messages ----------------------------------------------------------------------

def test_members_chat_and_guests_only_read(client, team):
    org, owner, admin, member, guest = team
    g = general(client, org, owner)
    assert say(client, org, member, g, "New lot in Lipa").status_code == 201
    assert say(client, org, guest, g, "hi").status_code == 403
    assert [m["body"] for m in read(client, org, guest, g)["messages"]] == ["New lot in Lipa"]


def test_polling_returns_new_edited_and_deleted(client, team):
    org, owner, admin, member, _ = team
    g = general(client, org, owner)
    first = say(client, org, member, g, "one").json()
    cursor = read(client, org, owner, g)["cursor"]
    assert read(client, org, owner, g, since=cursor)["messages"] == []

    say(client, org, admin, g, "two")
    client.patch(f"{base(org)}/messages/{first['id']}", json={"body": "one, fixed"}, headers=member.headers)
    changed = read(client, org, owner, g, since=cursor)["messages"]
    assert sorted(m["body"] for m in changed) == ["one, fixed", "two"]
    assert next(m for m in changed if m["id"] == first["id"])["edited_at"]

    cursor = read(client, org, owner, g)["cursor"]
    client.delete(f"{base(org)}/messages/{first['id']}", headers=member.headers)
    [gone] = read(client, org, owner, g, since=cursor)["messages"]
    assert gone["deleted"] and gone["body"] == ""


def test_older_pages(client, team):
    org, owner, *_ = team
    g = general(client, org, owner)
    for i in range(105):
        say(client, org, owner, g, f"m{i}")
    newest = read(client, org, owner, g)["messages"]
    assert len(newest) == 100 and newest[-1]["body"] == "m104"
    older = read(client, org, owner, g, before=newest[0]["created_at"])["messages"]
    assert [m["body"] for m in older] == ["m0", "m1", "m2", "m3", "m4"]


def test_only_author_edits_and_moderators_delete_in_channels(client, team):
    org, owner, admin, member, guest = team
    g = general(client, org, owner)
    msg = say(client, org, member, g, "mine").json()
    url = f"{base(org)}/messages/{msg['id']}"
    assert client.patch(url, json={"body": "theirs"}, headers=owner.headers).status_code == 403
    assert client.delete(url, headers=guest.headers).status_code == 403
    assert client.delete(url, headers=admin.headers).status_code == 204
    assert client.patch(url, json={"body": "back"}, headers=member.headers).status_code == 404


# Direct messages ------------------------------------------------------------------

def test_dm_is_private_to_the_two(client, team):
    org, owner, admin, member, guest = team
    dm = client.post(f"{base(org)}/dms", json={"user_id": admin.id}, headers=member.headers).json()
    assert dm["kind"] == "dm" and dm["with"]["id"] == admin.id
    # Same pair, same DM, whoever opens it
    assert client.post(f"{base(org)}/dms", json={"user_id": member.id}, headers=admin.headers).json()["id"] == dm["id"]

    msg = say(client, org, member, dm, "Can you take the Saturday viewing?").json()
    assert [m["body"] for m in read(client, org, admin, dm)["messages"]] == ["Can you take the Saturday viewing?"]
    # Not even the owner can read it or delete in it
    assert client.get(f"{base(org)}/channels/{dm['id']}/messages", headers=owner.headers).status_code == 404
    assert client.delete(f"{base(org)}/messages/{msg['id']}", headers=owner.headers).status_code == 404
    assert all(c["id"] != dm["id"] for c in load(client, org, owner)["channels"])


def test_dm_only_with_teammates(client, team, person):
    org, owner, *_ = team
    stranger = person("stranger@example.com")
    assert client.post(f"{base(org)}/dms", json={"user_id": stranger.id}, headers=owner.headers).status_code == 422
    assert client.post(f"{base(org)}/dms", json={"user_id": owner.id}, headers=owner.headers).status_code == 422


def test_leaving_the_team_closes_your_dms(client, team):
    org, owner, admin, member, _ = team
    dm = client.post(f"{base(org)}/dms", json={"user_id": admin.id}, headers=member.headers).json()
    client.delete(f"/api/business/orgs/{org['id']}/members/{member.id}", headers=owner.headers)
    assert client.get(f"{base(org)}/channels/{dm['id']}/messages", headers=member.headers).status_code == 404


# Unread counts and mentions ------------------------------------------------------------

def test_unread_counts_and_mentions(client, team):
    org, owner, admin, member, _ = team
    g = general(client, org, owner)
    read(client, org, member, g)
    say(client, org, admin, g, "Morning")
    say(client, org, admin, g, f"<@{member.id}> can you call Ben?")
    # A mention of someone outside the team is dropped
    say(client, org, admin, g, "<@nobody123> hi")

    mine = general(client, org, member)
    assert (mine["unread"], mine["mentions"]) == (3, 1)
    # Your own messages never count
    assert general(client, org, admin)["unread"] == 0

    dm = client.post(f"{base(org)}/dms", json={"user_id": member.id}, headers=admin.headers).json()
    say(client, org, admin, dm, "Ping")
    # The nav badge counts DMs and mentions, not every channel message
    assert client.get("/api/business/workspace/unread", headers=member.headers).json() == {"count": 2, "by_org": {org["id"]: 2}}

    read(client, org, member, g)
    read(client, org, member, dm)
    assert client.get("/api/business/workspace/unread", headers=member.headers).json()["count"] == 0


def test_editing_away_a_mention_removes_it(client, team):
    org, owner, admin, member, _ = team
    g = general(client, org, owner)
    read(client, org, member, g)
    msg = say(client, org, admin, g, f"<@{member.id}> hi").json()
    client.patch(f"{base(org)}/messages/{msg['id']}", json={"body": "hi all"}, headers=admin.headers)
    assert general(client, org, member)["mentions"] == 0


# Tasks ---------------------------------------------------------------------------

def test_tasks(client, team):
    org, owner, admin, member, guest = team
    url = f"{base(org)}/tasks"
    assert client.post(url, json={"title": "Call the assessor"}, headers=guest.headers).status_code == 403
    t = client.post(url, json={"title": "Call the assessor", "assignee_id": member.id, "due_on": "2026-12-01"}, headers=admin.headers).json()
    assert t["assignee"]["id"] == member.id and t["status"] == "open"

    done = client.patch(f"{url}/{t['id']}", json={"status": "done"}, headers=member.headers).json()
    assert done["status"] == "done" and done["done_at"]
    assert client.get(url, params={"status": "open"}, headers=guest.headers).json() == []
    assert [x["id"] for x in client.get(url, params={"mine": True}, headers=member.headers).json()] == [t["id"]]

    # The member didn't make it, so only its maker or an owner or admin deletes it
    assert client.delete(f"{url}/{t['id']}", headers=member.headers).status_code == 403
    assert client.delete(f"{url}/{t['id']}", headers=owner.headers).status_code == 204


def test_task_links_stay_inside_the_org(client, team, person):
    org, owner, *_ = team
    outsider = person("outsider@example.com")
    other = make_org(client, outsider, "Other Realty")
    theirs = client.post("/api/listings", json={**LISTING, "org_id": other["id"]}, headers=outsider.headers).json()
    ours = client.post("/api/listings", json={**LISTING, "org_id": org["id"]}, headers=owner.headers).json()
    url = f"{base(org)}/tasks"
    assert client.post(url, json={"title": "x", "listing_id": theirs["id"]}, headers=owner.headers).status_code == 422
    assert client.post(url, json={"title": "x", "assignee_id": outsider.id}, headers=owner.headers).status_code == 422

    client.post(f"/api/listings/{ours['id']}/inquiries", json={"name": "Ben", "phone": "0918 222 3344", "message": "Hi", "consent": True})
    lead = client.get(f"/api/business/orgs/{org['id']}/crm", headers=owner.headers).json()["leads"][0]
    t = client.post(url, json={"title": "Send the title copy", "lead_id": lead["id"], "listing_id": ours["id"]}, headers=owner.headers).json()
    assert t["lead"]["name"] == "Ben" and t["listing"]["id"] == ours["id"]
    assert [x["id"] for x in client.get(url, params={"lead_id": lead["id"]}, headers=owner.headers).json()] == [t["id"]]


# Keeping orgs apart ------------------------------------------------------------------

def test_other_org_sees_nothing(client, team, person):
    org, owner, admin, member, _ = team
    outsider = person("outsider@example.com")
    make_org(client, outsider, "Other Realty")
    g = general(client, org, owner)
    msg = say(client, org, member, g, "secret").json()
    task = client.post(f"{base(org)}/tasks", json={"title": "t"}, headers=owner.headers).json()
    h = outsider.headers
    for res in (
        client.get(base(org), headers=h),
        client.get(f"{base(org)}/channels/{g['id']}/messages", headers=h),
        client.post(f"{base(org)}/channels/{g['id']}/messages", json={"body": "hi"}, headers=h),
        client.post(f"{base(org)}/channels", json={"name": "x"}, headers=h),
        client.post(f"{base(org)}/dms", json={"user_id": owner.id}, headers=h),
        client.patch(f"{base(org)}/messages/{msg['id']}", json={"body": "x"}, headers=h),
        client.delete(f"{base(org)}/messages/{msg['id']}", headers=h),
        client.get(f"{base(org)}/tasks", headers=h),
        client.patch(f"{base(org)}/tasks/{task['id']}", json={"status": "done"}, headers=h),
        client.delete(f"{base(org)}/tasks/{task['id']}", headers=h),
    ):
        assert res.status_code == 404, res.request.url
    assert client.get("/api/business/workspace/unread", headers=h).json()["count"] == 0
