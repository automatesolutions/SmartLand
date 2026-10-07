# Deploys SmartLand to Cloud Run: the AI service first, then the web app (frontend + backend).
# Usage: ./deploy.ps1   (needs gcloud signed in with access to the project, and billing enabled)

param(
  [string]$Project = "smartland-510911",
  [string]$Region = "asia-southeast1"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $Project
if ($LASTEXITCODE) { exit $LASTEXITCODE }

gcloud run deploy smartland-ai --source "$root/ai-microservice" --project $Project --region $Region `
  --allow-unauthenticated --memory 512Mi --max-instances 3 --quiet
if ($LASTEXITCODE) { exit $LASTEXITCODE }

$aiUrl = gcloud run services describe smartland-ai --project $Project --region $Region --format "value(status.url)"

gcloud run deploy smartland-web --source "$root" --project $Project --region $Region `
  --allow-unauthenticated --memory 512Mi --max-instances 3 --quiet `
  --set-env-vars "AI_SERVICE_URL=$aiUrl/predict,CORS_ORIGIN=*"
if ($LASTEXITCODE) { exit $LASTEXITCODE }

$webUrl = gcloud run services describe smartland-web --project $Project --region $Region --format "value(status.url)"
Write-Host "SmartLand is live at $webUrl"
