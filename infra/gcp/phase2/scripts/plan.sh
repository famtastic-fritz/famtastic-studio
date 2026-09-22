#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/common.sh"

require_phase2_env
"$script_dir/validate.sh"
rendered_dir="$(mktemp -d)"
trap 'rm -rf "$rendered_dir"' EXIT
render_manifests "$rendered_dir"

cat <<PLAN
INERT PHASE 2 PLAN
Project: $PHASE2_PROJECT_ID
Region: $PHASE2_REGION
Pilot run: $PHASE2_PILOT_RUN_ID
Cost caps: $PHASE2_MAX_JOB_COST_MICROS micros/job, $PHASE2_MAX_TOTAL_COST_MICROS micros total
Provider: $PHASE2_MODEL, pricebook $PHASE2_PRICEBOOK_VERSION, location $PHASE2_VERTEX_LOCATION
Artifact Registry repository: $PHASE2_ARTIFACT_REPOSITORY
Control image: $PHASE2_CONTROL_IMAGE
Worker image: $PHASE2_WORKER_IMAGE
Firestore database: $PHASE2_FIRESTORE_DATABASE (must already exist)
Source bucket: $PHASE2_SOURCE_BUCKET
Artifact bucket: $PHASE2_ARTIFACT_BUCKET
Worker URL: $PHASE2_WORKER_URL
Worker audience: $PHASE2_WORKER_AUDIENCE
Control audience: $PHASE2_CONTROL_AUDIENCE
Intake caller: $(sa_email "$PHASE2_INTAKE_SA")
Scheduler caller: $(sa_email "$PHASE2_SCHEDULER_SA")
Task caller: $(sa_email "$PHASE2_TASK_INVOKER_SA")
Queue: $PHASE2_QUEUE, target PAUSED, 0.1 dispatches/s, concurrency 1
Scheduler: $PHASE2_SCHEDULER_JOB, ABSENT until a separate activation gate
Services: internal IAM only, min 0, max 1, concurrency 1, new revision gets no traffic
Resource precondition: services, queue, Scheduler, buckets, and five SAs must be absent
Controls: paused, dispatch off, worker off, provider off, hard cap 20 jobs
Secrets: none

No cloud mutation was attempted by this plan.
PLAN

printf '\nRendered manifests:\n  %s\n  %s\n' \
  "$rendered_dir/control.service.yaml" "$rendered_dir/worker.service.yaml"

if [[ "${PHASE2_ONLINE_PLAN:-0}" != "1" ]]; then
  cat <<'PLAN'

Set PHASE2_ONLINE_PLAN=1 to run read-only describes and Cloud Run dry-run
validation. Cloud Run dry-run contacts Google Cloud but does not apply changes.
PLAN
  exit 0
fi

require_command gcloud
gcloud auth application-default print-access-token >/dev/null
project_number="$(read_phase2_project_number)"
assert_deterministic_cloud_run_urls "$project_number"
assert_artifact_registry_release_inputs
assert_phase2_managed_resources_absent
gcloud firestore databases describe \
  --project="$PHASE2_PROJECT_ID" \
  --database="$PHASE2_FIRESTORE_DATABASE"
gcloud run services replace "$rendered_dir/control.service.yaml" \
  --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" --dry-run
gcloud run services replace "$rendered_dir/worker.service.yaml" \
  --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" --dry-run
printf 'online plan completed without mutation for project number %s\n' "$project_number"
