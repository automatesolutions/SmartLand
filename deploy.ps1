# Deploys SmartLand to Cloud Run: the AI service first, then the web app (frontend + backend).
# Usage: ./deploy.ps1   (needs gcloud signed in with access to the project, and billing enabled)

param(
  [string]$Project = "smartland-510911",
  [string]$Region = "asia-southeast1",
  [string]$JwtSecret = $env:SMARTLAND_JWT_SECRET
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $Project
if ($LASTEXITCODE) { exit $LASTEXITCODE }

gcloud run deploy smartland-ai --source "$root/ai-microservice" --project $Project --region $Region `
  --allow-unauthenticated --memory 512Mi --max-instances 3 --quiet
if ($LASTEXITCODE) { exit $LASTEXITCODE }

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
  --set-env-vars "AI_SERVICE_URL=$aiUrl/predict,CORS_ORIGIN=*,JWT_SECRET=$JwtSecret,DATABASE_PATH=/tmp/smartland.db"
if ($LASTEXITCODE) { exit $LASTEXITCODE }

$webUrl = gcloud run services describe smartland-web --project $Project --region $Region --format "value(status.url)"
Write-Host "SmartLand is live at $webUrl"
