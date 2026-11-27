import { describe, it, expect } from 'vitest';
import { SiteSpecSchema } from '../../src/engine/schema';
import { LlmClient, SchemaError } from '../../src/engine/llm';

const validSpec = {
  specVersion: 1,
  brief: {
    name: 'Todo',
    category: 'app',
    summary: 'simple todo',
    pages: [{ path: '/', purpose: 'list' }],
    userStories: ['add a todo'],
    dataModel: [{ table: 'todos', fields: [{ name: 'text', type: 'string' }] }],
  },
  fileManifest: [{ path: 'server.js', purpose: 'entry', estBytes: 500, source: 'gen' }],
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

describe('SiteSpecSchema', () => {
  it('accepts a valid spec', () => {
    expect(SiteSpecSchema.safeParse(validSpec).success).toBe(true);
  });

  it('rejects invalid category', () => {
    const bad = structuredClone(validSpec);
    (bad.brief as any).category = 'weird';
    expect(SiteSpecSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects manifest entry missing path', () => {
    const bad = structuredClone(validSpec);
    (bad.fileManifest[0] as any).path = undefined;
    expect(SiteSpecSchema.safeParse(bad).success).toBe(false);
  });
});

describe('LlmClient.completeJSON', () => {
  it('parses and validates JSON via injected transport', async () => {
    const client = new LlmClient({
      baseUrl: 'http://x',
      model: 'm',
      transport: async () => JSON.stringify(validSpec),
    });
    const spec = await client.completeJSON([{ role: 'user', content: 'hi' }], SiteSpecSchema);
    expect(spec.brief.name).toBe('Todo');
  });

  it('throws SchemaError on invalid JSON', async () => {
    const client = new LlmClient({
      baseUrl: 'http://x',
      model: 'm',
      transport: async () => 'not json',
    });
    await expect(
      client.completeJSON([{ role: 'user', content: 'hi' }], SiteSpecSchema),
    ).rejects.toBeInstanceOf(SchemaError);
  });
});