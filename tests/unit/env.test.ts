import { describe, it, expect } from 'vitest';
import { loadEnv, MissingEnvError } from '../../src/env';

describe('loadEnv', () => {
  it('defaults DB_PATH when not provided', () => {
    const env = loadEnv({ LLM_BASE_URL: 'http://x' });
    expect(env.DB_PATH).toBe('./data/app.db');
  });

  it('defaults model and isolation', () => {
    const env = loadEnv({ LLM_BASE_URL: 'http://x' });
    expect(env.LLM_MODEL).toBe('qwen3-coder-plus');
    expect(env.RUNTIME_ISOLATION).toBe('container');
  });

  it('throws MissingEnvError when LLM_BASE_URL missing', () => {
    expect(() => loadEnv({})).toThrow(MissingEnvError);
  });
});