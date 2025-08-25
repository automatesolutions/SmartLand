import os
import sys
import psycopg2
from loguru import logger

DB_NAME = os.getenv("PG_DB", "SmartGeo")
DB_USER = os.getenv("PG_USER", "postgres")
DB_PASS = os.getenv("PG_PASS", "SuMoKiKaOu1!")
DB_HOST = os.getenv("PG_HOST", "database-1.clgk84u0u6tg.ap-southeast-1.rds.amazonaws.com")
DB_PORT = os.getenv("PG_PORT", "5432")

MINDANAO_BBOX = (124.0, 4.0, 128.0, 10.0)  # lon_min, lat_min, lon_max, lat_max (EPSG:4326)

FLOOD_TABLE_SRC = os.getenv("FLOOD_TABLE_SRC", "ph.flood25")  # depth raster (meters)
LOW_DEPTH_THRESHOLD = float(os.getenv("LOW_DEPTH_THRESHOLD", "5"))  # metres


def pg_conn_str() -> str:
    return f"host={DB_HOST} port={DB_PORT} dbname={DB_NAME} user={DB_USER} password={DB_PASS}"


DDL_STATEMENTS = f"""
CREATE SCHEMA IF NOT EXISTS ph;

-- 1) Bounding box view for Mindanao
CREATE OR REPLACE VIEW ph.mindanao_bbox AS SELECT 'SRID=4326;POLYGON((124 4,128 4,128 10,124 10,124 4))'::public.geometry AS geom;

-- 2) Clip source flood raster to Mindanao (materialized view for performance)
DROP MATERIALIZED VIEW IF EXISTS ph.flood_mindanao CASCADE;
CREATE MATERIALIZED VIEW ph.flood_mindanao AS
SELECT rid, filename,
       ST_Clip(rast, bbox.geom) AS rast
FROM   {FLOOD_TABLE_SRC}, ph.mindanao_bbox AS bbox
WHERE  ST_Intersects(rast, bbox.geom);

CREATE INDEX IF NOT EXISTS flood_mindanao_gix
ON   ph.flood_mindanao USING GIST (ST_ConvexHull(rast));

-- 3) Reclass <= {LOW_DEPTH_THRESHOLD} m into binary mask and polygonise
DROP MATERIALIZED VIEW IF EXISTS ph.mindanao_low_flood CASCADE;
CREATE MATERIALIZED VIEW ph.mindanao_low_flood AS
SELECT (ST_DumpAsPolygons(
          ST_Reclass(
            rast,
            1,
            '0-{LOW_DEPTH_THRESHOLD}:1;{LOW_DEPTH_THRESHOLD}-10000:0',
            '32BF',
            0
          )
       )).geom
FROM ph.flood_mindanao;

-- Remove specks < 5 000 m²
DROP MATERIALIZED VIEW IF EXISTS ph.mindanao_low_flood_clean CASCADE;
CREATE MATERIALIZED VIEW ph.mindanao_low_flood_clean AS
SELECT geom
FROM   ph.mindanao_low_flood
WHERE  ST_Area(geom::geography) > 5000;
"""


def main() -> None:
    logger.info("Connecting to PostGIS …")
    with psycopg2.connect(pg_conn_str()) as conn:
        conn.autocommit = True  # run DDL outside transactions for materialised views
        with conn.cursor() as cur:
            # Ensure PostGIS objects are visible even if role search_path omits public
            cur.execute("SET search_path = public, pg_catalog;")

            logger.info("Creating views and materialized views …")
            cur.execute(DDL_STATEMENTS)
            logger.success("Mindanao flood layers created successfully ✔")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.error(f"Setup failed: {exc}")
        sys.exit(1)
