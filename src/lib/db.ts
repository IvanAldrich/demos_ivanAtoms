import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  idea TEXT NOT NULL,
  template_key TEXT,
  owner_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  published_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS version (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  status TEXT NOT NULL,
  container_id TEXT,
  container_ip TEXT,
  container_port INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, n)
);
CREATE TABLE IF NOT EXISTS build_job (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  repair_round INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS build_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_job ON build_event(job_id, id);
CREATE INDEX IF NOT EXISTS idx_job_status ON build_job(status, created_at);
CREATE INDEX IF NOT EXISTS idx_project_owner ON project(owner_token);
`;

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const msgCols = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>;
  if (!msgCols.some((c) => c.name === 'meta')) {
    db.exec('ALTER TABLE message ADD COLUMN meta TEXT');
  }
  return db;
}