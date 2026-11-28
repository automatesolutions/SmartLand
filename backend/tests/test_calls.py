"""Huddles and live tours: who may join, links that work once, caps, and LiveKit's webhooks.
LiveKit is replaced by a stand-in with fake keys; nothing goes over the network."""

import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone

import jwt
import pytest

import calls
import calls_repo
import db
import livekit_api
from tests.conftest import add_member, make_org
from tests.test_crm import ask, board, post_listing

SECRET = "fake-livekit-secret-for-tests-only"


class FakeKit(livekit_api.LiveKit):
    def __init__(self):
        super().__init__("wss://example.livekit.cloud", "APItest", SECRET)
        self.ended: list[str] = []
        self.in_room: set[str] | None = None

    def end_room(self, room):
        self.ended.append(room)
        return True

    def people_in(self, room):
        return self.in_room


@pytest.fixture
def kit(monkeypatch):
    fake = FakeKit()
    monkeypatch.setattr(calls, "kit", fake)
    return fake


def claims(res) -> dict:
    assert res.status_code == 200, res.text
    return jwt.decode(res.json()["token"], SECRET, algorithms=["HS256"])


def general(client, org, who) -> dict:
    res = client.get(f"/api/business/orgs/{org['id']}/workspace", headers=who.headers)
    assert res.status_code == 200, res.text
    return next(c for c in res.json()["channels"] if c["name"] == "general")


def huddle(client, org, channel, who):
    return client.post(f"/api/business/orgs/{org['id']}/workspace/channels/{channel['id']}/huddle", headers=who.headers)


def signed(body: dict, secret: str = SECRET) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    sha = base64.b64encode(hashlib.sha256(raw).digest()).decode()
    token = jwt.encode({"iss": "APItest", "sha256": sha, "exp": int(datetime.now().timestamp()) + 60}, secret, algorithm="HS256")
    return raw, {"Authorization": token, "Content-Type": "application/webhook+json"}


def test_off_until_keys_are_set(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    assert client.get("/api/calls/config").json()["enabled"] is False
    assert huddle(client, org, general(client, org, owner), owner).status_code == 503
    assert general(client, org, owner)["huddle"] is None


def test_huddle_start_join_and_leave(client, person, kit):
    owner, agent, outsider = person("owner@example.com"), person("agent@example.com"), person("outsider@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, agent)
    ch = general(client, org, owner)

    first = huddle(client, org, ch, owner)
    c = claims(first)
    call_id = first.json()["call"]["id"]
    assert c["sub"] == f"u:{owner.id}" and c["iss"] == "APItest"
    assert c["video"]["room"] == f"smartland-{call_id}" and c["video"]["roomJoin"] is True
    assert "screen_share" in c["video"]["canPublishSources"]
    assert c["roomConfig"]["maxParticipants"] == calls.HUDDLE_PEOPLE
    assert first.json()["url"] == "wss://example.livekit.cloud"

    # The channel shows the huddle, and the next person joins the same one
    assert general(client, org, agent)["huddle"] == {"id": call_id, "people": ["owner"]}
    second = huddle(client, org, ch, agent)
    assert second.json()["call"]["id"] == call_id
    assert [p["name"] for p in second.json()["call"]["people"]] == ["owner", "agent"]
    # Outsiders can't see or join it
    assert huddle(client, org, ch, outsider).status_code == 404

    # When the last person leaves, the huddle ends
    for who in (owner, agent):
        assert client.post(f"/api/business/orgs/{org['id']}/calls/{call_id}/leave", headers=who.headers).status_code == 204
    assert general(client, org, owner)["huddle"] is None
    assert calls_repo.get(call_id)["ended_at"] is not None


def test_guests_join_but_dont_start_and_dms_stay_private(client, person, kit):
    owner, guest, agent, other = (person(f"{n}@example.com") for n in ("owner", "guest", "agent", "other"))
    org = make_org(client, owner)
    add_member(client, org, owner, guest, role="guest")
    add_member(client, org, owner, agent)
    add_member(client, org, owner, other)
    ch = general(client, org, owner)

    assert huddle(client, org, ch, guest).status_code == 403
    huddle(client, org, ch, owner)
    assert huddle(client, org, ch, guest).status_code == 200

    dm = client.post(f"/api/business/orgs/{org['id']}/workspace/dms", json={"user_id": agent.id}, headers=owner.headers).json()
    call = huddle(client, org, dm, owner).json()["call"]
    assert huddle(client, org, dm, other).status_code == 404
    assert client.post(f"/api/business/orgs/{org['id']}/calls/{call['id']}/join", headers=other.headers).status_code == 404
    assert client.post(f"/api/business/orgs/{org['id']}/calls/{call['id']}/join", headers=agent.headers).status_code == 200


def test_a_full_call_asks_livekit_who_is_really_there(client, person, kit, monkeypatch):
    owner, agent = person("owner@example.com"), person("agent@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, agent)
    ch = general(client, org, owner)
    monkeypatch.setattr(calls, "HUDDLE_PEOPLE", 1)
    huddle(client, org, ch, owner)

    kit.in_room = {f"u:{owner.id}"}
    res = huddle(client, org, ch, agent)
    assert res.status_code == 422 and "full" in res.json()["detail"]
    # The owner's phone dropped without saying so: LiveKit says the room is empty
    kit.in_room = set()
    assert huddle(client, org, ch, agent).status_code == 200


def test_monthly_minutes_stop_new_calls(client, person, kit, monkeypatch):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    ch = general(client, org, owner)
    with db.transaction() as c:
        c.execute("INSERT INTO call_minutes (org_id, month, minutes) VALUES (?, ?, ?)", (org["id"], calls_repo.month(), 599.0))
    monkeypatch.setattr(calls, "ORG_MONTH_MINUTES", 599)
    res = huddle(client, org, ch, owner)
    assert res.status_code == 422 and "599 call minutes" in res.json()["detail"]

    monkeypatch.setattr(calls, "ORG_MONTH_MINUTES", 600)
    monkeypatch.setattr(calls, "SITE_MONTH_MINUTES", 500)
    assert "paused" in huddle(client, org, ch, owner).json()["detail"]


def test_minutes_are_counted_and_long_calls_end(client, person, kit):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    ch = general(client, org, owner)
    call_id = huddle(client, org, ch, owner).json()["call"]["id"]
    ten_ago = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    with db.transaction() as c:
        c.execute("UPDATE call_people SET joined_at = ? WHERE call_id = ?", (ten_ago, call_id))
    assert 9.9 < calls_repo.minutes_used(org["id"]) < 10.5

    # Past its end time, the call is closed in LiveKit and here, and counted up to the end only
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    with db.transaction() as c:
        c.execute("UPDATE calls SET expires_at = ? WHERE id = ?", (past, call_id))
    assert general(client, org, owner)["huddle"] is None
    assert kit.ended == [f"smartland-{call_id}"]
    assert 8.9 < calls_repo.minutes_used(org["id"]) < 9.5


def lead_for(client, owner, org):
    listing = post_listing(client, owner, org)
    assert ask(client, listing).status_code == 201
    [lead] = board(client, org["id"], owner)["leads"]
    return listing, lead


def test_live_tour_link(client, person, kit):
    owner, guest = person("owner@example.com"), person("guest@example.com")
    org = make_org(client, owner, "Cruz Realty")
    add_member(client, org, owner, guest, role="guest")
    listing, lead = lead_for(client, owner, org)
    base = f"/api/business/orgs/{org['id']}/leads/{lead['id']}/tour"

    # Guests can't start tours
    assert client.post(base, headers=guest.headers).status_code == 403
    assert client.get(base, headers=owner.headers).json() == {"enabled": True, "call": None}
    res = client.post(base, headers=owner.headers)
    assert res.status_code == 200, res.text
    link = res.json()["link"]
    token = link.removeprefix("/tour/")
    call_id = res.json()["call"]["id"]

    info = client.get(f"/api/tours/{token}").json()
    assert (info["state"], info["host"], info["listing"]["title"]) == ("live", "Cruz Realty", listing["title"])

    # The buyer joins with a name and consent; no screen sharing for buyers
    assert client.post(f"/api/tours/{token}/join", json={"name": "Ben", "consent": False}).status_code == 422
    joined = client.post(f"/api/tours/{token}/join", json={"name": "  Ben   Reyes ", "consent": True})
    c = claims(joined)
    assert c["name"] == "Ben Reyes" and c["sub"].startswith("g:")
    assert "screen_share" not in c["video"]["canPublishSources"]
    assert c["roomConfig"]["maxParticipants"] == calls.TOUR_PEOPLE
    # The link lasts 2 hours, but each visit is capped at the call length
    ends = datetime.fromisoformat(joined.json()["ends_at"]) - datetime.now(timezone.utc)
    assert timedelta(minutes=calls.CALL_MINUTES - 1) < ends <= timedelta(minutes=calls.CALL_MINUTES)
    seller = client.post(f"/api/business/orgs/{org['id']}/calls/{call_id}/join", headers=owner.headers)
    assert claims(seller)["video"]["room"] == f"smartland-{call_id}"

    # The buyer leaving doesn't end the tour
    assert client.post(f"/api/tours/{token}/leave", json={"identity": joined.json()["identity"]}).status_code == 204
    assert client.get(f"/api/tours/{token}").json()["state"] == "live"

    # A new link replaces the old one
    fresh = client.post(base, headers=owner.headers).json()
    assert fresh["call"]["id"] == call_id
    assert client.get(f"/api/tours/{token}").status_code == 404
    token = fresh["link"].removeprefix("/tour/")

    # Ending it closes the room and the link
    assert client.post(f"/api/business/orgs/{org['id']}/calls/{call_id}/end", headers=owner.headers).status_code == 204
    assert kit.ended == [f"smartland-{call_id}"]
    assert client.get(f"/api/tours/{token}").json()["state"] == "ended"
    assert client.post(f"/api/tours/{token}/join", json={"name": "Ben", "consent": True}).status_code == 410
    assert client.get("/api/tours/not-a-real-link").status_code == 404


def test_webhooks_must_be_signed_and_keep_the_counts(client, person, kit):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    listing, lead = lead_for(client, owner, org)
    tour = client.post(f"/api/business/orgs/{org['id']}/leads/{lead['id']}/tour", headers=owner.headers).json()
    room = {"name": f"smartland-{tour['call']['id']}"}

    raw, headers = signed({"event": "participant_joined", "room": room, "participant": {"identity": "g:abc", "name": "Ben"}}, "wrong-secret")
    assert client.post("/api/calls/livekit", content=raw, headers=headers).status_code == 401
    raw, headers = signed({"event": "participant_joined", "room": room, "participant": {"identity": "g:abc", "name": "Ben"}})
    headers["Authorization"] = "Bearer " + headers["Authorization"]
    assert client.post("/api/calls/livekit", content=raw, headers=headers).status_code == 200
    assert [p["name"] for p in calls_repo.people(tour["call"]["id"])] == ["Ben"]

    # The room closing doesn't end a tour: the link still works for the buyer
    raw, headers = signed({"event": "room_finished", "room": room})
    assert client.post("/api/calls/livekit", content=raw, headers=headers).status_code == 200
    assert calls_repo.people(tour["call"]["id"]) == []
    assert calls_repo.get(tour["call"]["id"])["ended_at"] is None
    # A body changed after signing is refused
    raw, headers = signed({"event": "room_finished", "room": room})
    assert client.post("/api/calls/livekit", content=raw + b" ", headers=headers).status_code == 401


def test_old_calls_are_removed_but_minutes_stay(client, person, kit):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    ch = general(client, org, owner)
    call_id = huddle(client, org, ch, owner).json()["call"]["id"]
    client.post(f"/api/business/orgs/{org['id']}/calls/{call_id}/leave", headers=owner.headers)
    old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    with db.transaction() as c:
        c.execute("UPDATE calls SET ended_at = ? WHERE id = ?", (old, call_id))
        c.execute("INSERT OR REPLACE INTO call_minutes (org_id, month, minutes) VALUES (?, ?, 5)", (org["id"], calls_repo.month()))
    assert calls_repo.purge_old() == 1
    with db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM call_people").fetchone()[0] == 0
    assert calls_repo.minutes_used(org["id"]) == 5
