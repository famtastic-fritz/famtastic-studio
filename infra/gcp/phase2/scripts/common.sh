#!/usr/bin/env bash
set -euo pipefail

phase2_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'required command is missing: %s\n' "$1" >&2
    return 1
  }
}

require_phase2_env() {
  local key
  local required=(
    PHASE2_PROJECT_ID PHASE2_REGION PHASE2_CONTROL_SERVICE
    PHASE2_WORKER_SERVICE PHASE2_QUEUE PHASE2_SCHEDULER_JOB
    PHASE2_PILOT_RUN_ID PHASE2_MAX_JOB_COST_MICROS
    PHASE2_MAX_TOTAL_COST_MICROS PHASE2_MODEL PHASE2_PRICEBOOK_VERSION
    PHASE2_VERTEX_LOCATION
    PHASE2_FIRESTORE_DATABASE PHASE2_SOURCE_BUCKET PHASE2_ARTIFACT_BUCKET
    PHASE2_WORKER_URL PHASE2_WORKER_AUDIENCE PHASE2_CONTROL_AUDIENCE
    PHASE2_CONTROL_IMAGE PHASE2_WORKER_IMAGE PHASE2_CONTROL_SA
    PHASE2_ARTIFACT_REPOSITORY
    PHASE2_WORKER_SA PHASE2_INTAKE_SA PHASE2_SCHEDULER_SA
    PHASE2_TASK_INVOKER_SA
  )
  for key in "${required[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      printf 'required environment value is missing: %s\n' "$key" >&2
      return 1
    fi
  done
  [[ "$PHASE2_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || {
    printf 'invalid PHASE2_PROJECT_ID\n' >&2
    return 1
  }
  [[ "$PHASE2_REGION" =~ ^[a-z]+(-[a-z0-9]+)+[0-9]$ ]] || {
    printf 'invalid PHASE2_REGION\n' >&2
    return 1
  }
  [[ "$PHASE2_CONTROL_SERVICE" != "$PHASE2_WORKER_SERVICE" ]] || {
    printf 'control and worker service names must be different\n' >&2
    return 1
  }
  for key in PHASE2_CONTROL_SERVICE PHASE2_WORKER_SERVICE; do
    [[ "${!key}" =~ ^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$ ]] || {
      printf '%s is not a valid Cloud Run service name\n' "$key" >&2
      return 1
    }
  done
  [[ "$PHASE2_QUEUE" =~ ^[a-z][a-z0-9_-]{0,99}$ ]] || {
    printf 'invalid PHASE2_QUEUE\n' >&2
    return 1
  }
  [[ "$PHASE2_FIRESTORE_DATABASE" =~ ^[a-z][a-z0-9-]{2,61}[a-z0-9]$ ]] || {
    printf 'a named Firestore database is required\n' >&2
    return 1
  }
  [[ "$PHASE2_PILOT_RUN_ID" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || {
    printf 'PHASE2_PILOT_RUN_ID is invalid\n' >&2
    return 1
  }
  [[ "$PHASE2_MAX_JOB_COST_MICROS" =~ ^[1-9][0-9]*$ \
    && "$PHASE2_MAX_JOB_COST_MICROS" -ge 80000 \
    && "$PHASE2_MAX_JOB_COST_MICROS" -le 250000 ]] || {
    printf 'PHASE2_MAX_JOB_COST_MICROS must be from 80000 through 250000\n' >&2
    return 1
  }
  [[ "$PHASE2_MAX_TOTAL_COST_MICROS" =~ ^[1-9][0-9]*$ \
    && "$PHASE2_MAX_TOTAL_COST_MICROS" -ge "$PHASE2_MAX_JOB_COST_MICROS" \
    && "$PHASE2_MAX_TOTAL_COST_MICROS" -le 5000000 ]] || {
    printf 'PHASE2_MAX_TOTAL_COST_MICROS must cover one job and be at most 5000000\n' >&2
    return 1
  }
  [[ "$PHASE2_MODEL" == 'gemini-3.1-flash-lite' ]] || {
    printf 'PHASE2_MODEL must be gemini-3.1-flash-lite\n' >&2
    return 1
  }
  [[ "$PHASE2_PRICEBOOK_VERSION" == 'vertex-gemini-2026-09-21' ]] || {
    printf 'PHASE2_PRICEBOOK_VERSION must be vertex-gemini-2026-09-21\n' >&2
    return 1
  }
  [[ "$PHASE2_VERTEX_LOCATION" == 'global' ]] || {
    printf 'PHASE2_VERTEX_LOCATION must be global\n' >&2
    return 1
  }
  [[ "$PHASE2_SOURCE_BUCKET" != "$PHASE2_ARTIFACT_BUCKET" ]] || {
    printf 'source and artifact buckets must be different\n' >&2
    return 1
  }
  for key in PHASE2_SOURCE_BUCKET PHASE2_ARTIFACT_BUCKET; do
    [[ "${!key}" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ \
      && "${!key}" != goog* && "${!key}" != *..* ]] || {
      printf '%s is not a safe GCS bucket name\n' "$key" >&2
      return 1
    }
  done
  local worker_url_re="^https://${PHASE2_WORKER_SERVICE}-([0-9]+)\\.${PHASE2_REGION}\\.run\\.app/internal/tasks/execute$"
  [[ "$PHASE2_WORKER_URL" =~ $worker_url_re ]] || {
    printf 'PHASE2_WORKER_URL must use the deterministic Cloud Run worker URL\n' >&2
    return 1
  }
  local worker_project_number="${BASH_REMATCH[1]}"
  local worker_audience="https://${PHASE2_WORKER_SERVICE}-${worker_project_number}.${PHASE2_REGION}.run.app"
  [[ "$PHASE2_WORKER_AUDIENCE" == "$worker_audience" ]] || {
    printf 'PHASE2_WORKER_AUDIENCE must exactly match the deterministic worker origin\n' >&2
    return 1
  }
  [[ "${PHASE2_WORKER_URL%/internal/tasks/execute}" == "$PHASE2_WORKER_AUDIENCE" ]] || {
    printf 'worker URL and audience origins must match\n' >&2
    return 1
  }
  local control_audience_re="^https://${PHASE2_CONTROL_SERVICE}-([0-9]+)\\.${PHASE2_REGION}\\.run\\.app$"
  [[ "$PHASE2_CONTROL_AUDIENCE" =~ $control_audience_re ]] || {
    printf 'PHASE2_CONTROL_AUDIENCE must use the deterministic Cloud Run control origin\n' >&2
    return 1
  }
  local control_project_number="${BASH_REMATCH[1]}"
  [[ "$control_project_number" == "$worker_project_number" ]] || {
    printf 'control and worker URLs must use the same project number\n' >&2
    return 1
  }
  [[ "${#PHASE2_CONTROL_SERVICE} + 1 + ${#control_project_number}" -le 63 \
    && "${#PHASE2_WORKER_SERVICE} + 1 + ${#worker_project_number}" -le 63 ]] || {
    printf 'Cloud Run service and project-number DNS segment exceeds 63 characters\n' >&2
    return 1
  }
  [[ "$PHASE2_CONTROL_AUDIENCE" != "$PHASE2_WORKER_AUDIENCE" ]] || {
    printf 'control and worker audiences must use different origins\n' >&2
    return 1
  }
  for key in PHASE2_CONTROL_SA PHASE2_WORKER_SA PHASE2_INTAKE_SA \
    PHASE2_SCHEDULER_SA PHASE2_TASK_INVOKER_SA; do
    [[ "${!key}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || {
      printf '%s is not a valid service-account ID\n' "$key" >&2
      return 1
    }
  done
  local -A seen_service_accounts=()
  for key in PHASE2_CONTROL_SA PHASE2_WORKER_SA PHASE2_INTAKE_SA \
    PHASE2_SCHEDULER_SA PHASE2_TASK_INVOKER_SA; do
    [[ -z "${seen_service_accounts[${!key}]:-}" ]] || {
      printf 'all runtime and caller service accounts must be different\n' >&2
      return 1
    }
    seen_service_accounts["${!key}"]="$key"
  done
  [[ "$PHASE2_INTAKE_SA" != "$PHASE2_SCHEDULER_SA" \
    && "$PHASE2_INTAKE_SA" != "$PHASE2_TASK_INVOKER_SA" \
    && "$PHASE2_SCHEDULER_SA" != "$PHASE2_TASK_INVOKER_SA" ]] || {
    printf 'intake, scheduler, and task caller service accounts must be different\n' >&2
    return 1
  }
  [[ "$PHASE2_ARTIFACT_REPOSITORY" =~ ^[a-z][a-z0-9._-]{2,254}$ ]] || {
    printf 'PHASE2_ARTIFACT_REPOSITORY is invalid\n' >&2
    return 1
  }
  local image_prefix="${PHASE2_REGION}-docker.pkg.dev/${PHASE2_PROJECT_ID}/${PHASE2_ARTIFACT_REPOSITORY}/"
  for key in PHASE2_CONTROL_IMAGE PHASE2_WORKER_IMAGE; do
    [[ "${!key}" == "$image_prefix"* && "${!key}" =~ @sha256:[0-9a-f]{64}$ ]] || {
      printf '%s must be a digest in the configured project Artifact Registry repository\n' "$key" >&2
      return 1
    }
  done
  if [[ -n "${PHASE2_NODE_BASE_IMAGE:-}" \
    && ! "$PHASE2_NODE_BASE_IMAGE" =~ ^node:24[^@]*@sha256:[0-9a-f]{64}$ ]]; then
    printf 'PHASE2_NODE_BASE_IMAGE must be an immutable sha256 digest reference\n' >&2
    return 1
  fi
}

render_manifests() {
  local output_dir="$1"
  local vars
  require_command envsubst
  mkdir -p "$output_dir"
  vars='$PHASE2_PROJECT_ID $PHASE2_REGION $PHASE2_CONTROL_SERVICE $PHASE2_WORKER_SERVICE $PHASE2_PILOT_RUN_ID $PHASE2_MAX_JOB_COST_MICROS $PHASE2_MAX_TOTAL_COST_MICROS $PHASE2_MODEL $PHASE2_PRICEBOOK_VERSION $PHASE2_VERTEX_LOCATION $PHASE2_FIRESTORE_DATABASE $PHASE2_SOURCE_BUCKET $PHASE2_ARTIFACT_BUCKET $PHASE2_CONTROL_IMAGE $PHASE2_WORKER_IMAGE $PHASE2_CONTROL_SA $PHASE2_WORKER_SA $PHASE2_INTAKE_SA $PHASE2_SCHEDULER_SA $PHASE2_TASK_INVOKER_SA $PHASE2_QUEUE $PHASE2_WORKER_URL $PHASE2_WORKER_AUDIENCE $PHASE2_CONTROL_AUDIENCE'
  envsubst "$vars" < "$phase2_dir/manifests/control.service.yaml" > "$output_dir/control.service.yaml"
  envsubst "$vars" < "$phase2_dir/manifests/worker.service.yaml" > "$output_dir/worker.service.yaml"
}

sa_email() {
  printf '%s@%s.iam.gserviceaccount.com' "$1" "$PHASE2_PROJECT_ID"
}

assert_run_service_absent() {
  local service="$1"
  assert_command_resource_absent "Cloud Run service $service" \
    gcloud run services describe "$service" \
      --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" \
      --format='value(metadata.name)'
}

assert_command_resource_absent() {
  local label="$1"
  shift
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'resource must be absent for inert baseline: %s\n' "$label" >&2
    return 1
  fi
  if ! grep -Eiq 'not[ _-]?found|does not exist|404' <<<"$output"; then
    printf 'could not prove resource is absent: %s\n%s\n' "$label" "$output" >&2
    return 1
  fi
}

assert_phase2_managed_resources_absent() {
  assert_run_service_absent "$PHASE2_CONTROL_SERVICE"
  assert_run_service_absent "$PHASE2_WORKER_SERVICE"
  assert_command_resource_absent "Cloud Tasks queue $PHASE2_QUEUE" \
    gcloud tasks queues describe "$PHASE2_QUEUE" \
      --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION"
  assert_command_resource_absent "Scheduler job $PHASE2_SCHEDULER_JOB" \
    gcloud scheduler jobs describe "$PHASE2_SCHEDULER_JOB" \
      --project="$PHASE2_PROJECT_ID" --location="$PHASE2_REGION"
  local bucket
  for bucket in "$PHASE2_SOURCE_BUCKET" "$PHASE2_ARTIFACT_BUCKET"; do
    assert_command_resource_absent "GCS bucket $bucket" \
      gcloud storage buckets describe "gs://$bucket"
  done
  local account
  for account in "$PHASE2_CONTROL_SA" "$PHASE2_WORKER_SA" \
    "$PHASE2_INTAKE_SA" "$PHASE2_SCHEDULER_SA" "$PHASE2_TASK_INVOKER_SA"; do
    assert_command_resource_absent "service account $(sa_email "$account")" \
      gcloud iam service-accounts describe "$(sa_email "$account")" \
        --project="$PHASE2_PROJECT_ID"
  done
}

read_phase2_project_number() {
  local project_number
  project_number="$(gcloud projects describe "$PHASE2_PROJECT_ID" \
    --format='value(projectNumber)')"
  [[ "$project_number" =~ ^[0-9]+$ ]] || {
    printf 'configured project did not return a numeric project number\n' >&2
    return 1
  }
  printf '%s' "$project_number"
}

assert_deterministic_cloud_run_urls() {
  local project_number="$1"
  [[ "$project_number" =~ ^[0-9]+$ ]] || {
    printf 'project number must be numeric\n' >&2
    return 1
  }
  local control_host="${PHASE2_CONTROL_SERVICE}-${project_number}"
  local worker_host="${PHASE2_WORKER_SERVICE}-${project_number}"
  [[ "${#control_host}" -le 63 && "${#worker_host}" -le 63 ]] || {
    printf 'Cloud Run service and project-number DNS segment exceeds 63 characters\n' >&2
    return 1
  }
  local expected_control="https://${control_host}.${PHASE2_REGION}.run.app"
  local expected_worker="https://${worker_host}.${PHASE2_REGION}.run.app"
  [[ "$PHASE2_CONTROL_AUDIENCE" == "$expected_control" ]] || {
    printf 'control audience does not match the project deterministic URL\n' >&2
    return 1
  }
  [[ "$PHASE2_WORKER_AUDIENCE" == "$expected_worker" \
    && "$PHASE2_WORKER_URL" == "$expected_worker/internal/tasks/execute" ]] || {
    printf 'worker audience or route does not match the project deterministic URL\n' >&2
    return 1
  }
}

assert_artifact_registry_repository_description() {
  local description="$1"
  local expected_name="projects/${PHASE2_PROJECT_ID}/locations/${PHASE2_REGION}/repositories/${PHASE2_ARTIFACT_REPOSITORY}"
  local status=0
  node -e '
    const repository = JSON.parse(process.argv[1]);
    if (repository?.name !== process.argv[2]) process.exit(2);
    if (repository?.format !== "DOCKER") process.exit(3);
  ' "$description" "$expected_name" || status=$?
  if [[ "$status" -eq 2 ]]; then
    printf 'Artifact Registry repository project, region, or name mismatch\n' >&2
    return 1
  fi
  if [[ "$status" -eq 3 ]]; then
    printf 'Artifact Registry repository is not Docker format\n' >&2
    return 1
  fi
  if [[ "$status" -ne 0 ]]; then
    printf 'Artifact Registry repository response could not be verified\n' >&2
    return 1
  fi
}

assert_artifact_registry_image_description() {
  local expected_image="$1"
  local description="$2"
  local status=0
  node -e '
    const response = JSON.parse(process.argv[1]);
    const expected = process.argv[2];
    const expectedRegistry = process.argv[3];
    const expectedProject = process.argv[4];
    const expectedRepository = process.argv[5];
    const pattern = /^([^/]+)\/([^/]+)\/([^/]+)\/(.+)@(sha256:[0-9a-f]{64})$/;
    const expectedParts = expected.match(pattern);
    const returned = response?.image_summary?.fully_qualified_digest;
    const returnedParts = typeof returned === "string" ? returned.match(pattern) : null;
    if (!expectedParts || !returnedParts) process.exit(2);
    const [, expectedHost, expectedProjectPart, expectedRepo, expectedPackage, expectedDigest] = expectedParts;
    const [, returnedHost, returnedProject, returnedRepo, returnedPackage, returnedDigest] = returnedParts;
    if (expectedHost !== expectedRegistry || expectedProjectPart !== expectedProject
      || expectedRepo !== expectedRepository || expectedPackage.length === 0) process.exit(3);
    if (returned !== expected || returnedHost !== expectedRegistry
      || returnedProject !== expectedProject || returnedRepo !== expectedRepository
      || returnedPackage !== expectedPackage || returnedDigest !== expectedDigest) process.exit(4);
    if (response.image_summary.digest !== expectedDigest
      || response.image_summary.registry !== expectedRegistry
      || response.image_summary.repository !== expectedRepository) process.exit(5);
  ' "$description" "$expected_image" \
    "${PHASE2_REGION}-docker.pkg.dev" "$PHASE2_PROJECT_ID" \
    "$PHASE2_ARTIFACT_REPOSITORY" || status=$?
  if [[ "$status" -eq 2 ]]; then
    printf 'Artifact Registry image response lacks an exact digest reference\n' >&2
    return 1
  fi
  if [[ "$status" -eq 3 ]]; then
    printf 'configured image project, repository, package, or digest is invalid\n' >&2
    return 1
  fi
  if [[ "$status" -eq 4 ]]; then
    printf 'Artifact Registry returned image project, repository, package, or digest mismatch\n' >&2
    return 1
  fi
  if [[ "$status" -eq 5 ]]; then
    printf 'Artifact Registry image summary fields do not match the configured digest\n' >&2
    return 1
  fi
  if [[ "$status" -ne 0 ]]; then
    printf 'Artifact Registry image response could not be verified\n' >&2
    return 1
  fi
}

assert_artifact_registry_release_inputs() {
  local repository_description image image_description
  repository_description="$(gcloud artifacts repositories describe \
    "$PHASE2_ARTIFACT_REPOSITORY" --project="$PHASE2_PROJECT_ID" \
    --location="$PHASE2_REGION" --format=json)"
  assert_artifact_registry_repository_description "$repository_description"

  for image in "$PHASE2_CONTROL_IMAGE" "$PHASE2_WORKER_IMAGE"; do
    image_description="$(gcloud artifacts docker images describe "$image" \
      --project="$PHASE2_PROJECT_ID" --format=json)"
    assert_artifact_registry_image_description "$image" "$image_description"
  done
  printf 'Artifact Registry repository and both exact image digests verified\n'
}

assert_run_service_url_and_zero_traffic() {
  local service="$1"
  local expected_url="$2"
  local description
  description="$(gcloud run services describe "$service" \
    --project="$PHASE2_PROJECT_ID" --region="$PHASE2_REGION" --format=json)"
  local status=0
  node -e '
    const service = JSON.parse(process.argv[1]);
    const expected = process.argv[2];
    if (service?.status?.url !== expected) process.exit(2);
    const traffic = service?.status?.traffic ?? [];
    if (traffic.some((target) => !Object.hasOwn(target, "percent")
      || !Number.isFinite(Number(target.percent)) || Number(target.percent) !== 0)) process.exit(3);
  ' "$description" "$expected_url" || status=$?
  if [[ "$status" -eq 2 ]]; then
    printf 'Cloud Run status URL mismatch: %s\n' "$service" >&2
    return 1
  fi
  if [[ "$status" -eq 3 ]]; then
    printf 'Cloud Run service has nonzero traffic: %s\n' "$service" >&2
    return 1
  fi
  if [[ "$status" -ne 0 ]]; then
    printf 'Cloud Run service response could not be verified: %s\n' "$service" >&2
    return 1
  fi
}
