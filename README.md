# SmartLand

SmartLand estimates land prices in the Philippines. Enter a city, town, or barangay and what you know about the area, and you get a price per sqm, a growth score from 0 to 100, and an investment grade from A+ to C-.

## How it fits together

| Part | Folder | Port | What it does |
|---|---|---|---|
| Web app | `frontend/` | 3001 | React + Vite + Tailwind. Check a location, read the report, save reports on this device |
| Backend | `backend/` | 3000 | FastAPI gateway. `POST /api/test-analyze` (open) and `POST /api/analyze` (JWT) |
| AI service | `ai-microservice/` | 8002 | FastAPI. `POST /predict` scores price and growth (`main.py`) |

The web app calls `/api/...` and the Vite dev server forwards it to the backend on port 3000. MongoDB (agency lookup) and PostgreSQL (geo data) are optional: reports still work without them.

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

## Design

The UI follows `DESIGN.md`: the Apple design system plus SmartLand rules for dark mode, status colors, accessibility, motion, and copy. Tokens live in `frontend/src/styles/tokens.css`. Components use token classes only.

Icons are from [Lucide](https://lucide.dev) (ISC licence). Motion uses [GSAP](https://gsap.com) under its standard no-charge licence.
