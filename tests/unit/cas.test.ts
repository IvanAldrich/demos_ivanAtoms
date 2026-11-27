import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { openDb, type DB } from '../../src/lib/db';
import * as projects from '../../src/lib/repo/projects';
import * as versions from '../../src/lib/repo/versions';
import { casPublish, retainVersions, rollback } from '../../src/lib/cas';

let db: DB;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `ia-cas-${randomUUID()}.db`);
  db = openDb(dbPath);
});
afterEach(() => {
  db.close();
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(p); } catch { /* ignore */ }
  }
});

describe('casPublish', () => {
  it('swaps only when the expected pointer matches', () => {
    const p = projects.create(db, { slug: 's', idea: 'x', ownerToken: 't' });
    const v1 = versions.create(db, { projectId: p.id, n: 1 });
    const v2 = versions.create(db, { projectId: p.id, n: 2 });

    expect(casPublish(db, p.id, null, v1.id)).toBe(true);
    expect(casPublish(db, p.id, null, v2.id)).toBe(false);
    expect(projects.get(db, p.id)?.publishedVersionId).toBe(v1.id);
    expect(casPublish(db, p.id, v1.id, v2.id)).toBe(true);
    expect(projects.get(db, p.id)?.publishedVersionId).toBe(v2.id);
  });
});

describe('retainVersions', () => {
  it('keeps top N plus published', () => {
    const p = projects.create(db, { slug: 's2', idea: 'x', ownerToken: 't' });
    const vs = [1, 2, 3, 4, 5].map((n) => versions.create(db, { projectId: p.id, n }));
    casPublish(db, p.id, null, vs[1].id); // publish n=2 (outside top 3)

    const deleted = retainVersions(db, p.id, 3);
    const remaining = versions.listByProject(db, p.id).map((v) => v.n).sort((a, b) => a - b);
    expect(remaining).toEqual([2, 3, 4, 5]);
    expect(deleted).toHaveLength(1);
  });
});

describe('rollback', () => {
  it('points published at a prior version', () => {
    const p = projects.create(db, { slug: 's3', idea: 'x', ownerToken: 't' });
    const v1 = versions.create(db, { projectId: p.id, n: 1 });
    const v2 = versions.create(db, { projectId: p.id, n: 2 });
    casPublish(db, p.id, null, v2.id);
    expect(rollback(db, p.id, v1.id)).toBe(true);
    expect(projects.get(db, p.id)?.publishedVersionId).toBe(v1.id);
  });
});