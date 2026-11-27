import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { openDb, type DB } from '../../src/lib/db';
import * as projects from '../../src/lib/repo/projects';
import * as jobs from '../../src/lib/repo/jobs';
import * as events from '../../src/lib/repo/events';
import * as versions from '../../src/lib/repo/versions';

let db: DB;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `ia-${randomUUID()}.db`);
  db = openDb(dbPath);
});

afterEach(() => {
  db.close();
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      rmSync(p);
    } catch {
      /* ignore */
    }
  }
});

describe('repositories', () => {
  it('creates and lists projects by owner', () => {
    const p = projects.create(db, { slug: 's1', idea: 'todo app', ownerToken: 't1' });
    expect(projects.listByOwner(db, 't1').map((x) => x.id)).toContain(p.id);
    expect(projects.listByOwner(db, 't2')).toHaveLength(0);
  });

  it('enqueues and claims a job exactly once', () => {
    const p = projects.create(db, { slug: 's2', idea: 'x', ownerToken: 't1' });
    const v = versions.create(db, { projectId: p.id, n: 1 });
    const j = jobs.enqueue(db, { projectId: p.id, versionId: v.id, type: 'initial' });
    const c1 = jobs.claimNext(db);
    expect(c1?.id).toBe(j.id);
    expect(c1?.status).toBe('leased');
    expect(jobs.claimNext(db)).toBeNull();
  });

  it('supersedes queued iterate jobs per project', () => {
    const p = projects.create(db, { slug: 's4', idea: 'x', ownerToken: 't1' });
    const v1 = versions.create(db, { projectId: p.id, n: 1 });
    const v2 = versions.create(db, { projectId: p.id, n: 2 });
    const j1 = jobs.enqueue(db, { projectId: p.id, versionId: v1.id, type: 'iterate' });
    const j2 = jobs.enqueue(db, { projectId: p.id, versionId: v2.id, type: 'iterate' });
    const n = jobs.supersedeQueuedIterate(db, p.id, j2.id);
    expect(n).toBe(1);
    expect(jobs.get(db, j1.id)?.status).toBe('superseded');
    expect(jobs.get(db, j2.id)?.status).toBe('queued');
  });

  it('returns events after a cursor', () => {
    const p = projects.create(db, { slug: 's3', idea: 'x', ownerToken: 't1' });
    const v = versions.create(db, { projectId: p.id, n: 1 });
    const j = jobs.enqueue(db, { projectId: p.id, versionId: v.id, type: 'initial' });
    events.append(db, j.id, 'info', 'one');
    events.append(db, j.id, 'info', 'two');
    const all = events.since(db, j.id, 0);
    expect(all.map((e) => e.message)).toEqual(['one', 'two']);
    const after = events.since(db, j.id, all[0].id);
    expect(after.map((e) => e.message)).toEqual(['two']);
  });

  it('marks a version ready with container info', () => {
    const p = projects.create(db, { slug: 's5', idea: 'x', ownerToken: 't1' });
    const v = versions.create(db, { projectId: p.id, n: 1 });
    versions.setReady(db, v.id, {
      containerId: 'c1',
      containerIp: '172.18.0.5',
      containerPort: 3001,
    });
    const got = versions.get(db, v.id);
    expect(got?.status).toBe('ready');
    expect(got?.containerIp).toBe('172.18.0.5');
    expect(got?.containerPort).toBe(3001);
  });
});