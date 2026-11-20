"""Where uploaded files live: a folder on disk, or a Cloud Storage bucket.

Files are named by their SHA-256, so the same file uploaded twice is stored once.

- Local (default): files go in UPLOAD_DIR, which defaults to an `uploads`
  folder next to the database.
- Cloud Storage: set STORAGE_BUCKET to a bucket name. Files survive deploys and
  restarts, which a Cloud Run container's own disk doesn't. Needs the
  google-cloud-storage package and an account that can read and write the bucket.
"""

import os

from loguru import logger

import store


class LocalStorage:
    def __init__(self, root: str):
        self.root = root

    def _path(self, name: str) -> str:
        path = os.path.abspath(os.path.join(self.root, name))
        if not path.startswith(os.path.abspath(self.root) + os.sep):
            raise ValueError("File name points outside the upload folder")
        return path

    def put(self, name: str, data: bytes, content_type: str) -> None:
        path = self._path(name)
        if os.path.exists(path):
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)

    def read(self, name: str) -> bytes | None:
        path = self._path(name)
        if not os.path.exists(path):
            return None
        with open(path, "rb") as fh:
            return fh.read()

    def describe(self) -> str:
        return f"folder {self.root}"


class BucketStorage:
    def __init__(self, bucket: str, prefix: str = ""):
        # Imported here so local runs don't need the package installed
        from google.cloud import storage as gcs

        self.bucket = gcs.Client().bucket(bucket)
        self.prefix = prefix.strip("/")
        self.name = bucket

    def _key(self, name: str) -> str:
        return f"{self.prefix}/{name}" if self.prefix else name

    def put(self, name: str, data: bytes, content_type: str) -> None:
        blob = self.bucket.blob(self._key(name))
        if blob.exists():
            return
        blob.upload_from_string(data, content_type=content_type)

    def read(self, name: str) -> bytes | None:
        from google.api_core.exceptions import NotFound

        try:
            return self.bucket.blob(self._key(name)).download_as_bytes()
        except NotFound:
            return None

    def describe(self) -> str:
        return f"bucket gs://{self.name}/{self.prefix}"


def _make():
    bucket = os.getenv("STORAGE_BUCKET", "").strip()
    if bucket:
        return BucketStorage(bucket, os.getenv("STORAGE_PREFIX", "uploads"))
    root = os.getenv("UPLOAD_DIR") or os.path.join(os.path.dirname(os.path.abspath(store.DATABASE_PATH)), "uploads")
    return LocalStorage(root)


files = _make()
logger.info(f"Uploaded files are kept in the {files.describe()}")
