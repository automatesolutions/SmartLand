"""LiveKit, which carries huddle and live tour audio and video.

Three jobs, all with the project's API key and secret (never sent to browsers):
- join passes: short JWTs that let one person into one room
- the server API (Twirp over HTTPS), to end a room
- checking that a webhook really came from LiveKit

Set LIVEKIT_URL (wss://...livekit.cloud), LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.
Without all three, calls stay off and make() returns None.
"""

import base64
import hashlib
import os
import time

import httpx
import jwt
from loguru import logger

KEYS = ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")


class LiveKit:
    def __init__(self, url: str, api_key: str, api_secret: str):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.api_secret = api_secret
        self.http_url = self.url.replace("wss://", "https://", 1).replace("ws://", "http://", 1)

    def _sign(self, claims: dict, seconds: int) -> str:
        now = int(time.time())
        return jwt.encode({"iss": self.api_key, "nbf": now - 10, "exp": now + seconds, **claims}, self.api_secret, algorithm="HS256")

    def join_pass(
        self,
        room: str,
        identity: str,
        name: str,
        *,
        max_people: int,
        seconds: int = 600,
        can_share_screen: bool = True,
    ) -> str:
        """Lets `identity` into `room` for `seconds` (the time to join, not the call length).
        The room is made on first join with at most `max_people`, and closes 2 minutes after it empties."""
        sources = ["camera", "microphone"] + (["screen_share", "screen_share_audio"] if can_share_screen else [])
        return self._sign(
            {
                "sub": identity,
                "name": name,
                "video": {
                    "room": room,
                    "roomJoin": True,
                    "canPublish": True,
                    "canSubscribe": True,
                    "canPublishData": False,
                    "canPublishSources": sources,
                },
                "roomConfig": {"name": room, "maxParticipants": max_people, "emptyTimeout": 120, "departureTimeout": 30},
            },
            seconds,
        )

    def _call(self, method: str, body: dict, grant: dict) -> dict:
        token = self._sign({"video": grant}, 60)
        res = httpx.post(
            f"{self.http_url}/twirp/livekit.RoomService/{method}",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        res.raise_for_status()
        return res.json()

    def end_room(self, room: str) -> bool:
        """Disconnects everyone. A room that's already gone counts as ended."""
        try:
            self._call("DeleteRoom", {"room": room}, {"roomCreate": True})
            return True
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return True
            logger.warning(f"LiveKit couldn't end room {room}: {e.response.status_code}")
        except httpx.HTTPError as e:
            logger.warning(f"LiveKit couldn't end room {room}: {e}")
        return False

    def people_in(self, room: str) -> set[str] | None:
        """Identities in the room now, or None if LiveKit couldn't be asked"""
        try:
            res = self._call("ListParticipants", {"room": room}, {"roomAdmin": True, "room": room})
            return {p["identity"] for p in res.get("participants", [])}
        except httpx.HTTPStatusError as e:
            return set() if e.response.status_code == 404 else None
        except httpx.HTTPError:
            return None

    def verify_webhook(self, body: bytes, authorization: str | None) -> bool:
        """LiveKit signs each webhook with a JWT whose sha256 claim is the body's hash"""
        if not authorization:
            return False
        token = authorization[7:] if authorization.lower().startswith("bearer ") else authorization
        try:
            claims = jwt.decode(token, self.api_secret, algorithms=["HS256"], options={"verify_aud": False}, leeway=60)
        except jwt.PyJWTError:
            return False
        digest = hashlib.sha256(body).digest()
        expected = {base64.b64encode(digest).decode(), base64.urlsafe_b64encode(digest).decode().rstrip("=")}
        return claims.get("iss") == self.api_key and claims.get("sha256") in expected


def make() -> LiveKit | None:
    values = {k: os.getenv(k, "").strip() for k in KEYS}
    missing = [k for k, v in values.items() if not v]
    if missing:
        if len(missing) < len(KEYS):
            logger.warning(f"Huddles and live tours are off. Missing: {', '.join(missing)}")
        return None
    return LiveKit(values["LIVEKIT_URL"], values["LIVEKIT_API_KEY"], values["LIVEKIT_API_SECRET"])
