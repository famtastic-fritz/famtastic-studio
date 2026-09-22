#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/common.sh"

require_phase2_env
require_command gcloud
if [[ "${PHASE2_STOP_GATE:-}" != "STOP_PHASE2_SHADOW" ]]; then
  printf 'refusing stop: set PHASE2_STOP_GATE=STOP_PHASE2_SHADOW\n' >&2
  exit 1
fi

containment_failures=0
run_containment() {
  local label="$1"
  shift
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'contained: %s\n' "$label"
  elif grep -Eiq 'not[ _-]?found|does not exist|no matching binding|404' <<<"$output"; then
    printf 'already absent: %s\n' "$label"
  else
    printf 'containment failed: %s\n%s\n' "$label" "$output" >&2
    containment_failures=1
  fi
}

run_persistent_pause() {
  local output status
  set +e
  output="$(env \
    PHASE2_PAUSE_GATE=PAUSE_PHASE2_SHADOW \
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
    GOOGLE_CLOUD_PROJECT="$PHASE2_PROJECT_ID" \
    FAMTASTIC_PHASE2_REGION="$PHASE2_REGION" \
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
    node "$script_dir/../../../../scripts/pause-durable-execution-phase2.mjs" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]] \
    && grep -Fq '"ok":true' <<<"$output" \
    && grep -Fq '"event":"phase2_persistent_pause_verified"' <<<"$output"; then
    printf 'contained: persistent controls paused\n%s\n' "$output"
  else
    printf 'containment failed: persistent controls paused\n%s\n' "$output" >&2
    containment_failures=1
  fi
}

run_containment 'queue paused' \
  gcloud tasks queues pause "$PHASE2_QUEUE" \
    --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION"
run_containment 'scheduler paused or absent' \
  gcloud scheduler jobs pause "$PHASE2_SCHEDULER_JOB" \
    --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION"
control_sa="$(sa_email "$PHASE2_CONTROL_SA")"
intake_sa="$(sa_email "$PHASE2_INTAKE_SA")"
scheduler_sa="$(sa_email "$PHASE2_SCHEDULER_SA")"
task_invoker_sa="$(sa_email "$PHASE2_TASK_INVOKER_SA")"
run_persistent_pause
run_containment 'control queue enqueuer revoked' \
  gcloud tasks queues remove-iam-policy-binding "$PHASE2_QUEUE" \
    --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION" \
    --member="serviceAccount:$control_sa" --role=roles/cloudtasks.enqueuer
run_containment 'control queue viewer revoked' \
  gcloud tasks queues remove-iam-policy-binding "$PHASE2_QUEUE" \
    --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION" \
    --member="serviceAccount:$control_sa" --role=roles/cloudtasks.viewer
run_containment 'control task caller actAs revoked' \
  gcloud iam service-accounts remove-iam-policy-binding "$task_invoker_sa" \
    --project="$PHASE2_PROJECT_ID" --member="serviceAccount:$control_sa" \
    --role=roles/iam.serviceAccountUser
run_containment 'intake control invoker revoked' \
  gcloud run services remove-iam-policy-binding "$PHASE2_CONTROL_SERVICE" \
    --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" \
    --member="serviceAccount:$intake_sa" --role=roles/run.invoker
run_containment 'scheduler control invoker revoked' \
  gcloud run services remove-iam-policy-binding "$PHASE2_CONTROL_SERVICE" \
    --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" \
    --member="serviceAccount:$scheduler_sa" --role=roles/run.invoker
run_containment 'task worker invoker revoked' \
  gcloud run services remove-iam-policy-binding "$PHASE2_WORKER_SERVICE" \
    --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" \
    --member="serviceAccount:$task_invoker_sa" --role=roles/run.invoker
if [[ "$containment_failures" -ne 0 ]]; then
  printf 'stop completed with failures; inspect every classified result above\n' >&2
  exit 1
fi
printf 'Phase 2 stop completed; persistent controls and infrastructure containment were attempted\n'
