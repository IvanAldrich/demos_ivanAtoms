import { describe, it, expect } from 'vitest';
import { LlmClient } from '../../src/engine/llm';
import { runEngineer } from '../../src/engine/stages/engineer';
import { SiteSpecSchema } from '../../src/engine/schema';

const spec = SiteSpecSchema.parse({
  specVersion: 1,
  brief: { name: 'x', category: 'app', summary: 's', pages: [], userStories: [], dataModel: [] },
  fileManifest: [],
  techConstraints: {
    runtime: 'node22-cjs',
    entry: 'server.js',
    startCmd: 'node server.js',
    port: 3000,
    dataDirEnv: 'DATA_DIR',
    persistence: 'json',
    deps: ['express'],
    assetPaths: 'relative',
    noAbsoluteRoot: true,
    noWebSocket: true,
  },
});

describe('runEngineer', () => {
  it('initial returns files', async () => {
    const llm = new LlmClient({
      baseUrl: 'x',
      model: 'm',
      transport: async () => JSON.stringify({ files: [{ path: 'server.js', content: 'x' }] }),
    });
    const r = await runEngineer(llm, { spec, mode: 'initial' });
    expect(r.files).toHaveLength(1);
    expect(r.patches).toBeUndefined();
  });

  it('iterate returns patches', async () => {
    const llm = new LlmClient({
      baseUrl: 'x',
      model: 'm',
      transport: async () => JSON.stringify({ patches: [{ path: 'server.js', search: 'x', replace: 'y' }] }),
    });
    const r = await runEngineer(llm, {
      spec,
      mode: 'iterate',
      existingFiles: [{ path: 'server.js', content: 'x' }],
      userMessage: 'rename',
    });
    expect(r.patches).toHaveLength(1);
    expect(r.files).toBeUndefined();
  });
});