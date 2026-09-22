#!/usr/bin/env bash
set -euo pipefail

phase2_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$phase2_dir/../../.." && pwd)"

for script in "$phase2_dir"/scripts/*.sh; do
  bash -n "$script"
done

for dockerfile in "$phase2_dir"/containers/*.Dockerfile; do
  rg -q '^ARG NODE_BASE_IMAGE$' "$dockerfile"
  rg -q '^FROM \$\{NODE_BASE_IMAGE\}$' "$dockerfile"
  rg -q '^USER node$' "$dockerfile"
done

bootstrap_cli="$repo_root/scripts/bootstrap-durable-execution-phase2.mjs"
[[ -f "$bootstrap_cli" ]] || {
  printf 'paused-only Phase 2 bootstrap CLI is missing: %s\n' "$bootstrap_cli" >&2
  exit 1
}
node --check "$bootstrap_cli"
rg -q "PHASE2_BOOTSTRAP_GATE = 'BOOTSTRAP_PAUSED_PHASE2_PILOT'" "$bootstrap_cli" || {
  printf 'Phase 2 bootstrap CLI exact gate changed\n' >&2
  exit 1
}
pause_cli="$repo_root/scripts/pause-durable-execution-phase2.mjs"
[[ -f "$pause_cli" ]] || {
  printf 'pause-only Phase 2 operator CLI is missing: %s\n' "$pause_cli" >&2
  exit 1
}
node --check "$pause_cli"
rg -q "PHASE2_PAUSE_GATE = 'PAUSE_PHASE2_SHADOW'" "$pause_cli" || {
  printf 'Phase 2 pause CLI exact gate changed\n' >&2
  exit 1
}
rg -q "event: 'phase2_persistent_pause_verified'" "$pause_cli" || {
  printf 'Phase 2 pause CLI verified receipt changed\n' >&2
  exit 1
}
rg -q '^run_persistent_pause$' "$phase2_dir/scripts/stop.sh" || {
  printf 'Phase 2 stop does not call the persistent pause path\n' >&2
  exit 1
}
queue_stop_line="$(rg -n "^run_containment 'queue paused'" \
  "$phase2_dir/scripts/stop.sh" | cut -d: -f1)"
scheduler_stop_line="$(rg -n "^run_containment 'scheduler paused or absent'" \
  "$phase2_dir/scripts/stop.sh" | cut -d: -f1)"
pause_stop_line="$(rg -n '^run_persistent_pause$' \
  "$phase2_dir/scripts/stop.sh" | cut -d: -f1)"
iam_stop_line="$(rg -n "^run_containment 'control queue enqueuer revoked'" \
  "$phase2_dir/scripts/stop.sh" | cut -d: -f1)"
[[ "$queue_stop_line" -lt "$scheduler_stop_line" \
  && "$scheduler_stop_line" -lt "$pause_stop_line" \
  && "$pause_stop_line" -lt "$iam_stop_line" ]] || {
  printf 'Phase 2 containment order must pause queue, Scheduler, controls, then IAM\n' >&2
  exit 1
}
rg -q 'assert_phase2_managed_resources_absent' "$phase2_dir/scripts/apply-inert.sh"
rg -q 'assert_phase2_managed_resources_absent' "$phase2_dir/scripts/plan.sh"
rg -q 'assert_run_service_url_and_zero_traffic' "$phase2_dir/scripts/apply-inert.sh"
rg -q 'read_phase2_project_number' "$phase2_dir/scripts/plan.sh"
rg -q 'read_phase2_project_number' "$phase2_dir/scripts/apply-inert.sh"
rg -q 'assert_artifact_registry_release_inputs' "$phase2_dir/scripts/plan.sh"
rg -q 'assert_artifact_registry_release_inputs' "$phase2_dir/scripts/apply-inert.sh"
preflight_line="$(rg -n '^[[:space:]]*assert_artifact_registry_release_inputs$' \
  "$phase2_dir/scripts/apply-inert.sh" | cut -d: -f1)"
first_mutation_line="$(rg -n '^[[:space:]]*gcloud services enable' \
  "$phase2_dir/scripts/apply-inert.sh" | cut -d: -f1)"
firestore_preflight_line="$(rg -n '^[[:space:]]*gcloud firestore databases describe' \
  "$phase2_dir/scripts/apply-inert.sh" | cut -d: -f1)"
emulator_guard_line="$(rg -n '^[[:space:]]*if \[\[ -n "\$\{FIRESTORE_EMULATOR_HOST:-\}" \]\]; then$' \
  "$phase2_dir/scripts/apply-inert.sh" | cut -d: -f1)"
create_only_blocker_line="$(rg -n '^refuse_unproven_cloud_run_create$' \
  "$phase2_dir/scripts/apply-inert.sh" | cut -d: -f1)"
first_cloud_call_line="$(rg -n '^[[:space:]]*gcloud auth application-default print-access-token' \
  "$phase2_dir/scripts/apply-inert.sh" | cut -d: -f1)"
[[ "$preflight_line" -lt "$first_mutation_line" ]] || {
  printf 'Artifact Registry preflight must precede the first apply mutation\n' >&2
  exit 1
}
[[ "$firestore_preflight_line" -lt "$first_mutation_line" ]] || {
  printf 'named Firestore database preflight must precede the first apply mutation\n' >&2
  exit 1
}
[[ "$emulator_guard_line" -lt "$first_mutation_line" ]] || {
  printf 'Firestore emulator guard must precede the first apply mutation\n' >&2
  exit 1
}
[[ "$create_only_blocker_line" -lt "$first_cloud_call_line" \
  && "$create_only_blocker_line" -lt "$first_mutation_line" ]] || {
  printf 'create-only Cloud Run blocker must precede every apply cloud call and mutation\n' >&2
  exit 1
}
rg -Fq -- "--headers='Content-Type=application/json' --message-body='{}'" \
  "$phase2_dir/README.md"
rg -q -- '--oidc-token-audience="\$PHASE2_CONTROL_AUDIENCE"' \
  "$phase2_dir/README.md"

(
  set -a
  source "$phase2_dir/env.example"
  set +a
  source "$phase2_dir/scripts/common.sh"
  require_phase2_env
  assert_deterministic_cloud_run_urls 123456789012
  repository_fixture='{"name":"projects/example-project/locations/us-central1/repositories/studio-phase2","format":"DOCKER"}'
  control_fixture='{"image_summary":{"digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fully_qualified_digest":"us-central1-docker.pkg.dev/example-project/studio-phase2/control@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","registry":"us-central1-docker.pkg.dev","repository":"studio-phase2"}}'
  assert_artifact_registry_repository_description "$repository_fixture"
  assert_artifact_registry_image_description "$PHASE2_CONTROL_IMAGE" "$control_fixture"
  for mismatch_fixture in \
    "${control_fixture//\/control@/\/wrong-package@}" \
    "${control_fixture//example-project/other-project}" \
    "${control_fixture//studio-phase2\/control/other-repository\/control}" \
    "${control_fixture//sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd}"; do
    if assert_artifact_registry_image_description \
      "$PHASE2_CONTROL_IMAGE" "$mismatch_fixture" >/dev/null 2>&1; then
      printf 'Artifact Registry image identity mismatch was accepted\n' >&2
      exit 1
    fi
  done
  wrong_location_fixture="${repository_fixture//locations\/us-central1/locations\/europe-west1}"
  if assert_artifact_registry_repository_description \
    "$wrong_location_fixture" >/dev/null 2>&1; then
    printf 'Artifact Registry repository location mismatch was accepted\n' >&2
    exit 1
  fi
  PHASE2_CONTROL_AUDIENCE="${PHASE2_CONTROL_AUDIENCE}/"
  if require_phase2_env >/dev/null 2>&1; then
    printf 'trailing-slash control audience was accepted\n' >&2
    exit 1
  fi
)

bash "$phase2_dir/scripts/validate-yaml.sh" \
  "$phase2_dir/resource-intent.yaml" \
  "$phase2_dir/source-boundaries.yaml" \
  "$phase2_dir/manifests/control.service.yaml" \
  "$phase2_dir/manifests/worker.service.yaml"

mapfile -t required_runtime_env < <(
  node --input-type=module -e \
    'const { PHASE2_ENV } = await import(`file://${process.argv[1]}`); console.log(Object.values(PHASE2_ENV).join("\n"));' \
    "$repo_root/server/kernel/durable-execution/phase2/config.js"
)
declare -A expected_runtime_env=()
for key in "${required_runtime_env[@]}"; do
  expected_runtime_env["$key"]=1
done
for manifest in "$phase2_dir"/manifests/*.service.yaml; do
  for key in "${required_runtime_env[@]}"; do
    rg -q -- "- name: $key" "$manifest" || {
      printf '%s is missing runtime environment key %s\n' "$manifest" "$key" >&2
      exit 1
    }
  done
  mapfile -t declared_runtime_env < <(
    sed -n 's/^[[:space:]]*- name: \(FAMTASTIC_[A-Z0-9_]*\|GOOGLE_CLOUD_PROJECT\)$/\1/p' "$manifest"
  )
  for key in "${declared_runtime_env[@]}"; do
    [[ -n "${expected_runtime_env[$key]:-}" ]] || {
      printf '%s declares unknown runtime environment key %s\n' "$manifest" "$key" >&2
      exit 1
    }
  done
done

for key in "${required_runtime_env[@]}"; do
  rg -q -- "$key" "$phase2_dir/README.md" || {
    printf 'README runtime contract is missing environment key %s\n' "$key" >&2
    exit 1
  }
  rg -q -- "$key=" "$phase2_dir/scripts/apply-inert.sh" || {
    printf 'apply script is missing runtime environment key %s\n' "$key" >&2
    exit 1
  }
done

for fixed in \
  'FAMTASTIC_EXECUTION_MODE=cloud-shadow' \
  'FAMTASTIC_EXECUTION_SCOPE=phase2-pilot' \
  'FAMTASTIC_PHASE2_RUNTIME=1' \
  'FAMTASTIC_PHASE2_MAX_JOBS=20' \
  'FAMTASTIC_PHASE2_MODEL=gemini-3.1-flash-lite' \
  'FAMTASTIC_PHASE2_PRICEBOOK_VERSION=vertex-gemini-2026-09-21' \
  'FAMTASTIC_PHASE2_VERTEX_LOCATION=global'; do
  rg -q -- "$fixed" "$phase2_dir/README.md" "$phase2_dir/scripts/apply-inert.sh" || {
    printf 'fixed runtime contract is missing: %s\n' "$fixed" >&2
    exit 1
  }
done

if rg -n -i 'dispatcher|PHASE2_OPERATOR_MEMBER|PHASE2_SCHEDULER_INVOKER_SA' \
  --glob '!**/validate.sh' \
  "$phase2_dir" "$repo_root/docs/architecture/phase2-cloud-shadow.md"; then
  printf 'retired Phase 2 identity name found\n' >&2
  exit 1
fi

if rg -n 'roles/storage.objectUser|roles/storage.objectAdmin' \
  --glob '!**/validate.sh' "$phase2_dir/scripts"; then
  printf 'storage role with delete authority found\n' >&2
  exit 1
fi

if rg -n 'allUsers|allAuthenticatedUsers|run.googleapis.com/ingress: all' \
  --glob '!**/validate.sh' "$phase2_dir"; then
  printf 'public access marker found\n' >&2
  exit 1
fi

em_dash=$'\u2014'
if rg -n "$em_dash" \
  "$phase2_dir" "$repo_root/docs/architecture/phase2-cloud-shadow.md"; then
  printf 'em dash found\n' >&2
  exit 1
fi

printf 'phase2 local validation passed\n'
