import { loadEnv, type Env } from '../env';
import { openDb, type DB } from './db';
import { LlmClient } from '../engine/llm';

let _env: Env | undefined;
let _db: DB | undefined;
let _llm: LlmClient | undefined;

export function serverEnv(): Env {
  return (_env ??= loadEnv());
}

export function serverDb(): DB {
  return (_db ??= openDb(serverEnv().DB_PATH));
}

export function serverLlm(): LlmClient {
  const e = serverEnv();
  return (_llm ??= new LlmClient({
    baseUrl: e.LLM_BASE_URL,
    model: e.LLM_MODEL,
    apiKey: e.DASHSCOPE_API_KEY,
  }));
}