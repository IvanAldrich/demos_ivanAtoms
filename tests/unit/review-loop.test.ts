import { describe, it, expect } from 'vitest';
import { LlmClient } from '../../src/engine/llm';
import { nextRound, runReviewRepair } from '../../src/engine/stages/review';
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

describe('nextRound', () => {
  it('allows retry for rounds 0,1,2', () => {
    expect(nextRound(0)).toEqual({ retry: true, round: 1 });
    expect(nextRound(1)).toEqual({ retry: true, round: 2 });
    expect(nextRound(2)).toEqual({ retry: true, round: 3 });
  });

  it('stops at round 3', () => {
    expect(nextRound(3)).toEqual({ retry: false, round: 3 });
  });
});

describe('runReviewRepair', () => {
  it('returns diagnosis and repaired files', async () => {
    const llm = new LlmClient({
      baseUrl: 'x',
      model: 'm',
      transport: async () =>
        JSON.stringify({ diagnosis: 'fixed', files: [{ path: 'server.js', content: 'fixed' }] }),
    });
    const r = await runReviewRepair(llm, {
      round: 1,
      spec,
      currentFiles: [{ path: 'server.js', content: 'bad' }],
      failure: 'boom',
    });
    expect(r.diagnosis).toBe('fixed');
    expect(r.files?.[0].content).toBe('fixed');
  });
});