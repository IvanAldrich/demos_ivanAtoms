import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import {
  buildVersion,
  runVersion,
  stopContainer,
} from '../../src/sandbox/docker';
import { checkHealth } from '../../src/sandbox/health';

const IMAGE = process.env.SANDBOX_IMAGE ?? 'ivanatoms/base:node22';

// GET / is non-mutating (used by health probes); GET /inc reads+increments DATA_DIR/count.txt.
const SERVER_JS = `
const express = require('express');
const fs = require('fs');
const path = require('path');
const DATA = process.env.DATA_DIR || '/app/data';
fs.mkdirSync(DATA, { recursive: true });
const file = path.join(DATA, 'count.txt');
const app = express();
app.get('/', (req, res) => res.type('html').send('<h1>ok</h1>'));
app.get('/inc', (req, res) => {
  let n = 0;
  try { n = parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch {}
  n += 1;
  fs.writeFileSync(file, String(n));
  res.json({ n });
});
app.listen(process.env.PORT || 3001);
`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(ip: string): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    const r = await checkHealth(`http://${ip}:3001`);
    if (r.ok) return true;
    await sleep(500);
  }
  return false;
}

async function getInc(ip: string): Promise<number> {
  const res = await fetch(`http://${ip}:3001/inc`);
  const json = (await res.json()) as { n: number };
  return json.n;
}

let dataRoot: string;
const projectId = 'projtest1';
let currentCid = '';

beforeAll(() => {
  dataRoot = join(tmpdir(), `ia-sbx-${randomUUID()}`);
});

afterAll(() => {
  if (currentCid) stopContainer(currentCid);
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('sandbox (docker)', () => {
  it('builds, runs, health-checks, and persists data across runs', async () => {
    const built = buildVersion({
      dataRoot,
      projectId,
      version: 1,
      image: IMAGE,
      files: [{ path: 'server.js', content: SERVER_JS }],
    });
    expect(built.ok).toBe(true);

    const r1 = runVersion({ dataRoot, projectId, version: 1, image: IMAGE });
    currentCid = r1.containerId;
    expect(await waitHealthy(r1.containerIp)).toBe(true);
    expect(await getInc(r1.containerIp)).toBe(1);

    // data must land on the host shared volume (persistence proof at FS level)
    const hostFile = join(dataRoot, projectId, 'data', 'count.txt');
    expect(existsSync(hostFile)).toBe(true);
    expect(readFileSync(hostFile, 'utf8').trim()).toBe('1');

    stopContainer(currentCid);
    currentCid = '';

    const r2 = runVersion({ dataRoot, projectId, version: 1, image: IMAGE });
    currentCid = r2.containerId;
    expect(await waitHealthy(r2.containerIp)).toBe(true);
    expect(await getInc(r2.containerIp)).toBe(2);
  }, 120_000);
});