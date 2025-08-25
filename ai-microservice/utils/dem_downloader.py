"""
Download NASA SRTM 1-arc-sec (~30 m) DEM tiles from OpenTopography.

This script is standalone – run it whenever you need fresh elevation tiles.
It drops every downloaded GeoTIFF into ``geodata/rasters/`` so that the
PostGIS ETL script can import them later.

Examples (run from project root, after activating your virtualenv):

    # Download one 2×2-degree tile covering Metro Manila
    python -m utils.dem_downloader --south 14 --north 16 --west 120 --east 122

    # Download a slightly larger bounding box (NCR + Central Luzon)
    python -m utils.dem_downloader --south 14 --north 18 --west 119 --east 123

    # Grab a coarse grid covering the entire Philippines (overnight job)
    python -m utils.dem_downloader --batch-ph

The OpenTopography GlobalDEM API allows requests up to 2°×2°; this script
handles tiling a larger bounding-box into the required 2-degree chunks.
"""
from __future__ import annotations

import argparse
import itertools
import pathlib
import sys
from typing import Tuple

import os
import requests

# Optional: load variables from a local .env so users can store OT_API_KEY there
try:
    from dotenv import load_dotenv

    load_dotenv()
except ModuleNotFoundError:
    # dotenv is optional; if not installed, we simply skip .env loading
    pass

# -----------------------------------------------------------------------------
# Constants & config
# -----------------------------------------------------------------------------
# Where to store downloaded GeoTIFFs relative to repository root
OUT_DIR = pathlib.Path("geodata/rasters")
# OpenTopography requires an API key (free). The GlobalDEM service limits
# each request to a maximum 1°×1° bounding-box. We use demtype=SRTMGL1 (30 m).
OT_API_BASE = (
    "https://portal.opentopography.org/API/globaldem?"
    "demtype=SRTMGL1&south={south}&north={north}&west={west}&east={east}&outputFormat=GTiff&API_Key={api_key}"
)
# Maximum bbox size per request (degrees)
CHUNK_DEG = 1


# -----------------------------------------------------------------------------
# Helper functions
# -----------------------------------------------------------------------------

def download_tile(south: int, north: int, west: int, east: int, api_key: str) -> bool:
    """Request **one** 2°×2° tile and save it under OUT_DIR.

    Returns True on success, False otherwise.
    """
    url = OT_API_BASE.format(south=south, north=north, west=west, east=east, api_key=api_key)
    filename = f"dem30_s{south:02d}n{north:02d}_w{west:03d}e{east:03d}.tif"
    out_path = OUT_DIR / filename
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"→ Downloading {filename} …", end=" ", flush=True)
    try:
        # Large files – stream to disk in chunks
        resp = requests.get(url, stream=True, timeout=600)
        resp.raise_for_status()
        with out_path.open("wb") as fp:
            for chunk in resp.iter_content(chunk_size=1 << 16):  # 64 KiB
                if chunk:
                    fp.write(chunk)
        print("done")
        return True
    except Exception as exc:
        print(f"FAILED ({exc})")
        # Clean up partial file if any
        if out_path.exists():
            out_path.unlink(missing_ok=True)
        return False


def download_bbox(south: int, north: int, west: int, east: int, api_key: str) -> None:
    """Download *all* 2°×2° tiles intersecting the provided bbox."""
    lat_ranges: list[Tuple[int, int]] = [
        (lat, min(lat + CHUNK_DEG, north)) for lat in range(south, north, CHUNK_DEG)
    ]
    lon_ranges: list[Tuple[int, int]] = [
        (lon, min(lon + CHUNK_DEG, east)) for lon in range(west, east, CHUNK_DEG)
    ]

    for (s, n), (w, e) in itertools.product(lat_ranges, lon_ranges):
        download_tile(s, n, w, e, api_key)


# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Download SRTM DEM tiles for the Philippines")
    parser.add_argument("--south", type=int, help="Southern latitude (integer degrees)")
    parser.add_argument("--north", type=int, help="Northern latitude (integer degrees)")
    parser.add_argument("--west", type=int, help="Western longitude (integer degrees)")
    parser.add_argument("--east", type=int, help="Eastern longitude (integer degrees)")
    parser.add_argument(
        "--batch-ph",
        action="store_true",
        help="Download a coarse grid (2° × 2° tiles) covering the entire Philippines",
    )
    parser.add_argument("--api-key", help="OpenTopography API key (optional if OT_API_KEY env var is set)")

    args = parser.parse_args()

    api_key = args.api_key or os.getenv("OT_API_KEY")
    if not api_key:
        parser.error("OpenTopography API key required. Supply via --api-key or OT_API_KEY env var.")

    if args.batch_ph:
        # Approximate full-country extent 4°–20° N, 116°–128° E
        download_bbox(4, 20, 116, 128, api_key)
        return

    if None in (args.south, args.north, args.west, args.east):
        parser.error("Either --batch-ph *or* all bbox coordinates must be provided.")

    if args.south >= args.north or args.west >= args.east:
        parser.error("south < north and west < east must hold.")

    download_bbox(args.south, args.north, args.west, args.east, api_key)


# -----------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("Interrupted by user")
