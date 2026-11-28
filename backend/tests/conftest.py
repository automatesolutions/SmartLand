"""A fresh database for every test, and helpers to make users and orgs"""

import os
import sys
import tempfile

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
# Before the app is imported: keep uploads and the first database out of the real folders
_scratch = tempfile.mkdtemp(prefix="smartland-tests-")
os.environ["DATABASE_PATH"] = os.path.join(_scratch, "boot.db")
os.environ["UPLOAD_DIR"] = os.path.join(_scratch, "uploads")
os.environ["JWT_SECRET"] = "test-secret-not-for-production"
# Videos on disk, even when this computer has R2 keys set: tests never call Cloudflare
os.environ["VIDEO_STORAGE"] = "local"
# Calls stay off unless a test turns them on with fake keys; nothing calls LiveKit
for _k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
    os.environ.pop(_k, None)

from fastapi.testclient import TestClient  # noqa: E402

import db  # noqa: E402
import deps  # noqa: E402
import main  # noqa: E402
import store  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    db.use(str(tmp_path / "test.db"))
    deps.limiter.enabled = False
    deps.limiter.reset()
    yield
    db.use(str(tmp_path / "closed.db"))


@pytest.fixture
def client():
    # Without `with`, startup doesn't run, so tests never wait on MongoDB or PostGIS
    return TestClient(main.app)


class Person:
    def __init__(self, email: str, verified: bool = False):
        self.user = store.create_user(email, "password123", email.split("@")[0])
        if verified:
            with db.transaction() as c:
                c.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (self.user["id"],))
        self.id = self.user["id"]
        self.email = self.user["email"]
        self.headers = {"Authorization": f"Bearer {deps.issue_token(self.user)}"}


@pytest.fixture
def person():
    return Person


def make_org(client, owner: Person, name: str = "Acme Realty", kind: str = "agency", **extra) -> dict:
    res = client.post("/api/business/orgs", json={"name": name, "kind": kind, **extra}, headers=owner.headers)
    assert res.status_code == 201, res.text
    return res.json()


def add_member(client, org: dict, admin: Person, who: Person, role: str = "member") -> None:
    res = client.post(f"/api/business/orgs/{org['id']}/invites", json={"email": who.email, "role": role}, headers=admin.headers)
    assert res.status_code == 201, res.text
    res = client.post(f"/api/invites/{res.json()['token']}/accept", headers=who.headers)
    assert res.status_code == 200, res.text


LISTING = {
    "category": "farm_lot",
    "title": "Coconut farm near the highway",
    "price": 2_500_000,
    "lot_sqm": 10_000,
    "lat": 13.94,
    "lon": 121.16,
    "place": "Sabang, Lipa, Batangas",
    "seller_type": "owner",
    "contact_name": "Ana Cruz",
    "contact_phone": "0917 555 0100",
    "authorized": True,
    "title_status": "none",
}
