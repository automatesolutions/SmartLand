"""Files in team chat: PDFs, photos, and office documents, private to the business.

Same three steps as listing videos (videos.py): ask for an upload link, upload straight to
storage, then say it's done so we check the size and the first bytes. Then send a message
with the file's id. Each download link is signed and lasts an hour.

Caps: 20 MB a file, 1 GB per business (TEAM_FILES_ORG_CAP_MB), and the site-wide stop
that listing videos use, since both share the free 10 GB of R2.
"""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import team_files_repo as repo
import video_storage
import videos
import videos_repo
from deps import authenticate, limiter
from workspace import _channel, _org

router = APIRouter()

MB = 1024 * 1024
MAX_BYTES = 20 * MB
ORG_CAP = int(os.getenv("TEAM_FILES_ORG_CAP_MB", "1024")) * MB

# Type, extension, and how its first bytes start (None: plain text, nothing to check)
TYPES: dict[str, tuple[str, tuple[bytes, ...] | None]] = {
    "application/pdf": ("pdf", (b"%PDF",)),
    "image/jpeg": ("jpg", (b"\xff\xd8\xff",)),
    "image/png": ("png", (b"\x89PNG",)),
    "image/webp": ("webp", (b"RIFF",)),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("docx", (b"PK\x03\x04",)),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ("xlsx", (b"PK\x03\x04",)),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ("pptx", (b"PK\x03\x04",)),
    "application/msword": ("doc", (b"\xd0\xcf\x11\xe0",)),
    "application/vnd.ms-excel": ("xls", (b"\xd0\xcf\x11\xe0",)),
    "application/vnd.ms-powerpoint": ("ppt", (b"\xd0\xcf\x11\xe0",)),
    "text/plain": ("txt", None),
    "text/csv": ("csv", None),
}
KINDS = "PDFs, photos, Word, Excel, PowerPoint, and text files"
GONE = "File not found"


def config() -> dict:
    return {"enabled": video_storage.videos is not None, "max_mb": MAX_BYTES // MB, "types": list(TYPES)}


def _storage():
    if video_storage.videos is None:
        raise HTTPException(status_code=503, detail="Files aren't turned on yet.")
    return video_storage.videos


def _looks_like(head: bytes, mime: str) -> bool:
    starts = TYPES[mime][1]
    if starts is None:
        return b"\x00" not in head
    if mime == "image/webp":
        return head.startswith(b"RIFF") and head[8:12] == b"WEBP"
    return any(head.startswith(s) for s in starts)


class FileIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    mime: str = Field(max_length=120)
    size: int = Field(gt=0)


@router.get("/api/business/workspace/files/config")
def files_config(user: dict = Depends(authenticate)):
    return config()


@router.post("/api/business/orgs/{org_id}/workspace/channels/{channel_id}/files", status_code=201)
@limiter.limit("60/hour")
def start_file(request: Request, org_id: str, channel_id: str, body: FileIn, user: dict = Depends(authenticate)):
    vs = _storage()
    _org(user, org_id, "workspace.post")
    ch = _channel(user, org_id, channel_id)
    if ch["archived_at"]:
        raise HTTPException(status_code=409, detail="This channel is archived.")
    repo.clear_unsent()
    mime = body.mime.split(";")[0].strip().lower()
    if mime not in TYPES:
        raise HTTPException(status_code=415, detail=f"You can attach {KINDS}.")
    if body.size > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Files can be up to {MAX_BYTES // MB} MB. This one is {-(-body.size // MB)} MB.")
    if repo.bytes_used(org_id) + body.size > ORG_CAP:
        raise HTTPException(status_code=422, detail=f"Your business has used its {ORG_CAP // MB} MB of file space. Delete old messages with files to make room.")
    if videos_repo.bytes_used() + body.size > videos.SITE_CAP:
        raise HTTPException(status_code=422, detail="SmartLand's file space is full right now. Try again later.")
    name = " ".join(body.name.replace("/", "_").replace("\\", "_").split())[:200]
    f = repo.add(org_id, channel_id, user["id"], name, mime, TYPES[mime][0], body.size)
    return {"id": f["id"], "upload": {"method": "PUT", **vs.upload_link(f["object_key"], mime, body.size)}}


def _mine(user: dict, org_id: str, file_id: str) -> dict:
    f = repo.get(file_id)
    if f is None or f["org_id"] != org_id or f["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail=GONE)
    return f


@router.post("/api/business/orgs/{org_id}/workspace/files/{file_id}/complete")
def finish_file(org_id: str, file_id: str, user: dict = Depends(authenticate)):
    vs = _storage()
    _org(user, org_id, "workspace.post")
    f = _mine(user, org_id, file_id)
    if f["status"] == "ready":
        return repo.view(f)
    size = vs.size(f["object_key"])
    if size is None:
        repo.drop(f)
        raise HTTPException(status_code=422, detail="We didn't get the file. Attach it again.")
    if size > f["size"] or size > MAX_BYTES:
        repo.drop(f)
        raise HTTPException(status_code=413, detail="This file is larger than it said it was.")
    if not _looks_like(vs.head_bytes(f["object_key"], 16), f["mime"]):
        repo.drop(f)
        raise HTTPException(status_code=415, detail=f"This file isn't what its name says. You can attach {KINDS}.")
    return repo.view(repo.mark_ready(file_id, size))


@router.get("/api/business/orgs/{org_id}/workspace/files/{file_id}")
def open_file(org_id: str, file_id: str, user: dict = Depends(authenticate)):
    """A link to the file that lasts an hour, for anyone who can see its channel or DM"""
    vs = _storage()
    _org(user, org_id, "workspace.view")
    f = repo.get(file_id)
    if f is None or f["org_id"] != org_id or f["status"] != "ready" or not f["message_id"]:
        raise HTTPException(status_code=404, detail=GONE)
    _channel(user, org_id, f["channel_id"])
    return {"url": vs.play_link(f["object_key"], f["mime"], filename=f["name"]), "name": f["name"], "mime": f["mime"]}
