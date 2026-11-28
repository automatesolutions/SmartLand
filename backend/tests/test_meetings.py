"""Calls with buyers in the conversation: asking, booking, joining from Messages, and who sees what"""

from datetime import datetime, timedelta, timezone

import jwt

import calls
import calls_repo
from tests.conftest import add_member, make_org
from tests.test_calls import SECRET, kit  # noqa: F401  (fixture)
from tests.test_crm import ask, board, post_listing


def setup(client, person):
    owner, buyer = person("owner@example.com"), person("buyer@example.com")
    org = make_org(client, owner)
    listing = post_listing(client, owner, org)
    assert ask(client, listing, headers=buyer.headers).status_code == 201
    [lead] = board(client, org["id"], owner)["leads"]
    return owner, buyer, org, lead


def thread(client, lead, buyer) -> dict:
    return client.get(f"/api/messages/{lead['id']}", headers=buyer.headers).json()


def soon(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def test_buyer_asks_for_a_call_now_and_joins_when_accepted(client, person, kit):  # noqa: F811
    owner, buyer, org, lead = setup(client, person)
    base = f"/api/business/orgs/{org['id']}/leads/{lead['id']}/meetings"

    req = client.post(f"/api/messages/{lead['id']}/meetings", json={"kind": "video", "note": "After 5 is best"}, headers=buyer.headers)
    assert req.status_code == 201, req.text
    assert (req.json()["status"], req.json()["when"]) == ("requested", "as soon as you can")
    # The seller sees it on the lead, on the Business page, and as a new message
    assert [m["id"] for m in client.get(base, headers=owner.headers).json()] == [req.json()["id"]]
    assert client.get(f"/api/business/orgs/{org['id']}/meetings", headers=owner.headers).json()[0]["contact_name"]
    assert "video call about this property, as soon as you can. After 5 is best" in thread(client, lead, buyer)["messages"][-1]["body"]

    # Not joinable until the seller answers
    assert client.post(f"/api/messages/{lead['id']}/call", headers=buyer.headers).status_code == 409
    ok = client.patch(f"{base}/{req.json()['id']}", json={"status": "scheduled"}, headers=owner.headers)
    assert ok.json()["status"] == "scheduled" and ok.json()["joinable"] is True
    assert "booked for" in thread(client, lead, buyer)["messages"][-1]["body"]

    state = client.get(f"/api/messages/{lead['id']}/calls", headers=buyer.headers).json()
    assert state["call"] == {"live": False, "people": 0}
    joined = client.post(f"/api/messages/{lead['id']}/call", headers=buyer.headers)
    assert joined.status_code == 200, joined.text
    claims = jwt.decode(joined.json()["token"], SECRET, algorithms=["HS256"])
    assert claims["sub"] == f"b:{buyer.id}" and "screen_share" not in claims["video"]["canPublishSources"]

    # The seller joins the same call from the lead
    tour = client.get(f"/api/business/orgs/{org['id']}/leads/{lead['id']}/tour", headers=owner.headers).json()["call"]
    assert tour["id"] == joined.json()["call"]["id"]
    assert client.post(f"/api/business/orgs/{org['id']}/calls/{tour['id']}/join", headers=owner.headers).status_code == 200
    assert client.post(f"/api/messages/{lead['id']}/call/leave", headers=buyer.headers).status_code == 204


def test_team_books_a_time_and_either_side_cancels(client, person, kit):  # noqa: F811
    owner, buyer, org, lead = setup(client, person)
    base = f"/api/business/orgs/{org['id']}/leads/{lead['id']}/meetings"

    assert client.post(base, json={"kind": "voice"}, headers=owner.headers).status_code == 422
    assert client.post(base, json={"kind": "voice", "starts_at": soon(-60)}, headers=owner.headers).status_code == 422
    booked = client.post(base, json={"kind": "voice", "starts_at": soon(120)}, headers=owner.headers)
    assert booked.status_code == 201 and booked.json()["joinable"] is False
    assert "I booked a voice call with you for" in thread(client, lead, buyer)["messages"][-1]["body"]
    # Too early to open the call
    assert client.post(f"/api/messages/{lead['id']}/call", headers=buyer.headers).status_code == 409

    # Moved to 5 minutes from now: inside the 10-minute window, so the buyer can open it
    moved = client.patch(f"{base}/{booked.json()['id']}", json={"status": "scheduled", "starts_at": soon(5)}, headers=owner.headers)
    assert moved.json()["joinable"] is True and "moved our voice call" in thread(client, lead, buyer)["messages"][-1]["body"]
    assert client.post(f"/api/messages/{lead['id']}/call", headers=buyer.headers).status_code == 200

    assert client.delete(f"/api/messages/{lead['id']}/meetings/{booked.json()['id']}", headers=buyer.headers).status_code == 204
    assert client.get(base, headers=owner.headers).json() == []


def test_seller_starting_a_call_tells_the_buyer(client, person, kit):  # noqa: F811
    owner, buyer, org, lead = setup(client, person)
    made = client.post(f"/api/business/orgs/{org['id']}/leads/{lead['id']}/tour", headers=owner.headers).json()
    client.post(f"/api/business/orgs/{org['id']}/calls/{made['call']['id']}/join", headers=owner.headers)
    assert thread(client, lead, buyer)["messages"][-1]["body"] == "I started a call. Join it here in Messages."
    assert client.get(f"/api/messages/{lead['id']}/calls", headers=buyer.headers).json()["call"]["live"] is True
    # Only once per call
    client.post(f"/api/business/orgs/{org['id']}/calls/{made['call']['id']}/join", headers=owner.headers)
    assert sum(m["body"].startswith("I started a call") for m in thread(client, lead, buyer)["messages"]) == 1
    assert calls_repo.people(made["call"]["id"])


def test_only_the_buyer_and_the_leads_team_see_it(client, person, kit):  # noqa: F811
    owner, buyer, org, lead = setup(client, person)
    stranger, guest = person("stranger@example.com"), person("guest@example.com")
    add_member(client, org, owner, guest, role="guest")
    client.post(f"/api/messages/{lead['id']}/meetings", json={"kind": "video"}, headers=buyer.headers)
    assert client.get(f"/api/messages/{lead['id']}/calls", headers=stranger.headers).status_code == 404
    assert client.post(f"/api/messages/{lead['id']}/meetings", json={"kind": "video"}, headers=stranger.headers).status_code == 404
    # A guest sees only leads assigned to them
    assert client.get(f"/api/business/orgs/{org['id']}/meetings", headers=guest.headers).json() == []


def test_calls_off_shows_nothing(client, person):
    owner, buyer, org, lead = setup(client, person)
    assert calls.kit is None
    assert client.get(f"/api/messages/{lead['id']}/calls", headers=buyer.headers).json() == {"enabled": False, "call": None, "meetings": []}
