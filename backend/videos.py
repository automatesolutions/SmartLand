"""Walkthrough videos on listings. See docs/business-suite.md, section 4.

1. The seller's phone asks for an upload link (POST .../videos). The caps are
   checked here, before anything is stored.
2. The phone uploads the file straight to storage with that link.
3. The phone says it's done (POST .../videos/{id}/complete). We check the size
   and that it's really a video, then show it on the listing.

Caps keep R2 inside its free 10 GB: 100 MB and 3 minutes per video, 3 videos per
listing, 1 GB per person, and no new uploads once the site holds 9 GB.
"""

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel, Field

import permissions
import store
import video_storage
import videos_repo
from deps import authenticate, is_admin, limiter

router = APIRouter()

MB = 1024 * 1024
MAX_BYTES = 100 * MB
MAX_SECONDS = 180
MAX_PER_LISTING = 3
USER_CAP = int(os.getenv("VIDEO_USER_CAP_MB", "1024")) * MB
SITE_CAP = int(os.getenv("VIDEO_SITE_CAP_MB", "9216")) * MB

TYPES = {"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"}

OFF = "Videos aren't turned on yet."
GONE = "Video not found"


def config() -> dict:
    """The limits, for the listing schema the app loads"""
    return {
        "enabled": video_storage.videos is not None,
        "max_mb": MAX_BYTES // MB,
        "max_seconds": MAX_SECONDS,
        "max_per_listing": MAX_PER_LISTING,
        "types": list(TYPES),
    }


def _storage():
    if video_storage.videos is None:
        raise HTTPException(status_code=503, detail=OFF)
    return video_storage.videos


def _base(mime: str) -> str:
    return mime.split(";")[0].strip().lower()


def _looks_like(head: bytes, mime: str) -> bool:
    """The first bytes of the file match the type it claimed"""
    if mime == "video/webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    # MP4 and QuickTime files are made of boxes; the first is almost always ftyp
    return head[4:8] in (b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip")


def _drop(video: dict) -> None:
    """Deletes the file, then the row. A failed delete is logged and the row kept, so cleanup can retry."""
    vs = video_storage.videos
    if vs is not None:
        try:
            vs.delete(video["object_key"])
        except Exception as e:
            logger.warning(f"Couldn't delete video {video['id']}: {e}")
            return
    videos_repo.remove(video["id"])


def clear_stale() -> int:
    """Uploads that started hours ago and never finished"""
    stale = videos_repo.stale_pending()
    for v in stale:
        _drop(v)
    return len(stale)


def remove_for_listing(listing_id: str) -> None:
    for v in videos_repo.for_listing(listing_id, ready_only=False):
        _drop(v)


def view(video: dict) -> dict:
    vs = video_storage.videos
    return {
        "id": video["id"],
        "url": vs.play_link(video["object_key"], video["mime"]) if vs else None,
        "mime": video["mime"],
        "size": video["size"],
        "duration_s": video["duration_s"],
        "created_at": video["created_at"],
    }


def views(listing_id: str) -> list[dict]:
    if video_storage.videos is None:
        return []
    return [view(v) for v in videos_repo.for_listing(listing_id)]


def space_left_mb(user_id: str) -> int:
    return max(0, USER_CAP - videos_repo.bytes_used(user_id)) // MB


class VideoIn(BaseModel):
    mime: str = Field(max_length=100)
    size: int = Field(gt=0)
    # The phone reads it from the file. Missing when the browser can't tell.
    duration_s: int | None = Field(default=None, gt=0)


def _editable(user: dict, listing_id: str) -> dict:
    poster = store.listing_poster(listing_id)
    if not permissions.can_edit_listing(user, poster):
        raise HTTPException(status_code=404, detail="Listing not found")
    return poster


@router.post("/api/listings/{listing_id}/videos", status_code=201)
@limiter.limit("20/hour")
def start_upload(request: Request, listing_id: str, body: VideoIn, user: dict = Depends(authenticate)):
    """Checks the caps and hands out a link that uploads one video, for an hour"""
    vs = _storage()
    _editable(user, listing_id)
    clear_stale()
    mime = _base(body.mime)
    if mime not in TYPES:
        raise HTTPException(status_code=415, detail="Upload an MP4, WebM, or MOV video.")
    if body.size > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"This video is over {MAX_BYTES // MB} MB. Trim it on your phone, or record it in SmartLand, which keeps videos small.",
        )
    if body.duration_s is not None and body.duration_s > MAX_SECONDS:
        raise HTTPException(status_code=422, detail=f"Videos can be up to {MAX_SECONDS // 60} minutes. Trim it on your phone, then try again.")
    if videos_repo.count_for_listing(listing_id) >= MAX_PER_LISTING:
        raise HTTPException(status_code=422, detail=f"A listing can have up to {MAX_PER_LISTING} videos. Remove one to add another.")
    if videos_repo.bytes_used(user["id"]) + body.size > USER_CAP:
        raise HTTPException(
            status_code=422,
            detail=f"You have {space_left_mb(user['id'])} MB of video space left, and this video is {-(-body.size // MB)} MB. Remove a video to make room.",
        )
    if videos_repo.bytes_used() + body.size > SITE_CAP:
        logger.warning("Video uploads stopped: the site reached its video storage cap")
        raise HTTPException(status_code=422, detail="SmartLand's video space is full right now. Try again later, or add photos instead.")
    video = videos_repo.add(listing_id, user["id"], TYPES[mime], mime, body.size, body.duration_s)
    link = vs.upload_link(video["object_key"], mime, body.size)
    return {"id": video["id"], "upload": {"method": "PUT", **link}}


@router.post("/api/listings/{listing_id}/videos/{video_id}/complete")
def finish_upload(listing_id: str, video_id: str, user: dict = Depends(authenticate)):
    """Checks the uploaded file and puts the video on the listing"""
    vs = _storage()
    _editable(user, listing_id)
    video = videos_repo.get(video_id)
    if video is None or video["listing_id"] != listing_id:
        raise HTTPException(status_code=404, detail=GONE)
    if video["status"] == "ready":
        return view(video)
    size = vs.size(video["object_key"])
    if size is None:
        videos_repo.remove(video_id)
        raise HTTPException(status_code=422, detail="We didn't get the video. Upload it again.")
    # Never more than it asked for: that's what the caps counted
    if size > video["size"] or size > MAX_BYTES:
        _drop(video)
        raise HTTPException(status_code=413, detail=f"This video is larger than it said it was. Videos can be up to {MAX_BYTES // MB} MB.")
    if not _looks_like(vs.head_bytes(video["object_key"]), video["mime"]):
        _drop(video)
        raise HTTPException(status_code=415, detail="This file isn't a video we can play. Upload an MP4, WebM, or MOV video.")
    return view(videos_repo.mark_ready(video_id, size))


@router.delete("/api/listings/{listing_id}/videos/{video_id}", status_code=204)
def delete_video(listing_id: str, video_id: str, user: dict = Depends(authenticate)):
    """The seller, their business's owner and admins, and SmartLand reviewers can remove a video"""
    video = videos_repo.get(video_id)
    allowed = permissions.can_edit_listing(user, store.listing_poster(listing_id)) or is_admin(user)
    if video is None or video["listing_id"] != listing_id or not allowed:
        raise HTTPException(status_code=404, detail=GONE)
    _drop(video)
    if is_admin(user) and not permissions.can_edit_listing(user, store.listing_poster(listing_id)):
        logger.info(f"Video {video_id} on listing {listing_id} removed by reviewer {user['email']}")
    return Response(status_code=204)


# Local storage only: the routes the signed links point to -------------------

def _local() -> video_storage.LocalVideos:
    vs = video_storage.videos
    if not isinstance(vs, video_storage.LocalVideos):
        raise HTTPException(status_code=404, detail=GONE)
    return vs


@router.put("/api/videos/upload")
async def local_upload(request: Request, t: str):
    vs = _local()
    claims = vs.read_token(t, "put")
    # Like R2, a link that expired or a different file type is refused
    if claims is None or _base(request.headers.get("content-type", "")) != claims["mime"]:
        raise HTTPException(status_code=403, detail="This upload link expired. Start the upload again.")
    path = vs.path(claims["key"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = path + ".part"
    total = 0
    try:
        with open(part, "wb") as fh:
            async for chunk in request.stream():
                total += len(chunk)
                if total > claims["max"]:
                    raise HTTPException(status_code=413, detail="This video is larger than it said it was.")
                fh.write(chunk)
        os.replace(part, path)
    finally:
        if os.path.exists(part):
            os.remove(part)
    return Response(status_code=200)


@router.get("/api/videos/file")
def local_file(t: str):
    vs = _local()
    claims = vs.read_token(t, "get")
    if claims is None:
        raise HTTPException(status_code=403, detail="This video link expired. Reload the page.")
    path = vs.path(claims["key"])
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=GONE)
    # FileResponse answers range requests, so the player can seek
    return FileResponse(path, media_type=claims["mime"], headers={"Cache-Control": "private, max-age=3000"})
