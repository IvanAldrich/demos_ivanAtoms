import { describe, it, expect } from 'vitest';
import { LlmClient } from '../../src/engine/llm';
import { runSpec, BudgetError } from '../../src/engine/stages/spec';

function specWith(manifestLen: number) {
  return {
    specVersion: 1,
    brief: { name: 'x', category: 'app', summary: 's', pages: [], userStories: [], dataModel: [] },
    fileManifest: Array.from({ length: manifestLen }, (_, i) => ({
      path: `f${i}.js`,
      purpose: 'p',
      estBytes: 10,
      source: 'gen',
    })),
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
  };
}

describe('runSpec', () => {
  it('returns a valid spec', async () => {
    const llm = new LlmClient({ baseUrl: 'x', model: 'm', transport: async () => JSON.stringify(specWith(2)) });
    const spec = await runSpec(llm, { idea: 'todo' });
    expect(spec.fileManifest).toHaveLength(2);
    expect(spec.techConstraints.runtime).toBe('node22-cjs');
  });

  it('throws BudgetError when manifest exceeds 12', async () => {
    const llm = new LlmClient({ baseUrl: 'x', model: 'm', transport: async () => JSON.stringify(specWith(13)) });
    await expect(runSpec(llm, { idea: 'todo' })).rejects.toBeInstanceOf(BudgetError);
  });
});