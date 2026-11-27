import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { openDb, type DB } from '../../src/lib/db';
import * as projects from '../../src/lib/repo/projects';
import * as versions from '../../src/lib/repo/versions';
import * as jobs from '../../src/lib/repo/jobs';
import { selectNextJob, requeueExpired } from '../../src/worker/queue';

let db: DB;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `ia-q-${randomUUID()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  db.close();
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(p); } catch { /* ignore */ }
  }
});

function seedProject() {
  const p = projects.create(db, { slug: `s-${randomUUID()}`, idea: 'x', ownerToken: 't' });
  const v1 = versions.create(db, { projectId: p.id, n: 1 });
  const v2 = versions.create(db, { projectId: p.id, n: 2 });
  return { p, v1, v2 };
}

describe('selectNextJob', () => {
  it('runs a project serially and returns the next job after the active one completes', () => {
    const { p, v1, v2 } = seedProject();
    const j1 = jobs.enqueue(db, { projectId: p.id, versionId: v1.id, type: 'iterate' });
    const j2 = jobs.enqueue(db, { projectId: p.id, versionId: v2.id, type: 'iterate' });

    const first = selectNextJob(db);
    expect(first?.id).toBe(j1.id);
    expect(first?.status).toBe('leased');

    // project now has an active job → no new job selected
    expect(selectNextJob(db)).toBeNull();

    jobs.setStatus(db, j1.id, 'done');
    const second = selectNextJob(db);
    expect(second?.id).toBe(j2.id);
  });
});

describe('requeueExpired', () => {
  it('returns an expired lease to the queue', () => {
    const { p, v1 } = seedProject();
    jobs.enqueue(db, { projectId: p.id, versionId: v1.id, type: 'initial' });
    const claimed = selectNextJob(db, -1); // lease already expired
    expect(claimed?.status).toBe('leased');

    const n = requeueExpired(db);
    expect(n).toBe(1);
    const again = selectNextJob(db);
    expect(again?.id).toBe(claimed?.id);
  });
});