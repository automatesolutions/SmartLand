# SmartLand

SmartLand estimates land prices in the Philippines. Enter a city, town, or barangay, and SmartLand fills in the details from OpenStreetMap, regional figures, and recent news. You get a price per sqm with a likely range, nearby reference prices, a growth score from 0 to 100, and an investment grade from A+ to C-.

## How it fits together

| Part | Folder | Port | What it does |
|---|---|---|---|
| Web app | `frontend/` | 3001 | React + Vite + Tailwind. Check a location, see it on a map, read the report, save, share, print, or download it |
| Backend | `backend/` | 3000 | FastAPI gateway. Accounts, saved reports, share links, and calls to the AI service |
| AI service | `ai-microservice/` | 8002 | FastAPI. `GET /locate` finds a place and its factors, `POST /predict` scores it. See its [README](ai-microservice/README.md) |

The web app calls `/api/...` and the Vite dev server forwards it to the backend on port 3000.

### Backend API

| Method | Path | Sign-in | What it does |
|---|---|---|---|
| GET | `/api/locate?q=` | No | Place, map data, factors, and news for a location |
| POST | `/api/analyze` | Optional | Report for a location. Looks the place up itself if the request has no `place` |
| POST | `/api/auth/register`, `/api/auth/login` | No | Returns a JWT that lasts 30 days |
| GET | `/api/auth/me` | Yes | The signed-in account |
| GET, PUT, DELETE | `/api/reports`, `/api/reports/{id}` | Yes | Saved reports in the account |
| POST, DELETE | `/api/reports/{id}/share` | Yes | Turn a public link on or off |
| GET | `/api/shared/{token}` | No | A shared report, read-only |

Checking a location works without an account. Guests are limited to 100 reports per 15 minutes per IP address, and signed-in people get their own limit.

### Storage

- **Accounts and saved reports**: SQLite, in `backend/smartland.db` by default. Set `DATABASE_PATH` to move it. Passwords are hashed with PBKDF2-SHA256.
- **Reports on the device**: the web app keeps a copy in `localStorage`. When you sign in, reports saved on the device upload to the account.
- **PostgreSQL with PostGIS** (optional): gives elevation from the 30 m terrain model in `ph.dem30`. Without it, elevation comes from Open-Meteo.
- **MongoDB** (optional): an `agencies` collection with `location`, `name`, `phone`, `email`, and `address`. When a document matches the city, the report shows it under "Before you buy".

Set `JWT_SECRET` to a long random value. Without it, the backend makes a temporary secret and everyone is signed out when it restarts.

## Run it

Use three terminals from the repo root. The commands are for Windows. On macOS or Linux, use `venv/bin/python`.

```bash
# 1. AI service
cd ai-microservice
venv/Scripts/python -m uvicorn main:app --port 8002

# 2. Backend
cd backend
venv/Scripts/python -m uvicorn main:app --port 3000

# 3. Web app
cd frontend
npm install
npm run dev        # http://localhost:3001
```

Build for production with `npm run build` in `frontend/`. Output goes to `frontend/dist/`.

## Deploy

`./deploy.ps1` deploys the AI service and the web app to Cloud Run. Set `SMARTLAND_JWT_SECRET` in your shell first, so sign-ins survive new deploys.

Cloud Run's disk is wiped on every deploy and is not shared between instances. The script runs the web app on one instance and keeps the SQLite file in `/tmp`. Accounts and saved reports still reset on each deploy. For lasting accounts, mount a persistent volume and point `DATABASE_PATH` at it, or move `backend/store.py` to Cloud SQL.

## Design

The UI follows `DESIGN.md`: the Apple design system plus SmartLand rules for dark mode, status colors, accessibility, motion, and copy. Tokens live in `frontend/src/styles/tokens.css`. Components use token classes only.

Icons are from [Lucide](https://lucide.dev) (ISC licence). Motion uses [GSAP](https://gsap.com) under its standard no-charge licence.
