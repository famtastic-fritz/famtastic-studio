#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/common.sh"

refuse_unproven_cloud_run_create() {
  printf '%s\n' \
    'refusing apply: PHASE2_CREATE_ONLY_RUN_GATE has no accepted value in this package' \
    'a separately reviewed create-only Cloud Run mechanism is required before any cloud mutation' >&2
  exit 1
}

require_phase2_env
require_command gcloud
require_command node
"$script_dir/validate.sh"
if [[ "${PHASE2_APPLY_GATE:-}" != "APPLY_INERT_PHASE2_BASELINE" ]]; then
  printf 'refusing apply: set PHASE2_APPLY_GATE=APPLY_INERT_PHASE2_BASELINE\n' >&2
  exit 1
fi
if [[ "${PHASE2_ONLINE_PLAN_PASSED:-}" != "yes" ]]; then
  printf 'refusing apply: online plan receipt is required\n' >&2
  exit 1
fi
if [[ -n "${FIRESTORE_EMULATOR_HOST:-}" ]]; then
  printf 'refusing apply: FIRESTORE_EMULATOR_HOST must be unset for the live named database\n' >&2
  exit 1
fi
refuse_unproven_cloud_run_create

gcloud auth application-default print-access-token >/dev/null
project_number="$(read_phase2_project_number)"
assert_deterministic_cloud_run_urls "$project_number"
assert_artifact_registry_release_inputs
assert_phase2_managed_resources_absent
gcloud firestore databases describe \
  --project="$PHASE2_PROJECT_ID" \
  --database="$PHASE2_FIRESTORE_DATABASE" >/dev/null

project="$PHASE2_PROJECT_ID"
region="$PHASE2_REGION"
control_sa="$(sa_email "$PHASE2_CONTROL_SA")"
worker_sa="$(sa_email "$PHASE2_WORKER_SA")"
intake_sa="$(sa_email "$PHASE2_INTAKE_SA")"
scheduler_sa="$(sa_email "$PHASE2_SCHEDULER_SA")"
task_invoker_sa="$(sa_email "$PHASE2_TASK_INVOKER_SA")"

gcloud services enable \
  run.googleapis.com cloudtasks.googleapis.com firestore.googleapis.com \
  storage.googleapis.com aiplatform.googleapis.com iamcredentials.googleapis.com \
  cloudscheduler.googleapis.com \
  --project="$project"

gcloud tasks queues create "$PHASE2_QUEUE" \
  --project="$project" --location="$region" \
  --max-dispatches-per-second=0.1 --max-concurrent-dispatches=1 \
  --max-attempts=3 --min-backoff=10s --max-backoff=300s
gcloud tasks queues pause "$PHASE2_QUEUE" \
  --project="$project" --location="$region"

for spec in \
  "$PHASE2_CONTROL_SA:Phase 2 control runtime" \
  "$PHASE2_WORKER_SA:Phase 2 worker runtime" \
  "$PHASE2_INTAKE_SA:Phase 2 intake OIDC caller" \
  "$PHASE2_SCHEDULER_SA:Phase 2 scheduler OIDC caller" \
  "$PHASE2_TASK_INVOKER_SA:Phase 2 task OIDC caller"; do
  name="${spec%%:*}"
  display="${spec#*:}"
  gcloud iam service-accounts create "$name" \
    --project="$project" --display-name="$display"
done

for bucket in "$PHASE2_SOURCE_BUCKET" "$PHASE2_ARTIFACT_BUCKET"; do
  gcloud storage buckets create "gs://$bucket" \
    --project="$project" --location="$region" \
    --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://$bucket" \
    --project="$project" --uniform-bucket-level-access --public-access-prevention
done

gcloud projects add-iam-policy-binding "$project" \
  --member="serviceAccount:$control_sa" --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$project" \
  --member="serviceAccount:$worker_sa" --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$project" \
  --member="serviceAccount:$worker_sa" --role=roles/aiplatform.user
gcloud storage buckets add-iam-policy-binding "gs://$PHASE2_SOURCE_BUCKET" \
  --member="serviceAccount:$control_sa" --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding "gs://$PHASE2_SOURCE_BUCKET" \
  --member="serviceAccount:$control_sa" --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding "gs://$PHASE2_SOURCE_BUCKET" \
  --member="serviceAccount:$worker_sa" --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding "gs://$PHASE2_ARTIFACT_BUCKET" \
  --member="serviceAccount:$worker_sa" --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding "gs://$PHASE2_ARTIFACT_BUCKET" \
  --member="serviceAccount:$worker_sa" --role=roles/storage.objectViewer
gcloud iam service-accounts add-iam-policy-binding "$task_invoker_sa" \
  --project="$project" --member="serviceAccount:$control_sa" \
  --role=roles/iam.serviceAccountUser

gcloud tasks queues add-iam-policy-binding "$PHASE2_QUEUE" \
  --project="$project" --location="$region" \
  --member="serviceAccount:$control_sa" --role=roles/cloudtasks.enqueuer
gcloud tasks queues add-iam-policy-binding "$PHASE2_QUEUE" \
  --project="$project" --location="$region" \
  --member="serviceAccount:$control_sa" --role=roles/cloudtasks.viewer

PHASE2_BOOTSTRAP_GATE=BOOTSTRAP_PAUSED_PHASE2_PILOT \
FAMTASTIC_EXECUTION_MODE=cloud-shadow \
FAMTASTIC_EXECUTION_SCOPE=phase2-pilot \
FAMTASTIC_PHASE2_RUNTIME=1 \
FAMTASTIC_PHASE2_MAX_JOBS=20 \
FAMTASTIC_PHASE2_PILOT_RUN_ID="$PHASE2_PILOT_RUN_ID" \
FAMTASTIC_PHASE2_MAX_JOB_COST_MICROS="$PHASE2_MAX_JOB_COST_MICROS" \
FAMTASTIC_PHASE2_MAX_TOTAL_COST_MICROS="$PHASE2_MAX_TOTAL_COST_MICROS" \
FAMTASTIC_PHASE2_MODEL="$PHASE2_MODEL" \
FAMTASTIC_PHASE2_PRICEBOOK_VERSION="$PHASE2_PRICEBOOK_VERSION" \
FAMTASTIC_PHASE2_VERTEX_LOCATION="$PHASE2_VERTEX_LOCATION" \
GOOGLE_CLOUD_PROJECT="$project" \
FAMTASTIC_PHASE2_REGION="$region" \
FAMTASTIC_PHASE2_QUEUE="$PHASE2_QUEUE" \
FAMTASTIC_PHASE2_WORKER_URL="$PHASE2_WORKER_URL" \
FAMTASTIC_PHASE2_WORKER_AUDIENCE="$PHASE2_WORKER_AUDIENCE" \
FAMTASTIC_PHASE2_CONTROL_AUDIENCE="$PHASE2_CONTROL_AUDIENCE" \
FAMTASTIC_PHASE2_INTAKE_SERVICE_ACCOUNT="$intake_sa" \
FAMTASTIC_PHASE2_SCHEDULER_SERVICE_ACCOUNT="$scheduler_sa" \
FAMTASTIC_PHASE2_TASK_INVOKER_SERVICE_ACCOUNT="$task_invoker_sa" \
FAMTASTIC_PHASE2_FIRESTORE_DATABASE="$PHASE2_FIRESTORE_DATABASE" \
FAMTASTIC_PHASE2_SOURCE_BUCKET="$PHASE2_SOURCE_BUCKET" \
FAMTASTIC_PHASE2_ARTIFACT_BUCKET="$PHASE2_ARTIFACT_BUCKET" \
  node "$script_dir/../../../../scripts/bootstrap-durable-execution-phase2.mjs"

gcloud run deploy "$PHASE2_CONTROL_SERVICE" \
  --project="$project" --region="$region" --platform=managed \
  --image="$PHASE2_CONTROL_IMAGE" --service-account="$control_sa" \
  --ingress=internal --no-allow-unauthenticated --no-traffic \
  --no-deploy-health-check \
  --min=0 --max=1 --concurrency=1 --cpu=1 --memory=512Mi --timeout=60 \
  --port=8080 \
  --set-env-vars="FAMTASTIC_EXECUTION_MODE=cloud-shadow,FAMTASTIC_EXECUTION_SCOPE=phase2-pilot,FAMTASTIC_PHASE2_RUNTIME=1,FAMTASTIC_PHASE2_MAX_JOBS=20,FAMTASTIC_PHASE2_PILOT_RUN_ID=$PHASE2_PILOT_RUN_ID,FAMTASTIC_PHASE2_MAX_JOB_COST_MICROS=$PHASE2_MAX_JOB_COST_MICROS,FAMTASTIC_PHASE2_MAX_TOTAL_COST_MICROS=$PHASE2_MAX_TOTAL_COST_MICROS,FAMTASTIC_PHASE2_MODEL=$PHASE2_MODEL,FAMTASTIC_PHASE2_PRICEBOOK_VERSION=$PHASE2_PRICEBOOK_VERSION,FAMTASTIC_PHASE2_VERTEX_LOCATION=$PHASE2_VERTEX_LOCATION,GOOGLE_CLOUD_PROJECT=$project,FAMTASTIC_PHASE2_REGION=$region,FAMTASTIC_PHASE2_QUEUE=$PHASE2_QUEUE,FAMTASTIC_PHASE2_WORKER_URL=$PHASE2_WORKER_URL,FAMTASTIC_PHASE2_WORKER_AUDIENCE=$PHASE2_WORKER_AUDIENCE,FAMTASTIC_PHASE2_CONTROL_AUDIENCE=$PHASE2_CONTROL_AUDIENCE,FAMTASTIC_PHASE2_INTAKE_SERVICE_ACCOUNT=$intake_sa,FAMTASTIC_PHASE2_SCHEDULER_SERVICE_ACCOUNT=$scheduler_sa,FAMTASTIC_PHASE2_TASK_INVOKER_SERVICE_ACCOUNT=$task_invoker_sa,FAMTASTIC_PHASE2_FIRESTORE_DATABASE=$PHASE2_FIRESTORE_DATABASE,FAMTASTIC_PHASE2_SOURCE_BUCKET=$PHASE2_SOURCE_BUCKET,FAMTASTIC_PHASE2_ARTIFACT_BUCKET=$PHASE2_ARTIFACT_BUCKET"
gcloud run deploy "$PHASE2_WORKER_SERVICE" \
  --project="$project" --region="$region" --platform=managed \
  --image="$PHASE2_WORKER_IMAGE" --service-account="$worker_sa" \
  --ingress=internal --no-allow-unauthenticated --no-traffic \
  --no-deploy-health-check \
  --min=0 --max=1 --concurrency=1 --cpu=1 --memory=512Mi --timeout=300 \
  --port=8080 \
  --set-env-vars="FAMTASTIC_EXECUTION_MODE=cloud-shadow,FAMTASTIC_EXECUTION_SCOPE=phase2-pilot,FAMTASTIC_PHASE2_RUNTIME=1,FAMTASTIC_PHASE2_MAX_JOBS=20,FAMTASTIC_PHASE2_PILOT_RUN_ID=$PHASE2_PILOT_RUN_ID,FAMTASTIC_PHASE2_MAX_JOB_COST_MICROS=$PHASE2_MAX_JOB_COST_MICROS,FAMTASTIC_PHASE2_MAX_TOTAL_COST_MICROS=$PHASE2_MAX_TOTAL_COST_MICROS,FAMTASTIC_PHASE2_MODEL=$PHASE2_MODEL,FAMTASTIC_PHASE2_PRICEBOOK_VERSION=$PHASE2_PRICEBOOK_VERSION,FAMTASTIC_PHASE2_VERTEX_LOCATION=$PHASE2_VERTEX_LOCATION,GOOGLE_CLOUD_PROJECT=$project,FAMTASTIC_PHASE2_REGION=$region,FAMTASTIC_PHASE2_QUEUE=$PHASE2_QUEUE,FAMTASTIC_PHASE2_WORKER_URL=$PHASE2_WORKER_URL,FAMTASTIC_PHASE2_WORKER_AUDIENCE=$PHASE2_WORKER_AUDIENCE,FAMTASTIC_PHASE2_CONTROL_AUDIENCE=$PHASE2_CONTROL_AUDIENCE,FAMTASTIC_PHASE2_INTAKE_SERVICE_ACCOUNT=$intake_sa,FAMTASTIC_PHASE2_SCHEDULER_SERVICE_ACCOUNT=$scheduler_sa,FAMTASTIC_PHASE2_TASK_INVOKER_SERVICE_ACCOUNT=$task_invoker_sa,FAMTASTIC_PHASE2_FIRESTORE_DATABASE=$PHASE2_FIRESTORE_DATABASE,FAMTASTIC_PHASE2_SOURCE_BUCKET=$PHASE2_SOURCE_BUCKET,FAMTASTIC_PHASE2_ARTIFACT_BUCKET=$PHASE2_ARTIFACT_BUCKET"

assert_run_service_url_and_zero_traffic \
  "$PHASE2_CONTROL_SERVICE" "$PHASE2_CONTROL_AUDIENCE"
assert_run_service_url_and_zero_traffic \
  "$PHASE2_WORKER_SERVICE" "$PHASE2_WORKER_AUDIENCE"

gcloud run services add-iam-policy-binding "$PHASE2_CONTROL_SERVICE" \
  --project="$project" --region="$region" \
  --member="serviceAccount:$intake_sa" --role=roles/run.invoker
gcloud run services add-iam-policy-binding "$PHASE2_CONTROL_SERVICE" \
  --project="$project" --region="$region" \
  --member="serviceAccount:$scheduler_sa" --role=roles/run.invoker
gcloud run services add-iam-policy-binding "$PHASE2_WORKER_SERVICE" \
  --project="$project" --region="$region" \
  --member="serviceAccount:$task_invoker_sa" --role=roles/run.invoker

gcloud tasks queues pause "$PHASE2_QUEUE" --project="$project" --location="$region"
assert_command_resource_absent "Scheduler job $PHASE2_SCHEDULER_JOB" \
  gcloud scheduler jobs describe "$PHASE2_SCHEDULER_JOB" \
    --project="$project" --location="$region"

printf 'inert baseline applied; exact URLs verified, no traffic promoted, queue paused, scheduler absent\n'
