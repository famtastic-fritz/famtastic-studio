import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { agentTaskLogColumns, executionApplicationId } from '../server/kernel/durable-execution/index.js';
import {
  createExecutionFixture,
  seedSyntheticLegacy,
  stagingPacket,
  tableHash,
} from './helpers/durable-execution-fixture.js';

const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('durable execution schema', () => {
  it('is additive, idempotent, and implements the AgentTaskLog contract', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const first = fixture.openStore();
    expect(first.integrityCheck()).toBe('ok');
    first.close();

    const second = fixture.openStore();
    const db = second.rawDatabaseForTests();
    expect(db.prepare('SELECT COUNT(*) AS count FROM ExecutionMigrations').get().count).toBe(1);
    const actualColumns = new Set(db.prepare('PRAGMA table_info("AgentTaskLog")').all().map((row) => row.name));
    for (const column of agentTaskLogColumns()) expect(actualColumns.has(column)).toBe(true);
    expect(second.foreignKeyCheck()).toEqual([]);
  });

  it('does not reinterpret synthetic legacy jobs, schedules, or performance rows', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    seedSyntheticLegacy(fixture.dbPath);
    const before = {
      jobs: tableHash(fixture.dbPath, 'legacy_jobs'),
      schedules: tableHash(fixture.dbPath, 'schedules'),
      performance: tableHash(fixture.dbPath, 'performance_records'),
    };

    const store = fixture.openStore();
    expect(store.snapshotCounts().AgentTaskLog).toBe(0);
    store.close();
    expect({
      jobs: tableHash(fixture.dbPath, 'legacy_jobs'),
      schedules: tableHash(fixture.dbPath, 'schedules'),
      performance: tableHash(fixture.dbPath, 'performance_records'),
    }).toEqual(before);

    const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
    expect(db.prepare('SELECT COUNT(*) AS count FROM legacy_jobs').get().count).toBe(448);
    expect(db.prepare('SELECT COUNT(*) AS count FROM schedules').get().count).toBe(7);
    expect(db.prepare('SELECT COUNT(*) AS count FROM performance_records').get().count).toBe(3);
    db.close();
  });

  it('works with an existing exact AgentTaskLog contract without private extension columns', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const columns = agentTaskLogColumns().map((column) => (
      column === 'task_id' ? 'task_id TEXT PRIMARY KEY' : `"${column}"`
    ));
    const db = new DatabaseSync(fixture.dbPath);
    db.exec(`CREATE TABLE AgentTaskLog (${columns.join(', ')})`);
    db.close();

    const store = fixture.openStore();
    const accepted = store.acceptStagingPacket({ packet: stagingPacket(1), siteId: 'project-1' });
    expect(accepted.state).toBe('accepted');
    const actual = new Set(store.rawDatabaseForTests().prepare('PRAGMA table_info("AgentTaskLog")').all().map((row) => row.name));
    expect(actual.has('fallback_detail')).toBe(false);
    expect(actual.has('human_review_trigger')).toBe(false);
  });

  it('refuses a mismatched SQLite application id before adding schema', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const db = new DatabaseSync(fixture.dbPath);
    db.exec('PRAGMA application_id = 12345; CREATE TABLE untouched (id INTEGER PRIMARY KEY)');
    db.close();
    if (process.platform !== 'win32') fs.chmodSync(fixture.dbPath, 0o644);
    const modeBefore = fs.statSync(fixture.dbPath).mode & 0o777;
    expect(() => fixture.openStore()).toThrowError(expect.objectContaining({ code: 'execution_db_application_mismatch' }));

    const inspect = new DatabaseSync(fixture.dbPath, { readOnly: true });
    expect(inspect.prepare('PRAGMA application_id').get().application_id).toBe(12345);
    expect(inspect.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)).toEqual(['untouched']);
    inspect.close();
    expect(fs.statSync(fixture.dbPath).mode & 0o777).toBe(modeBefore);
  });

  it('marks the disposable database and restricts filesystem permissions', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    expect(store.rawDatabaseForTests().prepare('PRAGMA application_id').get().application_id).toBe(executionApplicationId());
    if (process.platform !== 'win32') {
      expect(fs.statSync(fixture.dbPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(fixture.executionRoot).mode & 0o777).toBe(0o700);
    }
  });

  it('rolls back new structures when an existing AgentTaskLog is incompatible', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const db = new DatabaseSync(fixture.dbPath);
    db.exec('CREATE TABLE AgentTaskLog (task_id TEXT PRIMARY KEY)');
    db.close();
    expect(() => fixture.openStore()).toThrow(/missing required columns/i);

    const inspect = new DatabaseSync(fixture.dbPath, { readOnly: true });
    const tables = inspect.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    expect(tables).toEqual(['AgentTaskLog']);
    expect(inspect.prepare('PRAGMA application_id').get().application_id).toBe(0);
    inspect.close();
  });
});
