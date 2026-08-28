// Build DNA (plan 2.7, decision 7; replay manifest per amendment A4).
//
// One JSON file per run under the `dna` root, keyed by run_id. Recording is
// automatic and unconditional (dna-capture skill, decision D7): a stage that
// runs without a recordStage() call is a defect, not a gap. recordStage() must
// be called on failure and on retry exactly the same as on success, and each
// call appends a new stage execution rather than mutating a prior one, so a
// failed stage stays visible and locatable, and can be retried at stage level
// only (a new recordStage() call with retry_of set) without ever re-running
// startRun() for the whole pipeline.
//
// Rerun definition (A4, binding): a rerun succeeds when the SAME resolved
// stage graph executes against NEW declared inputs and every stage reaches
// its verification requirement. Byte-identical model output is never the
// assertion — see isVerifiedRerun() below, which checks graph shape and
// verification outcome only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA_VERSION = 1;

export function sha256Hex(value) {
  const buf = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function createDna({ paths }) {
  const fileFor = (runId) => paths.within('dna', `${runId}.json`);

  function writeRecord(record) {
    paths.ensure('dna');
    fs.writeFileSync(fileFor(record.run_id), JSON.stringify(record, null, 2));
    return record;
  }

  function readRaw(runId) {
    const file = fileFor(runId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  // startRun(): opens the per-run record and seeds the replay manifest with
  // everything known up front. Fields the caller cannot know yet (per-stage
  // prompt snapshots, external assets, actual usage) are filled in as
  // recordStage() calls arrive.
  // Derives elapsed ms from two ISO timestamps; null when either is missing or
  // unparseable, never a fabricated zero.
  function durationFrom(startedAt, finishedAt) {
    if (!startedAt || !finishedAt) return null;
    const t0 = Date.parse(startedAt);
    const t1 = Date.parse(finishedAt);
    if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
    return t1 - t0;
  }

  function startRun({
    started_at = null,
    site_id = null,
    recipe_ref = null,
    research_packet_ref = null,
    source_commit,
    tree_hash,
    recipe_snapshot = null,
    stage_graph = [],
    model_tool_versions = {},
  } = {}) {
    if (!source_commit) throw fail(400, 'dna_source_commit_required', 'startRun requires source_commit');
    if (!tree_hash) throw fail(400, 'dna_tree_hash_required', 'startRun requires tree_hash');
    if (!Array.isArray(stage_graph) || stage_graph.length === 0) {
      throw fail(400, 'dna_stage_graph_required', 'startRun requires a non-empty ordered stage_graph');
    }

    const run_id = newId('run');
    const record = {
      run_id,
      schema_version: SCHEMA_VERSION,
      site_id,
      recipe_ref,
      research_packet_ref,
      // The caller may pass the TRUE run start. The pipeline runs research
      // before startRun (so research_packet_ref is known at open and never
      // mutated), which meant the record's own started_at excluded the single
      // most expensive stage: a 113s run reported itself as 1.09s. Any
      // efficiency measurement built on that number would be wrong.
      started_at: started_at || new Date().toISOString(),
      finished_at: null,
      outcome: null,
      operator_interventions: [],
      retro: null,
      replay_manifest: {
        schema_version: SCHEMA_VERSION,
        source_commit,
        tree_hash,
        recipe_snapshot,
        recipe_snapshot_hash: recipe_snapshot ? sha256Hex(recipe_snapshot) : null,
        prompt_snapshots: {},
        stage_graph,
        model_tool_versions,
        external_assets: [],
      },
      stages: [],
    };
    writeRecord(record);
    return { run_id, record };
  }

  // recordStage(): unconditional. Call this for every stage execution,
  // success or failure, first attempt or retry. It never overwrites a prior
  // stage execution — it appends a new one, so the full attempt history
  // (including failures) stays inspectable and each failed attempt stays
  // individually retryable without touching the run as a whole.
  function recordStage({
    run_id,
    stage,
    retry_of = null,
    prompt_template = null,
    prompt_snapshot = null,
    model = null,
    agent = null,
    // Provenance for the routing decision: 'recipe' when the recipe named the
    // brain for this stage, 'default' when the routing table supplied it. The
    // pipeline has always computed this; recordStage silently dropped it,
    // which defeated the entire point of resolveStageRouting recording it.
    routing_source = null,
    inputs = [],
    outputs = [],
    duration_ms = null,
    cost_estimate = null,
    usage = null,
    verification = null,
    verifier_version = null,
    evidence_ref = null,
    status,
    error = null,
    external_assets = [],
    started_at = null,
    finished_at = new Date().toISOString(),
  }) {
    if (!run_id) throw fail(400, 'dna_run_id_required', 'recordStage requires run_id');
    if (!stage) throw fail(400, 'dna_stage_required', 'recordStage requires stage');
    if (!status) throw fail(400, 'dna_status_required', 'recordStage requires status (success | failed | retrying)');

    const record = readRaw(run_id);
    if (!record) throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${run_id}`);

    if (retry_of) {
      const prior = record.stages.find((s) => s.attempt_id === retry_of);
      if (!prior) throw fail(400, 'dna_retry_of_unknown', `retry_of references an unknown attempt_id: ${retry_of}`);
    }

    const inputRefs = inputs.map((i) => ({ ref: i.ref, sha256: i.sha256 ?? (i.content !== undefined ? sha256Hex(i.content) : null) }));
    const outputRefs = outputs.map((o) => ({ ref: o.ref, sha256: o.sha256 ?? (o.content !== undefined ? sha256Hex(o.content) : null) }));

    const attempt = {
      attempt_id: newId('att'),
      retry_of,
      stage,
      prompt_template,
      prompt_snapshot,
      prompt_snapshot_hash: prompt_snapshot !== null ? sha256Hex(prompt_snapshot) : null,
      model,
      agent,
      inputs: inputRefs,
      inputs_hash: inputRefs.length ? sha256Hex(inputRefs) : null,
      outputs: outputRefs,
      outputs_ref: outputRefs.length ? outputRefs.map((o) => o.ref) : [],
      // duration_ms was declared in the schema and never populated, so every
      // stage record carried null and any duration analysis had to re-derive it
      // from the timestamps. Derive it here, once, at the point of record.
      duration_ms: duration_ms ?? durationFrom(started_at, finished_at),
      routing_source,
      cost_estimate,
      usage,
      verification,
      verifier_version,
      evidence_ref,
      status,
      error,
      started_at,
      finished_at,
    };

    record.stages.push(attempt);

    // Snapshot the resolved prompt into the manifest per stage name (last
    // write wins; a stage retried with a changed prompt records the prompt
    // that actually ran on the most recent attempt).
    if (prompt_snapshot !== null) {
      record.replay_manifest.prompt_snapshots[stage] = {
        prompt: prompt_snapshot,
        hash: attempt.prompt_snapshot_hash,
      };
    }

    for (const asset of external_assets) {
      if (!record.replay_manifest.external_assets.some((a) => a.id === asset.id)) {
        record.replay_manifest.external_assets.push(asset);
      }
    }

    writeRecord(record);
    return attempt;
  }

  function finishRun({ run_id, outcome, operator_interventions = [], retro = null }) {
    if (!run_id) throw fail(400, 'dna_run_id_required', 'finishRun requires run_id');
    if (!outcome) throw fail(400, 'dna_outcome_required', 'finishRun requires outcome');
    const record = readRaw(run_id);
    if (!record) throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${run_id}`);
    record.outcome = outcome;
    record.operator_interventions = operator_interventions;
    record.retro = retro;
    record.finished_at = new Date().toISOString();
    writeRecord(record);
    appendEfficiencyLog(record);
    return record;
  }

  /**
   * Standing efficiency telemetry: one append-only line per finished run.
   *
   * The full DNA record already holds everything, but answering "are builds
   * getting slower?" from it means opening every run file. This is the flat
   * series that makes drift visible without an audit -- which is the whole
   * point, since the last efficiency pass found a 113s run recorded as 1.09s
   * and nobody had noticed.
   *
   * Never throws: telemetry failing must not fail a build that already
   * succeeded. A lost line is a lost line.
   */
  function appendEfficiencyLog(record) {
    try {
      const stages = Array.isArray(record.stages) ? record.stages : [];
      const durations = {};
      let premium = 0;
      for (const st of stages) {
        durations[st.stage] = st.duration_ms ?? null;
        if (st.model && st.model !== 'none') premium += 1;
      }
      const line = {
        ts: record.finished_at,
        run_id: record.run_id,
        site_id: record.site_id,
        outcome: record.outcome?.status || record.outcome || null,
        total_ms: record.started_at && record.finished_at
          ? Date.parse(record.finished_at) - Date.parse(record.started_at)
          : null,
        stage_ms: durations,
        stage_count: stages.length,
        retry_count: stages.filter((st) => st.retry_of).length,
        premium_stage_count: premium,
        // Dollars we can actually attest to. Stages on a subscription CLI
        // report did-not-report, and those are counted separately rather than
        // silently added as zero.
        reported_cost_usd: stages.reduce((a, st) => a + (typeof st.cost_estimate?.amount_usd === 'number' ? st.cost_estimate.amount_usd : 0), 0),
        unreported_cost_stage_count: stages.filter((st) => typeof st.cost_estimate?.status === 'string' && st.cost_estimate.status.startsWith('provider_did_not_report')).length,
      };
      const dir = paths.ensure('dna');
      fs.appendFileSync(path.join(dir, 'efficiency.jsonl'), `${JSON.stringify(line)}\n`);
    } catch {
      // Intentionally swallowed: see the note above. A telemetry write must
      // never turn a successful build into a failed one.
    }
  }

  function read(runId) {
    return readRaw(runId);
  }

  // Convenience for stage-level retry/locate: every failed attempt across the
  // run's full history, most recent first per stage.
  function failedStages(runId) {
    const record = readRaw(runId);
    if (!record) return [];
    return record.stages.filter((s) => s.status === 'failed');
  }

  function list() {
    paths.ensure('dna');
    const dir = paths.root('dna');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(paths.within('dna', f), 'utf8')))
      .map((r) => ({
        run_id: r.run_id,
        site_id: r.site_id,
        recipe_ref: r.recipe_ref,
        outcome: r.outcome,
        started_at: r.started_at,
        finished_at: r.finished_at,
        stage_count: r.stages.length,
        outcome_capture: r.outcome_capture || null,
        // The Builds runs table has always rendered row.duration_ms and this
        // list never sent it, so that column was permanently blank. Cost is
        // added alongside for the same reason: efficiency drift has to be
        // visible in the console, not discovered in an audit.
        duration_ms: r.started_at && r.finished_at
          ? Date.parse(r.finished_at) - Date.parse(r.started_at)
          : null,
        reported_cost_usd: r.stages.reduce((a, st) => a + (typeof st.cost_estimate?.amount_usd === 'number' ? st.cost_estimate.amount_usd : 0), 0),
        unreported_cost_stage_count: r.stages.filter((st) => typeof st.cost_estimate?.status === 'string' && st.cost_estimate.status.startsWith('provider_did_not_report')).length,
        premium_stage_count: r.stages.filter((st) => st.model && st.model !== 'none').length,
      }))
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  }

  // ---- Outcome capture (Rung 3 ground truth) -------------------------------
  //
  // Telemetry records what a run DID. Nothing recorded whether the result was
  // any good, so a suggestion layer built on it could only recommend cheaper and
  // faster -- which optimizes toward worse sites. This is the operator's verdict,
  // the only ground truth for proof quality that matters commercially.
  //
  // 'pending' is the honest default and is never inferred away: an unreviewed
  // build must not read as an accepted one.
  const OPERATOR_DECISIONS = Object.freeze(['pending', 'shipped', 'edited_then_shipped', 'rejected']);

  function setOutcome({ run_id, site_id, operator_decision, customer_selected_direction = undefined, note = null, decided_by = 'console' }) {
    if (!run_id) throw fail(400, 'dna_run_id_required', 'setOutcome requires run_id');
    if (!OPERATOR_DECISIONS.includes(operator_decision)) {
      throw fail(400, 'dna_invalid_decision', `operator_decision must be one of ${OPERATOR_DECISIONS.join(', ')}`);
    }
    const record = readRaw(run_id);
    if (!record) throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${run_id}`);
    // A1: a run is only addressable through the identity it was created under.
    if (site_id && record.site_id !== site_id) {
      throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${run_id}`);
    }

    const previous = record.outcome_capture || null;
    record.outcome_capture = {
      operator_decision,
      // Only overwritten when explicitly supplied, so recording a decision does
      // not silently erase a direction Designs already knew.
      customer_selected_direction: customer_selected_direction === undefined
        ? (previous?.customer_selected_direction ?? null)
        : customer_selected_direction,
      note,
      decided_by,
      decided_at: new Date().toISOString(),
      // Kept, not replaced: a build that was rejected and later shipped after
      // edits is a different and more useful signal than one shipped outright.
      history: [...(previous?.history || []), ...(previous ? [{ operator_decision: previous.operator_decision, decided_at: previous.decided_at, decided_by: previous.decided_by }] : [])],
    };
    writeRecord(record);
    return record.outcome_capture;
  }

  return { startRun, recordStage, finishRun, read, list, failedStages, setOutcome, OPERATOR_DECISIONS };
}
