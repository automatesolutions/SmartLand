"""ETL helper: import GeoTIFF rasters in geodata/rasters/ into PostGIS.

Requires PostGIS command-line utilities (raster2pgsql & psql) available on PATH.
Connection parameters are read from the POSTGRES_URI environment variable,
which should look like:
    postgresql://USER:PASSWORD@HOST:PORT/DBNAME

Usage (from project root, venv optional):
    python -m etl.import_geodata

The script will:
  1. Enable the postgis & postgis_raster extensions if missing.
  2. Create schema "ph" if it doesn’t exist.
  3. Import each GeoTIFF as tiled rasters into table ph.dem30, appending new
     tiles as they appear. Raster constraints & spatial index are created.

Only files that haven’t been imported yet are processed – presence is tested by
looking up the filename column (added via -F flag in raster2pgsql output).
"""
from __future__ import annotations

import os
import pathlib
import shlex
import subprocess
import sys
import tempfile

from loguru import logger

# -----------------------------------------------------------------------------
# Configuration – picks up env vars if present, else falls back to hard-coded
# -----------------------------------------------------------------------------
DB_NAME = os.getenv("PG_DB", "SmartGeo")
DB_USER = os.getenv("PG_USER", "postgres")
DB_PASS = os.getenv("PG_PASS", "SuMoKiKaOu1!")
DB_HOST = os.getenv("PG_HOST", "database-1.clgk84u0u6tg.ap-southeast-1.rds.amazonaws.com")
DB_PORT = os.getenv("PG_PORT", "5432")

RASTER_DIR = pathlib.Path("geodata/rasters")
TABLE_NAME = "ph.dem30"
SRID = "4326"      # WGS-84
TILE_SIZE = "100x100"

# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------
try:
    import psycopg2
    from psycopg2 import errors
except ImportError:
    logger.error("psycopg2 not installed – run `pip install psycopg2-binary`")
    sys.exit(1)


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def pg_conn_str() -> str:
    return f"host={DB_HOST} port={DB_PORT} dbname={DB_NAME} user={DB_USER} password={DB_PASS}"


def ensure_db_setup(cur) -> None:
    logger.info("Ensuring PostGIS extensions and schema exist …")
    cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    cur.execute("CREATE EXTENSION IF NOT EXISTS postgis_raster;")
    cur.execute("CREATE SCHEMA IF NOT EXISTS ph;")


def already_imported(cur, tif: pathlib.Path) -> bool:
    try:
        cur.execute(f"SELECT 1 FROM {TABLE_NAME} WHERE filename = %s LIMIT 1;", (tif.name,))
        return cur.fetchone() is not None
    except errors.UndefinedTable:
        # Table not created yet – nothing imported so far.
        cur.connection.rollback()
        return False


def import_raster(tif: pathlib.Path) -> None:
    logger.info(f"Importing {tif.name} …")

    # Generate SQL using raster2pgsql and capture to temp file
    sql_file = tempfile.NamedTemporaryFile(delete=False, suffix=".sql")
    sql_file.close()

    raster2pgsql_cmd = (
        f"raster2pgsql -s {SRID} -I -C -M -F -t {TILE_SIZE} {shlex.quote(str(tif))} {TABLE_NAME} > {sql_file.name}"
    )
    logger.debug(raster2pgsql_cmd)
    subprocess.check_call(raster2pgsql_cmd, shell=True)

    with psycopg2.connect(pg_conn_str()) as conn, conn.cursor() as cur:
        with open(sql_file.name, "r", encoding="utf-8") as fp:
            sql_content = fp.read()
        cur.execute(sql_content)
        conn.commit()

    pathlib.Path(sql_file.name).unlink(missing_ok=True)


def main() -> None:
    if not RASTER_DIR.exists():
        logger.error("geodata/rasters directory not found – run the downloader first")
        sys.exit(1)

    tifs = sorted(RASTER_DIR.glob("*.tif"))
    if not tifs:
        logger.warning("No GeoTIFFs to import – exiting")
        return

    logger.info("Connecting to PostgreSQL ...")
    with psycopg2.connect(pg_conn_str()) as conn, conn.cursor() as cur:
        ensure_db_setup(cur)

        for tif in tifs:
            if already_imported(cur, tif):
                logger.info(f"Skipping {tif.name} (already in DB)")
                continue
            # Commit after each raster to keep transaction manageable
            conn.commit()
            import_raster(tif)

    logger.success("All rasters processed")


if __name__ == "__main__":
    main()
