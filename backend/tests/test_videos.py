"""Listing videos: the upload in three steps, the caps that keep R2 free, who may
remove a video, and cleanup. Files go to a local folder; nothing calls Cloudflare."""

import os
from urllib.parse import parse_qs, urlparse

import pytest

import db
import deps
import video_storage
import videos
from tests.conftest import add_member, make_org
from tests.test_crm import personal, post_listing

MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2000
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 2000


def start(client, listing, who, size=len(MP4), mime="video/mp4", duration_s=42):
    return client.post(f"/api/listings/{listing['id']}/videos", json={"mime": mime, "size": size, "duration_s": duration_s}, headers=who.headers)


def upload(client, listing, who, data=MP4, mime="video/mp4"):
    """All three steps. Returns the finished video."""
    res = start(client, listing, who, len(data), mime)
    assert res.status_code == 201, res.text
    up = res.json()
    assert client.put(up["upload"]["url"], content=data, headers=up["upload"]["headers"]).status_code == 200
    res = client.post(f"/api/listings/{listing['id']}/videos/{up['id']}/complete", headers=who.headers)
    assert res.status_code == 200, res.text
    return res.json()


def listing_view(client, listing, who=None):
    return client.get(f"/api/listings/{listing['id']}", headers=who.headers if who else {}).json()


def files_on_disk():
    root = video_storage.videos.root
    return [f for _, _, fs in os.walk(root) for f in fs] if os.path.isdir(root) else []


@pytest.fixture(autouse=True)
def fresh_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(video_storage, "videos", video_storage.LocalVideos(str(tmp_path / "videos")))


def test_upload_check_and_play(client, person):
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    video = upload(client, listing, seller)
    assert (video["mime"], video["size"], video["duration_s"]) == ("video/mp4", len(MP4), 42)

    # Anyone sees it on the listing, with a link that plays and seeks
    [shown] = listing_view(client, listing)["videos"]
    assert shown["id"] == video["id"]
    res = client.get(shown["url"])
    assert (res.status_code, res.content, res.headers["content-type"]) == (200, MP4, "video/mp4")
    part = client.get(shown["url"], headers={"Range": "bytes=0-7"})
    assert (part.status_code, part.content) == (206, MP4[:8])

    mine = listing_view(client, listing, seller)
    assert mine["can_remove_videos"] is True
    assert mine["video_space_left_mb"] == 1023
    assert listing_view(client, listing)["can_remove_videos"] is False
    assert "video_space_left_mb" not in listing_view(client, listing)
    # A WebM recording from Chrome works too
    upload(client, listing, seller, WEBM, "video/webm;codecs=vp9,opus")


def test_caps_are_checked_before_anything_is_stored(client, person, monkeypatch):
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    assert start(client, listing, seller, size=101 * 1024 * 1024).status_code == 413
    assert start(client, listing, seller, mime="video/x-msvideo").status_code == 415
    assert start(client, listing, seller, duration_s=181).status_code == 422
    for _ in range(3):
        upload(client, listing, seller)
    res = start(client, listing, seller)
    assert res.status_code == 422 and "up to 3 videos" in res.json()["detail"]

    # Per person, counting every listing
    other = post_listing(client, seller)
    monkeypatch.setattr(videos, "USER_CAP", 4 * len(MP4))
    res = start(client, other, seller, size=2 * len(MP4))
    assert res.status_code == 422 and "video space left" in res.json()["detail"]
    # The whole site
    monkeypatch.setattr(videos, "USER_CAP", 10**9)
    monkeypatch.setattr(videos, "SITE_CAP", 4 * len(MP4))
    res = start(client, other, seller, size=2 * len(MP4))
    assert res.status_code == 422 and "video space is full" in res.json()["detail"]
    with db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM listing_videos").fetchone()[0] == 3


def test_the_finished_file_is_checked(client, person):
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    done = lambda vid: client.post(f"/api/listings/{listing['id']}/videos/{vid}/complete", headers=seller.headers)  # noqa: E731

    # Never uploaded
    up = start(client, listing, seller).json()
    assert done(up["id"]).status_code == 422
    assert listing_view(client, listing)["videos"] == []

    # Not a video: refused and deleted
    up = start(client, listing, seller).json()
    page = b"<html>" + b"x" * (len(MP4) - 6)
    client.put(up["upload"]["url"], content=page, headers=up["upload"]["headers"])
    assert done(up["id"]).status_code == 415
    assert files_on_disk() == []

    # Bigger than it said: the upload itself stops
    up = start(client, listing, seller, size=100).json()
    assert client.put(up["upload"]["url"], content=MP4, headers=up["upload"]["headers"]).status_code == 413
    assert files_on_disk() == []

    # A different type than the link was made for
    up = start(client, listing, seller).json()
    assert client.put(up["upload"]["url"], content=MP4, headers={"Content-Type": "video/webm"}).status_code == 403


def test_links_only_do_their_one_job(client, person):
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    up = start(client, listing, seller).json()
    token = parse_qs(urlparse(up["upload"]["url"]).query)["t"][0]
    # An upload link doesn't play, and a sign-in token isn't a video link
    assert client.get(f"/api/videos/file?t={token}").status_code == 403
    sign_in = seller.headers["Authorization"][7:]
    assert client.put(f"/api/videos/upload?t={sign_in}", content=MP4, headers={"Content-Type": "video/mp4"}).status_code == 403


def test_who_can_remove_a_video(client, person, monkeypatch):
    owner, agent, buyer, reviewer = (person(f"{n}@example.com") for n in ("owner", "agent", "buyer", "reviewer"))
    org = make_org(client, owner)
    add_member(client, org, owner, agent)
    listing = post_listing(client, agent, org)
    remove = lambda vid, who: client.delete(f"/api/listings/{listing['id']}/videos/{vid}", headers=who.headers)  # noqa: E731

    first, second, third = (upload(client, listing, agent) for _ in range(3))
    assert remove(first["id"], buyer).status_code == 404
    assert start(client, listing, buyer).status_code == 404
    # The business owner manages the team's listings
    assert remove(first["id"], owner).status_code == 204
    # A SmartLand reviewer takes down what breaks the rules
    monkeypatch.setattr(deps, "ADMIN_EMAILS", {"reviewer@example.com"})
    assert listing_view(client, listing, reviewer)["can_remove_videos"] is True
    assert remove(second["id"], reviewer).status_code == 204
    assert [v["id"] for v in listing_view(client, listing)["videos"]] == [third["id"]]
    assert len(files_on_disk()) == 1


def test_removing_a_listing_removes_its_videos(client, person):
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    upload(client, listing, seller)
    start(client, listing, seller)
    assert client.delete(f"/api/listings/{listing['id']}", headers=seller.headers).status_code == 204
    assert files_on_disk() == []
    with db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM listing_videos").fetchone()[0] == 0


def test_unfinished_uploads_are_cleared(client, person):
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    up = start(client, listing, seller).json()
    client.put(up["upload"]["url"], content=MP4, headers=up["upload"]["headers"])
    assert videos.clear_stale() == 0
    with db.transaction() as c:
        c.execute("UPDATE listing_videos SET created_at = '2020-01-01T00:00:00+00:00'")
    assert videos.clear_stale() == 1
    assert files_on_disk() == []


def test_off_until_turned_on(client, person, monkeypatch):
    monkeypatch.setattr(video_storage, "videos", None)
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    assert client.get("/api/listings/schema").json()["video"]["enabled"] is False
    assert start(client, listing, seller).status_code == 503
    assert listing_view(client, listing)["videos"] == []


def test_r2_links_are_signed_here_without_calling_cloudflare():
    r2 = video_storage.R2Videos("0123abcd" * 4, "test-access-key", "test-secret-key", "smartland-videos")
    up = urlparse(r2.upload_link("listings/a/b.mp4", "video/mp4", 100)["url"])
    assert up.hostname == f"{'0123abcd' * 4}.r2.cloudflarestorage.com"
    assert up.path == "/smartland-videos/listings/a/b.mp4"
    q = parse_qs(up.query)
    assert q["X-Amz-Expires"] == ["3600"] and "content-type" in q["X-Amz-SignedHeaders"][0]
    play = parse_qs(urlparse(r2.play_link("listings/a/b.mp4", "video/mp4")).query)
    assert play["response-content-type"] == ["video/mp4"] and "X-Amz-Signature" in play


def test_business_page_counts_videos_per_listing(client, person):
    seller = person("seller@example.com")
    listing = post_listing(client, seller)
    upload(client, listing, seller)
    upload(client, listing, seller)
    # Started but never finished: not counted
    start(client, listing, seller)

    mine = personal(client, seller)
    res = client.get(f"/api/business/orgs/{mine['id']}/performance", params={"days": 7}, headers=seller.headers)
    [row] = res.json()["listings"]
    assert (row["id"], row["videos"], row["cover_url"]) == (listing["id"], 2, None)
