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
| GET | `/api/locate?q=` or `?lat=&lon=` | No | Place, map data, factors, and news for a location or a pinned spot |
| GET | `/api/offices?town=&province=&lat=&lon=` | No | Map positions of the assessor, BIR, Registry of Deeds, and planning offices near a lot. `null` for an office that isn't on OpenStreetMap |
| GET | `/api/nearby?lat=&lon=` | No | Hospitals and malls within 10 km. Supermarkets, 7-Eleven, Jollibee, McDonald's, and Mang Inasal within 5 km. Each kind has a count and the nearest 5. 503 when OpenStreetMap can't be reached |
| POST | `/api/analyze` | Optional | Report for a location. Looks the place up itself if the request has no `place` |
| POST | `/api/auth/register`, `/api/auth/login` | No | Returns a JWT that lasts 30 days |
| GET | `/api/auth/config` | No | Which sign-in methods are on (`google_client_id`, or null) |
| POST | `/api/auth/google` | No | Sign in with a Google ID token (`credential`) |
| GET | `/api/auth/me` | Yes | The signed-in account |
| GET, PUT, DELETE | `/api/reports`, `/api/reports/{id}` | Yes | Saved reports in the account |
| POST, DELETE | `/api/reports/{id}/share` | Yes | Turn a public link on or off |
| GET | `/api/shared/{token}` | No | A shared report, read-only |
| GET | `/api/listings?lat=&lon=&radius_km=25&category=` | No | Active listings near a point, nearest first, plus the count per category. Phone numbers are left out of search results |
| GET | `/api/listings/{id}` | No | One listing, with the seller's phone number |
| GET | `/api/listings/mine` | Yes | The signed-in seller's listings, active and sold |
| POST | `/api/listings` | Yes | Post a listing. Brokers must give a PRC license number; every seller confirms they may sell. 20 per hour |
| GET | `/api/listings/schema` | No | The fields each kind of listing asks for, the document types, and the credibility points |
| PATCH | `/api/listings/{id}` | Yes | Change your listing's `price` (the old one stays on the record), or mark it `sold` or back to `active` |
| GET | `/api/listings/{id}/record` | No | Every change to a listing with its fingerprint, and whether the chain is intact |
| POST | `/api/listings/{id}/documents` | Yes | Add a document to your listing (multipart: `type`, `file`) |
| GET | `/api/listings/{id}/documents/{doc}/file` | Yes | The file, for the listing's owner and reviewers only |
| GET | `/api/admin/documents?status=pending` | Reviewer | Documents waiting for review |
| POST | `/api/admin/documents/{doc}/review` | Reviewer | Mark a document `verified` or `rejected`, with a note |
| DELETE | `/api/listings/{id}` | Yes | Remove your listing |
| GET | `/api/reverse?lat=&lon=` | No | Barangay, town, and province for a pinned spot |

Checking a location works without an account. Guests are limited to 100 reports per 15 minutes per IP address, and signed-in people get their own limit.

### Storage

- **Accounts and saved reports**: SQLite, in `backend/smartland.db` by default. Set `DATABASE_PATH` to move it. Passwords are hashed with PBKDF2-SHA256.
- **Reports on the device**: the web app keeps a copy in `localStorage`. When you sign in, reports saved on the device upload to the account.
- **PostgreSQL with PostGIS** (optional): gives elevation from the 30 m terrain model in `ph.dem30`. Without it, elevation comes from Open-Meteo.
- **MongoDB** (optional): an `agencies` collection with `location`, `name`, `phone`, `email`, and `address`. When a document matches the city, the report shows it under "Before you buy".

Set `JWT_SECRET` to a long random value. Without it, the backend makes a temporary secret and everyone is signed out when it restarts.

### Sign in with Google

People can sign in with a Google account, by the "Continue with Google" button or Google's One Tap prompt, which signs returning people in without a click. The backend checks the ID token's signature against Google's published keys, its audience, issuer, and expiry, and that the email is verified. A Google sign-in with the same email as an existing account signs into that account.

To turn it on:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type **Web application**.
2. Under **Authorized JavaScript origins**, add `http://localhost:3001` and `http://localhost` for local use, and your Cloud Run address.
3. Set `GOOGLE_CLIENT_ID` for the backend (or `SMARTLAND_GOOGLE_CLIENT_ID` before `deploy.ps1`). The frontend reads it from `GET /api/auth/config`, so it's set in one place.

Without it, the Google button is hidden and email sign-in works as before.

### Listings, documents, and the credibility score

Sellers post listings from `/listings/new`. Each kind of property (farm lot, house for sale, house for rent, land for lease, commercial building or warehouse for sale, warehouse for lease, beach property, foreclosure) asks for its own fields, defined once in `backend/listing_rules.py` and served to the form by `GET /api/listings/schema`.

- **Documents.** Sellers can attach a land title, proof of rights (CLOA or deed of sale), tax declaration, real property tax clearance, lot plan, or other papers: PDF, JPG, PNG, or WebP, up to 10 MB. The server checks the real file type from its first bytes. Files are saved in `UPLOAD_DIR` (default `backend/uploads/`), named by their SHA-256, and only the seller and reviewers can open them. Buyers see each document's kind, review status, and fingerprint.
- **Reviews.** People whose emails are in `ADMIN_EMAILS` (comma-separated) review documents at `/reviews`. They check each one with the office that issued it (Registry of Deeds, assessor, treasurer, DAR, DENR) and mark it checked or rejected.
- **Credibility score** (0 to 100). Proof of ownership is worth 40 once checked (15 while only uploaded), the tax declaration and tax clearance 15 each, the lot plan 10, an exact pin with area 10, and an identified seller 10. Rejected documents count for nothing. It shows how much of a listing has documents behind it. It isn't a guarantee.
- **Fingerprints.** A buyer can choose a file the seller sent them on the listing page. The browser works out its SHA-256 and compares it with the uploaded documents, without uploading the file.
- **Record.** Every change to a listing (listed, price changed, document added, document reviewed, sold) is saved as an event whose SHA-256 covers the event before it. `GET /api/listings/{id}/record` returns the events and whether the chain is intact, and the listing page shows the price history. Editing any past event breaks the chain. The chain lives in SmartLand's own database, so it proves changes to anyone who saved an earlier fingerprint; publishing fingerprints somewhere public (for example with OpenTimestamps) would make it independent of SmartLand.

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

`./deploy.ps1` deploys the AI service and the web app to Cloud Run. Set `SMARTLAND_JWT_SECRET` in your shell first, so sign-ins survive new deploys, and `SMARTLAND_ADMIN_EMAILS` to the reviewers' emails.

Cloud Run's disk is wiped on every deploy and is not shared between instances. The script runs the web app on one instance and keeps the SQLite file in `/tmp`. Accounts, saved reports, listings, and uploaded documents still reset on each deploy. For lasting accounts, mount a persistent volume and point `DATABASE_PATH` at it, or move `backend/store.py` to Cloud SQL.

## Design

The UI follows `DESIGN.md`: the Apple design system plus SmartLand rules for dark mode, status colors, accessibility, motion, and copy. Tokens live in `frontend/src/styles/tokens.css`. Components use token classes only.

Icons are from [Lucide](https://lucide.dev) (ISC licence). Motion uses [GSAP](https://gsap.com) under its standard no-charge licence.
