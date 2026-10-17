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
| POST | `/predict` | Scores price and growth from the factors and the coordinates |
| GET | `/health` | Health check |
| GET | `/models/info` | Describes the model and data sources |

`/predict` takes the eight factors (`infrastructure_score`, `typhoon_risk`, `gdp_growth`, `population_growth`, `proximity_to_mall`, `proximity_to_school`, `proximity_to_hospital`, `distance_to_amenities`), plus `news_text`, `lat`, `lon`, `place_kind` (`center` or `site`), and `measured`. Without `lat` and `lon`, the price falls back to a national town median and the confidence is `low`.

## Where the data comes from

| Factor | Source | File |
|---|---|---|
| Coordinates, barangay, city, province, region | OpenStreetMap Nominatim. Falls back to `data/reference_prices.csv` when Nominatim can't be reached | `data_collectors/geocoder.py` |
| Nearest mall, school, hospital, town center; infrastructure score | OpenStreetMap Overpass (three mirrors). One request per point | `data_collectors/osm_collector.py` |
| Elevation | Open-Meteo. The backend replaces it with the PostGIS 30 m terrain model when PostgreSQL is connected | `data_collectors/geocoder.py` |
| Typhoon and flood risk | Regional exposure from `data/regions.csv`, raised for ground below 15 m | `pricing.py` |
| GDP and population growth | `data/regions.csv` | `reference.py` |
| News | Google News RSS, last 12 months, filtered to roads, airports, malls, floods, and similar topics | `data_collectors/news_collector.py` |

Results are cached in memory: places for 7 days, news for 6 hours. If every Overpass mirror fails, the service skips Overpass for 2 minutes and estimates distances from how far the point is from the closest reference town. Each factor reports its source as `openstreetmap`, `region`, or `estimate`.

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

- `etl/` loads the DEM rasters in `geodata/rasters/` into PostGIS (`ph.dem30`). The backend reads elevation from that table.
- `utils/dem_downloader.py` downloads more DEM tiles.

## Configuration

| Variable | Default | Use |
|---|---|---|
| `NOMINATIM_URL` | public Nominatim | Point at your own Nominatim server for heavy use |
| `NOMINATIM_EMAIL` | none | Contact email sent to Nominatim, as its usage policy asks |
| `SMARTLAND_USER_AGENT` | `SmartLand/1.0 (...)` | User agent for all outgoing requests |

The public Nominatim and Overpass servers allow light use only. For production traffic, run your own or use a paid provider.
