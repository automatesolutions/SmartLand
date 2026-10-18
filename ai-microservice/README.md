# SmartLand AI service

This FastAPI service finds a place in the Philippines, measures what's around it, and estimates the land price per sqm, a growth score, and an investment grade. It runs on port 8002. The backend (`../backend`) is its only caller.

## Run it

```bash
cd ai-microservice
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt   # macOS or Linux: venv/bin/python
venv/Scripts/python -m uvicorn main:app --port 8002
```

The service needs internet access for the public APIs below. It has no models to train or download.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/locate?q=Sabang, Lipa` | Finds the place and fills in all eight scoring factors, with the source of each |
| GET | `/locate?lat=13.94&lon=121.16` | The same for a spot pinned on the map. The place keeps the pinned coordinates and is named with a Nominatim reverse lookup |
| POST | `/predict` | Scores price and growth from the factors and the coordinates |
| GET | `/offices?town=Lipa&province=Batangas&lat=13.94&lon=121.16` | Finds the city or municipal hall, BIR office, and Registry of Deeds near a lot with Nominatim. Results, including misses, are cached for 7 days |
| GET | `/nearby?lat=13.94&lon=121.16` | Lists hospitals, schools, supermarkets, malls, 7-Eleven, carinderias and restaurants, Jollibee, McDonald's, Mang Inasal, resorts, car rentals, and computer shops around a lot. Each kind has a count within its radius, the nearest 5, and the nearest one even outside the radius. Returns `{categories, partial}`: if Overpass isn't back within 2 seconds, it answers from the Overture copy with `partial: true`, and asking again shortly gets the full list |
| GET | `/reverse?lat=13.94&lon=121.16` | Names a pinned spot (barangay, town, province) without measuring around it |
| GET | `/health` | Health check |
| GET | `/models/info` | Describes the model and data sources |

`/predict` takes the eight factors (`infrastructure_score`, `typhoon_risk`, `gdp_growth`, `population_growth`, `proximity_to_mall`, `proximity_to_school`, `proximity_to_hospital`, `distance_to_amenities`), plus `news_text`, `lat`, `lon`, `place_kind` (`center` or `site`), and `measured`. Without `lat` and `lon`, the price falls back to a national town median and the confidence is `low`.

## Where the data comes from

| Factor | Source | File |
|---|---|---|
| Coordinates, barangay, city, province, region | OpenStreetMap Nominatim. Falls back to `data/reference_prices.csv` when Nominatim can't be reached | `data_collectors/geocoder.py` |
| Nearest mall, school, hospital, town center; infrastructure score | OpenStreetMap Overpass. One survey per point (about 110 m), sent to every working mirror at once; the first good answer wins | `data_collectors/osm_collector.py` |
| Nearby places | The same Overpass survey, merged with a local copy of Overture Maps Places (`data/places_ph.sqlite`). The same place in both is listed once | `data_collectors/places_db.py`, `osm_collector.py` |
| Elevation | Open-Meteo. The backend replaces it with the PostGIS 30 m terrain model when PostgreSQL is connected | `data_collectors/geocoder.py` |
| Typhoon and flood risk | Regional exposure from `data/regions.csv`, raised for ground below 15 m | `pricing.py` |
| GDP and population growth | `data/regions.csv` | `reference.py` |
| News | Google News RSS, last 12 months, filtered to roads, airports, malls, floods, and similar topics | `data_collectors/news_collector.py` |

Results are cached in memory: places and Overpass surveys for 7 days, news for 6 hours. Public Overpass mirrors often queue for 15 to 25 seconds, so `/locate` waits at most 15 seconds for the survey. Past that, it estimates distances from how far the point is from the closest reference town, and the survey keeps running so `/nearby` finds it cached. A mirror that fails is skipped for 5 minutes. Each factor reports its source as `openstreetmap`, `region`, or `estimate`.

Chains are matched by `brand:wikidata` and by exact brand or name spellings (see `CHAINS` in `osm_collector.py`). Regex searches on names make Overpass scan the whole planet and time out.

## Nearby places database

OpenStreetMap is missing many businesses in the Philippines, especially outside big cities. Around Cabadbaran, for example, it has no 7-Eleven at all, while there are three within 2 km. [Overture Maps Places](https://docs.overturemaps.org/guides/places/) merges business listings from Meta, Microsoft, and others, and has them. It's free under CDLA-Permissive-2.0, and the report credits it.

`etl/build_places.py` copies the Philippine part (about 175,000 places in the kinds the card shows, 40 MB) into `data/places_ph.sqlite`:

```bash
pip install -r requirements-etl.txt     # DuckDB, only needed for this step
python -m etl.build_places              # about a minute, reads Overture's public S3 bucket
```

The file isn't in git. Build it before deploying; `deploy.ps1` warns when it's missing. Without it, the card uses OpenStreetMap alone. Overture publishes a new release monthly; pass a release name such as `2026-09-23.1` to use a specific one.

Places scored below Overture's confidence of 0.6 are left out, 0.4 for restaurants, resorts, car rentals, and computer shops, which come from thinner sources. A place nobody has listed anywhere still won't show, so the report links to a Google Maps search too.

## How the price is estimated

1. Take the five reference localities closest to the point. Average their prices in log space, weighted by inverse squared distance.
2. Beyond 4 km from the closest one, pull the estimate toward a floor: ₱300 to ₱2,500 for open land, ₱1,500 to ₱6,000 for the center of a town with no reference price.
3. Compare the site's factors with what's typical at that distance. Better roads and closer amenities raise the price, and worse ones lower it, by at most -25% or +30%.

Confidence is `high` within 8 km of a reference locality with measured map data, `medium` within 25 km, and `low` beyond that.

The growth score (0 to 100) is a weighted sum of infrastructure, regional GDP growth, population growth, access to amenities, typhoon and flood risk, and the tone of the news. Grades: above 80 is A+, above 60 is A to B+, above 40 is B to C, and the rest is C-.

## Reference data

`data/reference_prices.csv` lists 84 localities with typical asking-price ranges per sqm for residential lots. `data/regions.csv` holds regional typhoon exposure and approximate PSA growth figures. Both are starting points compiled for this project. They are not official BIR zonal values or appraisals.

To improve the estimates, edit the CSV files and restart the service. Add more localities near the areas people check most, and replace the ranges with zonal values or recent sales when you have them. Check regional figures against [psa.gov.ph](https://psa.gov.ph).

## Other folders

- `etl/import_geodata.py` loads the DEM rasters in `geodata/rasters/` into PostGIS (`ph.dem30`). The backend reads elevation from that table.
- `etl/build_places.py` builds the nearby places database (see above).
- `utils/dem_downloader.py` downloads more DEM tiles.

## Configuration

| Variable | Default | Use |
|---|---|---|
| `NOMINATIM_URL` | public Nominatim | Point at your own Nominatim server for heavy use |
| `NOMINATIM_EMAIL` | none | Contact email sent to Nominatim, as its usage policy asks |
| `SMARTLAND_USER_AGENT` | `SmartLand/1.0 (...)` | User agent for all outgoing requests |

The public Nominatim and Overpass servers allow light use only. For production traffic, run your own or use a paid provider.
