import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { Message } from './types';

function map(r: any): Message {
  let meta: unknown = null;
  if (r.meta) {
    try {
      meta = JSON.parse(r.meta);
    } catch {
      meta = null;
    }
  }
  return {
    id: r.id,
    projectId: r.project_id,
    role: r.role,
    content: r.content,
    meta,
    createdAt: r.created_at,
  };
}

export function add(
  db: DB,
  projectId: string,
  role: Message['role'],
  content: string,
  meta?: unknown,
): Message {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO message (id,project_id,role,content,meta,created_at) VALUES (?,?,?,?,?,?)`,
  ).run(id, projectId, role, content, meta === undefined ? null : JSON.stringify(meta), Date.now());
  const r = db.prepare(`SELECT * FROM message WHERE id=?`).get(id) as any;
  return map(r);
}

export function list(db: DB, projectId: string): Message[] {
  return (
    db
      .prepare(`SELECT * FROM message WHERE project_id=? ORDER BY created_at ASC`)
      .all(projectId) as any[]
  ).map(map);
}