import 'dotenv/config';

export class MissingEnvError extends Error {
  constructor(public readonly key: string) {
    super(`Missing required env: ${key}`);
    this.name = 'MissingEnvError';
  }
}

export interface Env {
  DASHSCOPE_API_KEY?: string;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  DB_PATH: string;
  DATA_ROOT: string;
  SANDBOX_IMAGE: string;
  BASE_URL: string;
  RUNTIME_ISOLATION: 'container' | 'process';
  SESSION_SECRET: string;
}

export function loadEnv(src: Record<string, string | undefined> = process.env): Env {
  const llmBaseUrl = src.LLM_BASE_URL;
  if (!llmBaseUrl) throw new MissingEnvError('LLM_BASE_URL');

  const isolation =
    (src.RUNTIME_ISOLATION as Env['RUNTIME_ISOLATION'] | undefined) ?? 'container';

  return {
    DASHSCOPE_API_KEY: src.DASHSCOPE_API_KEY || undefined,
    LLM_BASE_URL: llmBaseUrl,
    LLM_MODEL: src.LLM_MODEL || 'qwen3-coder-plus',
    DB_PATH: src.DB_PATH || './data/app.db',
    DATA_ROOT: src.DATA_ROOT || './storage/projects',
    SANDBOX_IMAGE: src.SANDBOX_IMAGE || 'ivanatoms/base:node22',
    BASE_URL: src.BASE_URL || 'http://localhost:3000',
    RUNTIME_ISOLATION: isolation,
    SESSION_SECRET: src.SESSION_SECRET || '',
  };
}