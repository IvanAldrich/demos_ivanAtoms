import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { openDb } from '../../src/lib/db';
import * as projects from '../../src/lib/repo/projects';
import * as versions from '../../src/lib/repo/versions';
import { buildVersion, runVersion, stopContainer, containerAlive } from '../../src/sandbox/docker';
import { reviveMissing } from '../../src/worker/revive';

const IMAGE = process.env.SANDBOX_IMAGE ?? 'ivanatoms/base:node22';
const SERVER = `const express=require('express');const app=express();app.get('/',(q,s)=>s.send('ok'));app.listen(process.env.PORT||3001);`;

const dbPath = join(tmpdir(), `ia-revive-${randomUUID()}.db`);
const dataRoot = join(tmpdir(), `ia-revive-data-${randomUUID()}`);
const db = openDb(dbPath);
const containers: string[] = [];

afterAll(() => {
  for (const c of containers) stopContainer(c);
  db.close();
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('reviveMissing', () => {
  it('recreates a container for a ready version whose container was removed', async () => {
    const p = projects.create(db, { slug: `rv-${randomUUID().slice(0, 6)}`, idea: 'x', ownerToken: 't' });
    const v = versions.create(db, { projectId: p.id, n: 1 });
    const built = buildVersion({
      dataRoot,
      projectId: p.id,
      version: 1,
      image: IMAGE,
      files: [{ path: 'server.js', content: SERVER }],
    });
    expect(built.ok).toBe(true);

    const r = runVersion({ dataRoot, projectId: p.id, version: 1, image: IMAGE });
    versions.setReady(db, v.id, { containerId: r.containerId, containerIp: r.containerIp, containerPort: 3001 });
    expect(containerAlive(r.containerId)).toBe(true);

    // simulate the container being reaped by a restart
    stopContainer(r.containerId);
    expect(containerAlive(r.containerId)).toBe(false);

    const res = reviveMissing(db, { dataRoot, image: IMAGE });
    expect(res.revived).toBe(1);
    const after = versions.get(db, v.id)!;
    containers.push(after.containerId!);
    expect(after.containerIp).toBeTruthy();
    expect(containerAlive(after.containerId!)).toBe(true);
  }, 120000);
});