"""Builds data/places_ph.sqlite, the local places database behind the report's
"What's nearby" card, from Overture Maps Places.

Overture (https://overturemaps.org) merges business listings from Meta,
Microsoft, and others, so it has many branches that OpenStreetMap is missing,
such as most 7-Elevens outside big cities. The data is free under the
CDLA-Permissive-2.0 license; the report credits it.

Run it once, and again when you want fresher data (Overture publishes monthly):

    pip install -r requirements-etl.txt
    python -m etl.build_places                    # latest known release
    python -m etl.build_places 2026-09-23.1       # a specific release

It reads only the Philippine part of the dataset straight from Overture's
public S3 bucket (about a minute), keeps the kinds the card shows, and writes
about 20 MB. The service works without the file; the card then uses
OpenStreetMap alone.
"""

import os
import sqlite3
import sys
import time

import duckdb

DEFAULT_RELEASE = "2026-09-23.1"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "places_ph.sqlite")

# Overture's own confidence that the place exists. Below 0.6, many entries are
# closed or duplicated. Small businesses (car rentals, computer shops) mostly
# come from thin Facebook pages and score lower even when real, so they get 0.4.
MIN_CONFIDENCE = 0.6
SMALL_BUSINESS_CONFIDENCE = 0.4
SMALL_BUSINESS = {"restaurant", "resort", "car_rental", "computer_shop"}

# One SELECT per kind of place the card shows. A place can be in more than one
# kind: a Jollibee is also a restaurant. Columns: name, brand, basic_category,
# taxonomy (Overture's most specific category).
KINDS = {
    "hospital": "basic_category = 'hospital'",
    "school": """basic_category IN ('elementary_school', 'high_school', 'middle_school', 'college_university', 'preschool')
                 OR taxonomy IN ('school', 'public_school', 'private_school', 'religious_school')""",
    "supermarket": """taxonomy IN ('supermarket', 'hypermarket')
                      OR regexp_matches(lower(name), 'supermarket|hypermarket|puregold|savemore|walter ?mart')""",
    "mall": "basic_category IN ('shopping_mall', 'department_store')",
    "seven_eleven": "brand = '7-Eleven' OR regexp_matches(lower(name), '^7[- ]?(eleven|11)\\b')",
    "jollibee": "brand = 'Jollibee' OR regexp_matches(lower(name), '^jollibee\\b')",
    "mcdonalds": "brand = 'McDonald''s' OR regexp_matches(lower(name), '^mc ?donald''?s\\b')",
    "mang_inasal": "regexp_matches(lower(coalesce(brand, '') || ' ' || name), 'mang inasal')",
    "restaurant": """basic_category IN ('restaurant', 'fast_food_restaurant')
                     OR taxonomy = 'diner'
                     OR regexp_matches(lower(name), 'carinderia|karinderya|karenderya|eatery|kainan|lutong bahay')""",
    "resort": "basic_category = 'resort' OR taxonomy IN ('resort', 'beach_resort')",
    "car_rental": """taxonomy = 'car_rental_service'
                     OR (taxonomy = 'rental_service' AND regexp_matches(lower(name), 'car|van|vehicle|rent ?a ?car'))""",
    "computer_shop": """taxonomy IN ('internet_cafe', 'computer_store', 'it_service_and_computer_repair')
                        OR regexp_matches(lower(name), 'computer|internet ?cafe|net ?cafe|pisonet|piso ?net')""",
}


def build(release: str) -> None:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-west-2';")
    t = time.time()
    con.execute(f"""
        CREATE TABLE ph AS
        SELECT id, names.primary AS name, brand.names.primary AS brand, basic_category,
               taxonomy.primary AS taxonomy, bbox.ymin AS lat, bbox.xmin AS lon, confidence,
               addresses[1].freeform AS address
        FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*')
        WHERE bbox.xmin BETWEEN 116.0 AND 127.0 AND bbox.ymin BETWEEN 4.2 AND 21.5
          AND (addresses[1].country = 'PH' OR addresses[1].country IS NULL)
          AND names.primary IS NOT NULL
          AND confidence >= {SMALL_BUSINESS_CONFIDENCE}
          AND coalesce(operating_status, 'open') = 'open'
    """)
    print(f"Read {con.execute('SELECT count(*) FROM ph').fetchone()[0]:,} places in {time.time() - t:.0f}s")

    union = " UNION ALL ".join(
        f"SELECT '{kind}' AS kind, id, name, lat, lon, address, confidence FROM ph "
        f"WHERE ({where}) AND confidence >= {SMALL_BUSINESS_CONFIDENCE if kind in SMALL_BUSINESS else MIN_CONFIDENCE}"
        for kind, where in KINDS.items()
    )
    rows = con.execute(union).fetchall()

    tmp = OUT + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript("""
        CREATE TABLE places (kind TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL,
                             lon REAL NOT NULL, address TEXT, confidence REAL, PRIMARY KEY (kind, id));
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    """)
    db.executemany("INSERT OR IGNORE INTO places VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    db.execute("CREATE INDEX places_near ON places (kind, lat, lon)")
    db.executemany("INSERT INTO meta VALUES (?, ?)", [("source", "Overture Maps Places"), ("release", release), ("license", "CDLA-Permissive-2.0")])
    db.commit()
    for kind, n in db.execute("SELECT kind, count(*) FROM places GROUP BY kind ORDER BY 2 DESC"):
        print(f"  {kind:14} {n:>7,}")
    db.execute("VACUUM")
    db.close()
    os.replace(tmp, OUT)
    print(f"Wrote {os.path.abspath(OUT)} ({os.path.getsize(OUT) / 1e6:.0f} MB) in {time.time() - t:.0f}s")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_RELEASE)
