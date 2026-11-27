import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { LlmClient, type Transport } from '../../src/engine/llm';
import { runPipeline } from '../../src/engine/pipeline';
import { stopContainer } from '../../src/sandbox/docker';
import { checkHealth } from '../../src/sandbox/health';

const IMAGE = process.env.SANDBOX_IMAGE ?? 'ivanatoms/base:node22';

const SPEC = {
  specVersion: 1 as const,
  brief: {
    name: 'Todo',
    category: 'app' as const,
    summary: 'simple todo',
    pages: [{ path: '/', purpose: 'list' }],
    userStories: ['add item'],
    dataModel: [{ table: 'items', fields: [{ name: 'text', type: 'string' }] }],
  },
  fileManifest: [{ path: 'server.js', purpose: 'entry', estBytes: 600, source: 'gen' as const }],
  techConstraints: {
    runtime: 'node22-cjs' as const,
    entry: 'server.js',
    startCmd: 'node server.js',
    port: 3000,
    dataDirEnv: 'DATA_DIR' as const,
    persistence: 'json' as const,
    deps: ['express'],
    assetPaths: 'relative' as const,
    noAbsoluteRoot: true,
    noWebSocket: true,
  },
};

const SERVER = `
const express = require('express');
const fs = require('fs');
const path = require('path');
const DATA = process.env.DATA_DIR || '/app/data';
fs.mkdirSync(DATA, { recursive: true });
const FILE = path.join(DATA, 'items.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const write = (a) => fs.writeFileSync(FILE, JSON.stringify(a));
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.type('html').send('<h1>Todo</h1>'));
app.get('/api/items', (req, res) => res.json(read()));
app.post('/api/items', (req, res) => { const a = read(); a.push({ text: req.body.text }); write(a); res.json(a); });
app.listen(process.env.PORT || 3001);
`;

const dataRoot = join(tmpdir(), `ia-pipe-${randomUUID()}`);
const containers: string[] = [];

afterAll(() => {
  for (const c of containers) stopContainer(c);
  rmSync(dataRoot, { recursive: true, force: true });
});

function transportFor(engineerFiles: (n: number) => string, reviewFiles: string): Transport {
  let engCalls = 0;
  return async (msgs) => {
    const sys = String(msgs[0].content);
    if (sys.includes('Spec 阶段')) return JSON.stringify(SPEC);
    if (sys.includes('Engineer 阶段')) {
      const content = engineerFiles(engCalls++);
      return JSON.stringify({ files: [{ path: 'server.js', content }] });
    }
    if (sys.includes('Review/Repair')) {
      return JSON.stringify({ diagnosis: 'fix', files: [{ path: 'server.js', content: reviewFiles }] });
    }
    return '{}';
  };
}

describe('runPipeline (docker)', () => {
  it('ready on a good first generation', async () => {
    const llm = new LlmClient({ baseUrl: 'x', model: 'm', transport: transportFor(() => SERVER, SERVER) });
    const res = await runPipeline(
      { projectId: 'pipeA', version: 1, mode: 'initial', idea: 'todo' },
      { llm, dataRoot, image: IMAGE },
    );
    expect(res.status).toBe('ready');
    if (res.containerId) containers.push(res.containerId);
    expect(res.containerIp).toBeTruthy();

    const health = await checkHealth(`http://${res.containerIp}:3001`);
    expect(health.ok).toBe(true);

    const post = await fetch(`http://${res.containerIp}:3001/api/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'milk' }),
    });
    const after = (await (await fetch(`http://${res.containerIp}:3001/api/items`)).json()) as unknown[];
    expect(post.status).toBe(200);
    expect(after.length).toBe(1);
  }, 120_000);

  it('recovers via review/repair when engineer emits forbidden ESM', async () => {
    const bad = `import x from 'y';\n${SERVER}`;
    const llm = new LlmClient({ baseUrl: 'x', model: 'm', transport: transportFor(() => bad, SERVER) });
    const res = await runPipeline(
      { projectId: 'pipeB', version: 1, mode: 'initial', idea: 'todo' },
      { llm, dataRoot, image: IMAGE },
    );
    expect(res.status).toBe('ready');
    if (res.containerId) containers.push(res.containerId);
    expect(res.repairRounds).toBeGreaterThanOrEqual(1);
  }, 120_000);
});