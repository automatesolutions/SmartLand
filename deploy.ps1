# Deploys SmartLand to Cloud Run: the AI service first, then the web app (frontend + backend).
# Usage: ./deploy.ps1   (needs gcloud signed in with access to the project, and billing enabled)

param(
  [string]$Project = "smartland-510911",
  [string]$Region = "asia-southeast1",
  [string]$JwtSecret = $env:SMARTLAND_JWT_SECRET,
  # Comma-separated emails of the people who review listing documents
  [string]$AdminEmails = $env:SMARTLAND_ADMIN_EMAILS,
  # OAuth client ID for "Sign in with Google" (Google Cloud Console > APIs & Services > Credentials)
  [string]$GoogleClientId = $env:SMARTLAND_GOOGLE_CLIENT_ID
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $Project
if ($LASTEXITCODE) { exit $LASTEXITCODE }

# The nearby-places database is built locally and isn't in git. Without it the
# report's "What's nearby" card falls back to OpenStreetMap alone.
if (-not (Test-Path "$root/ai-microservice/data/places_ph.sqlite")) {
  Write-Warning "ai-microservice/data/places_ph.sqlite is missing. Build it first: cd ai-microservice; pip install -r requirements-etl.txt; python -m etl.build_places"
}

gcloud run deploy smartland-ai --source "$root/ai-microservice" --project $Project --region $Region `
  --allow-unauthenticated --memory 512Mi --max-instances 3 --quiet
if ($LASTEXITCODE) { exit $LASTEXITCODE }

# The client ID isn't secret and is usually already in backend/.env for local use
if (-not $GoogleClientId -and (Test-Path "$root/backend/.env")) {
  $line = Select-String -Path "$root/backend/.env" -Pattern '^\s*GOOGLE_CLIENT_ID\s*=\s*(.+)$' | Select-Object -First 1
  if ($line) { $GoogleClientId = $line.Matches[0].Groups[1].Value.Trim() }
}
if (-not $GoogleClientId) {
  Write-Warning "SMARTLAND_GOOGLE_CLIENT_ID is not set and backend/.env has no GOOGLE_CLIENT_ID. Sign in with Google will be hidden."
} else {
  Write-Host "Sign in with Google: $GoogleClientId"
}
if (-not $AdminEmails) {
  Write-Warning "SMARTLAND_ADMIN_EMAILS is not set. Nobody can review listing documents."
}
if (-not $JwtSecret) {
  Write-Warning "SMARTLAND_JWT_SECRET is not set. Everyone will be signed out on every restart."
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $JwtSecret = [Convert]::ToBase64String($bytes)
}

$aiUrl = gcloud run services describe smartland-ai --project $Project --region $Region --format "value(status.url)"

# One instance: accounts live in a SQLite file, which instances can't share
gcloud run deploy smartland-web --source "$root" --project $Project --region $Region `
  --allow-unauthenticated --memory 512Mi --max-instances 1 --quiet `
  --set-env-vars "^;^AI_SERVICE_URL=$aiUrl/predict;CORS_ORIGIN=*;JWT_SECRET=$JwtSecret;DATABASE_PATH=/tmp/smartland.db;ADMIN_EMAILS=$AdminEmails;GOOGLE_CLIENT_ID=$GoogleClientId"
if ($LASTEXITCODE) { exit $LASTEXITCODE }

$webUrl = gcloud run services describe smartland-web --project $Project --region $Region --format "value(status.url)"
Write-Host "SmartLand is live at $webUrl"
