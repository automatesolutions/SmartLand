"""Where listing videos live: Cloudflare R2, or a folder on this computer.

Videos never pass through the web app. The phone uploads straight to the
storage with a link that expires, and plays from a link that expires.

VIDEO_STORAGE picks the place:
- "r2": Cloudflare R2. Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY, and R2_BUCKET. R2 has no egress fees, and the first
  10 GB a month are free; videos.py stops uploads before that.
- "local": a `videos` folder next to the other uploads. For development and tests.
- "off": no videos.
Unset means "local" on a developer's computer and "off" on Cloud Run, whose
disk is wiped on every deploy. So R2 is only used when someone turns it on.
"""

import os
import time

import jwt
from loguru import logger

import deps
import store

LINK_SECONDS = 3600


def disposition(filename: str) -> str:
    """Opens in the browser when it can (PDFs, photos), and saves under the original name otherwise"""
    from urllib.parse import quote

    plain = "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "_" for ch in filename)
    return f"inline; filename=\"{plain}\"; filename*=UTF-8''{quote(filename)}"


class LocalVideos:
    """Files on disk, behind short-lived signed links to this app's own routes in videos.py"""

    kind = "local"

    def __init__(self, root: str):
        self.root = root
        # A key of its own, so a video link can never pass for a sign-in token
        self._secret = deps.JWT_SECRET + ":videos"

    def path(self, key: str) -> str:
        path = os.path.abspath(os.path.join(self.root, key))
        if not path.startswith(os.path.abspath(self.root) + os.sep):
            raise ValueError("Video key points outside the video folder")
        return path

    def _token(self, op: str, key: str, mime: str, max_bytes: int = 0, name: str | None = None) -> str:
        claims = {"op": op, "key": key, "mime": mime, "max": max_bytes, "exp": int(time.time()) + LINK_SECONDS}
        if name:
            claims["name"] = name
        return jwt.encode(claims, self._secret, algorithm="HS256")

    def read_token(self, token: str, op: str) -> dict | None:
        try:
            claims = jwt.decode(token, self._secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            return None
        return claims if claims.get("op") == op else None

    def upload_link(self, key: str, mime: str, max_bytes: int) -> dict:
        return {"url": f"/api/videos/upload?t={self._token('put', key, mime, max_bytes)}", "headers": {"Content-Type": mime}}

    def play_link(self, key: str, mime: str, filename: str | None = None) -> str:
        """A link that opens the file. With `filename`, the browser saves it under that name."""
        return f"/api/videos/file?t={self._token('get', key, mime, name=filename)}"

    def size(self, key: str) -> int | None:
        path = self.path(key)
        return os.path.getsize(path) if os.path.exists(path) else None

    def head_bytes(self, key: str, n: int = 16) -> bytes:
        with open(self.path(key), "rb") as fh:
            return fh.read(n)

    def delete(self, key: str) -> None:
        try:
            os.remove(self.path(key))
        except FileNotFoundError:
            pass

    def describe(self) -> str:
        return f"folder {self.root}"


class R2Videos:
    """A Cloudflare R2 bucket, through its S3-compatible API. Making a link is
    signing on this server, with no call to Cloudflare. Checking, reading the
    first bytes of, and deleting a file each make one call."""

    kind = "r2"

    def __init__(self, account_id: str, access_key: str, secret_key: str, bucket: str):
        # Imported here so local runs and tests don't load it
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 2}, connect_timeout=5, read_timeout=20),
        )

    def upload_link(self, key: str, mime: str, max_bytes: int) -> dict:
        # R2 can't cap the size of a signed upload, so videos.py checks the size
        # once the upload finishes and deletes anything over the limit
        url = self.client.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": mime}, ExpiresIn=LINK_SECONDS
        )
        return {"url": url, "headers": {"Content-Type": mime}}

    def play_link(self, key: str, mime: str, filename: str | None = None) -> str:
        params = {"Bucket": self.bucket, "Key": key, "ResponseContentType": mime}
        if filename:
            params["ResponseContentDisposition"] = disposition(filename)
        return self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=LINK_SECONDS)

    def size(self, key: str) -> int | None:
        from botocore.exceptions import ClientError

        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"]
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def head_bytes(self, key: str, n: int = 16) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key, Range=f"bytes=0-{n - 1}")["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def describe(self) -> str:
        return f"R2 bucket {self.bucket}"


R2_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")


def make():
    mode = os.getenv("VIDEO_STORAGE", "").strip().lower()
    if not mode:
        mode = "off" if os.getenv("K_SERVICE") else "local"
    if mode == "r2":
        values = [os.getenv(k, "").strip() for k in R2_KEYS]
        missing = [k for k, v in zip(R2_KEYS, values) if not v]
        if missing:
            # Names only: the values are secret
            logger.warning(f"VIDEO_STORAGE is r2 but {', '.join(missing)} is not set. Videos are off.")
            return None
        return R2Videos(*values)
    if mode == "local":
        uploads = os.getenv("UPLOAD_DIR") or os.path.join(os.path.dirname(os.path.abspath(store.DATABASE_PATH)), "uploads")
        return LocalVideos(os.path.join(uploads, "videos"))
    return None


videos = make()
logger.info(f"Listing videos are kept in the {videos.describe()}" if videos else "Listing videos are off")
