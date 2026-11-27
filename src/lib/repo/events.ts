import type { DB } from '../db';
import type { BuildEvent } from './types';

function map(r: any): BuildEvent {
  return {
    id: r.id,
    jobId: r.job_id,
    level: r.level,
    message: r.message,
    data: r.data,
    ts: r.ts,
  };
}

export function append(
  db: DB,
  jobId: string,
  level: string,
  message: string,
  data?: unknown,
): void {
  db.prepare(
    `INSERT INTO build_event (job_id,level,message,data,ts) VALUES (?,?,?,?,?)`,
  ).run(jobId, level, message, data === undefined ? null : JSON.stringify(data), Date.now());
}

export function since(db: DB, jobId: string, afterId = 0): BuildEvent[] {
  return (
    db
      .prepare(
        `SELECT * FROM build_event WHERE job_id=? AND id>? ORDER BY id ASC`,
      )
      .all(jobId, afterId) as any[]
  ).map(map);
}

export function listByJob(db: DB, jobId: string): BuildEvent[] {
  return since(db, jobId, 0);
}

/** Events across all jobs of a project (for project-scoped SSE), after a cursor. */
export function sinceForProject(db: DB, projectId: string, afterId = 0): BuildEvent[] {
  return (
    db
      .prepare(
        `SELECT e.* FROM build_event e JOIN build_job j ON e.job_id=j.id
         WHERE j.project_id=? AND e.id>? ORDER BY e.id ASC`,
      )
      .all(projectId, afterId) as any[]
  ).map(map);
}

export function cleanupOlderThan(db: DB, ts: number): number {
  return db.prepare(`DELETE FROM build_event WHERE ts < ?`).run(ts).changes;
}