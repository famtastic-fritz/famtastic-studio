function projectJournal({ store, journal, record }) {
  if (record.journal_projected_at_ms) return 'projected';
  try {
    const entry = journal.append({
      entry_id: `je_staging_${record.task_id}`,
      site_id: record.site_id,
      initiator: 'famtastic-drupal',
      intent: 'accept_selected_staging_packet',
      changes: [{ packet_id: record.packet_id, task_id: record.task_id, status: 'accepted_waiting_callback' }],
      result: { receipt_id: record.receipt_id, dispatch_state: 'pending', status: 'accepted_waiting_callback' },
      evidence: { idempotency_key: record.idempotency_key, packet_digest: record.packet_digest },
    });
    store.markJournalProjected(record.intent_id, entry.entry_id);
    return 'projected';
  } catch (error) {
    try { store.markJournalProjectionFailed(record.intent_id, error); } catch { /* durable acceptance remains authoritative */ }
    return 'pending';
  }
}

function projectEvent({ store, events, record }) {
  if (record.event_projected_at_ms) return 'projected';
  try {
    const event = events.emit({
      type: 'site_studio.staging_accepted',
      site_id: record.site_id,
      idempotency_key: `staging-accepted:${record.idempotency_key}`,
      payload: {
        packet_id: record.packet_id,
        request_id: record.request_id,
        project_id: record.project_id,
        task_id: record.task_id,
        status: 'accepted_waiting_callback',
      },
    });
    store.markEventProjected(record.intent_id, event.event_id);
    return 'projected';
  } catch (error) {
    try { store.markEventProjectionFailed(record.intent_id, error); } catch { /* durable acceptance remains authoritative */ }
    return 'pending';
  }
}

export function projectAcceptance({ store, journal, events, record }) {
  return {
    journal: projectJournal({ store, journal, record }),
    event: projectEvent({ store, events, record }),
  };
}

export function reconcileAcceptanceProjections({ store, journal, events, limit = 25 }) {
  return store.listPendingAcceptanceProjections({ limit }).map((record) => ({
    job_id: record.job_id,
    ...projectAcceptance({ store, journal, events, record }),
  }));
}
