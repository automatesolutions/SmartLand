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
| GET | `/api/listings?lat=&lon=&radius_km=25&category=` | No | Active listings near a point (every kind when `category` is left out), nearest first, plus the count per category. Phone numbers are left out of search results |
| GET | `/api/listings/{id}` | No | One listing, with the seller's phone number |
| GET | `/api/listings/mine` | Yes | The signed-in seller's listings, active and sold |
| POST | `/api/listings` | Yes | Post a listing. Brokers must give a PRC license number; every seller confirms they may sell. 20 per hour |
| GET | `/api/listings/schema` | No | The fields each kind of listing asks for, the document types, and the credibility points |
| PATCH | `/api/listings/{id}` | Yes | Change your listing's `price` (the old one stays on the record), or mark it `sold` or back to `active` |
| GET | `/api/listings/{id}/record` | No | Every change to a listing with its fingerprint, and whether the chain is intact |
| POST | `/api/listings/{id}/documents` | Yes | Add a document to your listing (multipart: `type`, `file`) |
| GET | `/api/listings/{id}/documents/{doc}/file` | Yes | The file, for the listing's owner and reviewers only |
| POST | `/api/listings/{id}/photos` | Yes | Add a public photo to your listing (multipart: `alt`, `file`). JPG, PNG, or WebP, up to 8 MB, 8 per listing |
| GET | `/api/listings/{id}/photos/{photo}` | No | A listing photo |
| DELETE | `/api/listings/{id}/photos/{photo}` | Yes | Remove a photo from your listing |
| GET | `/api/admin/documents?status=pending` | Reviewer | Documents waiting for review |
| POST | `/api/admin/documents/{doc}/review` | Reviewer | Mark a document `verified` or `rejected`, with a note |
| DELETE | `/api/listings/{id}` | Yes | Remove your listing |
| GET | `/api/reverse?lat=&lon=` | No | Barangay, town, and province for a pinned spot |
| GET | `/api/geocode?q=` | No | A town or barangay by name, without the map survey and news. The Listings page uses it to search by town |

Location lookups wait at most about 20 seconds. The backend keeps repeat answers in memory (`locate` for an hour, or two minutes when OpenStreetMap's survey wasn't back yet; `nearby` for an hour; `offices`, `reverse`, and `geocode` for a day). When the map service runs slow, `nearby` and `offices` answer with what's ready and `"partial": true`, and other lookups answer 504 with a reason the web app shows. The OpenStreetMap survey keeps running in the AI service for up to 30 seconds per mirror, so asking again shortly gets the full answer.

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

- **Title rule.** Sale listings must come with the land title or proof of rights, or the seller ticks "I don't have a land title or proof of rights to show" (`title_status`: `attached` or `none`). Every listing has a `title_state`: `checked` (a reviewer checked it), `shown` (uploaded, not checked yet), `rejected`, or `none`. Cards and the listing page show it as a badge ("Title checked by SmartLand", "No title shown") next to who's selling, ahead of the credibility score.
- **Photos.** Public photos with alt text, checked by their first bytes like documents, stored under `photos/` next to the documents. The first is the cover on listing cards. Title documents never go here.
- **Documents.** Sellers can attach a land title, proof of rights (CLOA or deed of sale), tax declaration, real property tax clearance, lot plan, or other papers: PDF, JPG, PNG, or WebP, up to 10 MB. The server checks the real file type from its first bytes. Files are saved in `UPLOAD_DIR` (default `backend/uploads/`) or a Cloud Storage bucket (see Keep data between deploys), named by their SHA-256, and only the seller and reviewers can open them. Buyers see each document's kind, review status, and fingerprint.
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

### Business accounts, leads, and the team workspace

The full plan is in `docs/business-suite.md`.

- **Business accounts.** Brokerages, developers, and agencies create one from Account. Members have one of four roles: owner, admin, member, or guest. Owners and admins invite people by copying a one-time link that expires in 7 days. Brokerages give the broker's PRC license, shown on every listing posted for the business.
- **Leads.** A buyer taps "Message the seller" on a listing. The message becomes a lead on the business's board at `/business/leads`, or on the seller's own board for listings posted as themselves. Buyers who were signed in read replies at `/messages`. Contact details are cleared 2 years after a lead closes (Data Privacy Act of 2012).
- **Team chat and tasks.** Each business has a workspace at `/business/workspace`: #general plus channels owners and admins add, direct messages between two teammates, and @mentions. Open chats check for new messages every 4 seconds while the tab is visible; the nav badge counts new direct messages and mentions. Tasks at `/business/tasks` have an assignee, a due date, and an optional link to a lead or listing. Guests can read but not post. Owners and admins can't read other people's direct messages.

Run the backend tests from `backend/` with `venv\Scripts\python -m pytest` (install `requirements-dev.txt` first).

## Deploy

`./deploy.ps1` deploys the AI service and the web app to Cloud Run. Set `SMARTLAND_JWT_SECRET` in your shell first, so sign-ins survive new deploys, and `SMARTLAND_ADMIN_EMAILS` to the reviewers' emails.

Cloud Run's disk is wiped on every deploy and whenever the app sits idle, and it isn't shared between instances. The script runs the web app on one instance, because the database is one SQLite file.

### Keep data between deploys

Without a bucket, the database and uploads sit in `/tmp` and reset often. With one, they last:

- **Database.** [Litestream](https://litestream.io) copies every change to `gs://<bucket>/db` within about a second, and restores the database from there when the app starts (`backend/start.sh`).
- **Uploaded files.** Documents go straight to `gs://<bucket>/uploads/`, named by their SHA-256 (`backend/storage.py`). The bucket stays private: files are served only through the backend, which checks who's asking.

One-time setup (this creates a paid resource, a few cents a month at SmartLand's size):

```powershell
gcloud storage buckets create gs://smartland-data-510911 --project smartland-510911 --location asia-southeast1 --uniform-bucket-level-access --public-access-prevention
$sa = "$(gcloud projects describe smartland-510911 --format 'value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding gs://smartland-data-510911 --member "serviceAccount:$sa" --role roles/storage.objectAdmin
$env:SMARTLAND_BUCKET = "smartland-data-510911"
./deploy.ps1
```

| Setting | What it does |
|---|---|
| `DATABASE_PATH` | Where the SQLite file lives. Default `backend/smartland.db` |
| `UPLOAD_DIR` | Folder for uploaded files when no bucket is set. Default `uploads/` next to the database |
| `STORAGE_BUCKET` | Keep uploaded files in this Cloud Storage bucket instead (`STORAGE_PREFIX`, default `uploads`) |
| `LITESTREAM_REPLICA_URL` | Copy the database here, for example `gcs://my-bucket/db` |

## Design

The UI follows `DESIGN.md`: the Apple design system plus SmartLand rules for dark mode, status colors, accessibility, motion, and copy. Tokens live in `frontend/src/styles/tokens.css`. Components use token classes only.

Icons are from [Lucide](https://lucide.dev) (ISC licence). Motion uses [GSAP](https://gsap.com) under its standard no-charge licence.
