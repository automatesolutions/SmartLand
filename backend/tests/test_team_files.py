"""Files in team chat: upload, check, send, open, privacy in DMs, caps, and cleanup. Local storage only."""

import os
from datetime import datetime, timedelta, timezone

import pytest

import db
import team_files
import team_files_repo
import video_storage
from tests.conftest import add_member, make_org

PDF = b"%PDF-1.7\n" + b"x" * 500


@pytest.fixture(autouse=True)
def fresh_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(video_storage, "videos", video_storage.LocalVideos(str(tmp_path / "store")))


def general(client, org, who) -> dict:
    return next(c for c in client.get(f"/api/business/orgs/{org['id']}/workspace", headers=who.headers).json()["channels"] if c["name"] == "general")


def start(client, org, ch, who, data=PDF, name="Title scan.pdf", mime="application/pdf", size=None):
    return client.post(
        f"/api/business/orgs/{org['id']}/workspace/channels/{ch['id']}/files",
        json={"name": name, "mime": mime, "size": len(data) if size is None else size},
        headers=who.headers,
    )


def upload(client, org, ch, who, data=PDF, **kw) -> dict:
    res = start(client, org, ch, who, data, **kw)
    assert res.status_code == 201, res.text
    up = res.json()
    assert client.put(up["upload"]["url"], content=data, headers=up["upload"]["headers"]).status_code == 200
    return client.post(f"/api/business/orgs/{org['id']}/workspace/files/{up['id']}/complete", headers=who.headers)


def send(client, org, ch, who, body="", file_ids=()):
    return client.post(
        f"/api/business/orgs/{org['id']}/workspace/channels/{ch['id']}/messages", json={"body": body, "file_ids": list(file_ids)}, headers=who.headers
    )


def stored() -> list[str]:
    root = video_storage.videos.root
    return [f for _, _, fs in os.walk(root) for f in fs] if os.path.isdir(root) else []


def test_attach_send_and_open(client, person):
    owner, agent = person("owner@example.com"), person("agent@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, agent)
    ch = general(client, org, owner)

    done = upload(client, org, ch, owner)
    assert done.status_code == 200, done.text
    f = done.json()
    assert (f["name"], f["mime"], f["size"]) == ("Title scan.pdf", "application/pdf", len(PDF))

    # A message can be a file alone
    msg = send(client, org, ch, owner, file_ids=[f["id"]])
    assert msg.status_code == 201, msg.text
    assert msg.json()["files"] == [f]
    listed = client.get(f"/api/business/orgs/{org['id']}/workspace/channels/{ch['id']}/messages", headers=agent.headers).json()
    assert listed["messages"][-1]["files"][0]["id"] == f["id"]

    # Anyone in the channel opens it, under its own name
    link = client.get(f"/api/business/orgs/{org['id']}/workspace/files/{f['id']}", headers=agent.headers).json()
    res = client.get(link["url"])
    assert res.content == PDF and "Title scan.pdf" in res.headers["content-disposition"]

    # Sent files can't be sent again, and others' files can't be used
    assert send(client, org, ch, owner, file_ids=[f["id"]]).status_code == 422
    assert send(client, org, ch, owner, body="hi", file_ids=["nope"]).status_code == 422


def test_files_in_a_dm_stay_between_the_two(client, person):
    owner, agent, other = person("owner@example.com"), person("agent@example.com"), person("other@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, agent)
    add_member(client, org, owner, other)
    dm = client.post(f"/api/business/orgs/{org['id']}/workspace/dms", json={"user_id": agent.id}, headers=owner.headers).json()
    f = upload(client, org, dm, owner).json()
    send(client, org, dm, owner, file_ids=[f["id"]])
    assert client.get(f"/api/business/orgs/{org['id']}/workspace/files/{f['id']}", headers=agent.headers).status_code == 200
    assert client.get(f"/api/business/orgs/{org['id']}/workspace/files/{f['id']}", headers=other.headers).status_code == 404


def test_checks_and_caps(client, person, monkeypatch):
    owner, guest = person("owner@example.com"), person("guest@example.com")
    org = make_org(client, owner)
    add_member(client, org, owner, guest, role="guest")
    ch = general(client, org, owner)

    assert start(client, org, ch, guest).status_code == 403
    assert start(client, org, ch, owner, mime="application/x-msdownload", name="a.exe").status_code == 415
    assert start(client, org, ch, owner, size=team_files.MAX_BYTES + 1).status_code == 413
    # A web page named .pdf is refused and removed
    res = upload(client, org, ch, owner, data=b"<html>" + b"x" * 100)
    assert res.status_code == 415 and stored() == []
    # Plain text has no header to check, but binary isn't text
    assert upload(client, org, ch, owner, data=b"Lot 4, block 2\n", name="notes.txt", mime="text/plain").status_code == 200
    assert upload(client, org, ch, owner, data=b"MZ\x00\x00", name="x.txt", mime="text/plain").status_code == 415

    monkeypatch.setattr(team_files, "ORG_CAP", 1000)
    res = start(client, org, ch, owner, size=990)
    assert res.status_code == 422 and "file space" in res.json()["detail"]


def test_deleting_a_message_deletes_its_files_and_unsent_files_are_cleared(client, person):
    owner = person("owner@example.com")
    org = make_org(client, owner)
    ch = general(client, org, owner)
    f = upload(client, org, ch, owner).json()
    msg = send(client, org, ch, owner, body="the title", file_ids=[f["id"]]).json()
    assert len(stored()) == 1
    assert client.delete(f"/api/business/orgs/{org['id']}/workspace/messages/{msg['id']}", headers=owner.headers).status_code == 204
    assert stored() == [] and team_files_repo.get(f["id"]) is None

    # Attached but never sent: removed after a few hours
    g = upload(client, org, ch, owner).json()
    old = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()
    with db.transaction() as c:
        c.execute("UPDATE ws_files SET created_at = ? WHERE id = ?", (old, g["id"]))
    assert team_files_repo.clear_unsent() == 1 and stored() == []
