import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { BuildJob, JobStatus } from './types';

function map(r: any): BuildJob {
  return {
    id: r.id,
    projectId: r.project_id,
    versionId: r.version_id,
    type: r.type,
    status: r.status,
    leaseUntil: r.lease_until,
    attempts: r.attempts,
    repairRound: r.repair_round,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function enqueue(
  db: DB,
  input: { projectId: string; versionId: string; type: BuildJob['type'] },
): BuildJob {
  const id = randomUUID();
  const t = Date.now();
  db.prepare(
    `INSERT INTO build_job (id,project_id,version_id,type,status,lease_until,attempts,repair_round,error,created_at,updated_at)
     VALUES (?,?,?,?,'queued',NULL,0,0,NULL,?,?)`,
  ).run(id, input.projectId, input.versionId, input.type, t, t);
  return get(db, id)!;
}

export function get(db: DB, id: string): BuildJob | undefined {
  const r = db.prepare(`SELECT * FROM build_job WHERE id=?`).get(id) as any;
  return r ? map(r) : undefined;
}

export function claimNext(db: DB, leaseMs = 30_000): BuildJob | null {
  const row = db
    .prepare(
      `SELECT id FROM build_job WHERE status='queued' ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as any;
  if (!row) return null;
  const t = Date.now();
  const res = db
    .prepare(
      `UPDATE build_job SET status='leased',lease_until=?,updated_at=? WHERE id=? AND status='queued'`,
    )
    .run(t + leaseMs, t, row.id);
  if (res.changes !== 1) return null;
  return get(db, row.id) ?? null;
}

export function setStatus(
  db: DB,
  id: string,
  status: JobStatus,
  extra?: {
    leaseUntil?: number | null;
    error?: string | null;
    repairRound?: number;
    bumpAttempts?: boolean;
  },
): void {
  const job = get(db, id);
  if (!job) return;
  const lease =
    extra && 'leaseUntil' in extra ? extra.leaseUntil ?? null : job.leaseUntil;
  const error = extra && 'error' in extra ? extra.error ?? null : job.error;
  const repairRound = extra?.repairRound ?? job.repairRound;
  const attempts = job.attempts + (extra?.bumpAttempts ? 1 : 0);
  db.prepare(
    `UPDATE build_job SET status=?,lease_until=?,error=?,repair_round=?,attempts=?,updated_at=? WHERE id=?`,
  ).run(status, lease, error, repairRound, attempts, Date.now(), id);
}

export function heartbeat(db: DB, id: string, leaseMs = 30_000): void {
  db.prepare(`UPDATE build_job SET lease_until=?,updated_at=? WHERE id=?`).run(
    Date.now() + leaseMs,
    Date.now(),
    id,
  );
}

export function supersedeQueuedIterate(
  db: DB,
  projectId: string,
  exceptId?: string,
): number {
  const res = db
    .prepare(
      `UPDATE build_job SET status='superseded',updated_at=?
       WHERE project_id=? AND type='iterate' AND status='queued' AND id<>?`,
    )
    .run(Date.now(), projectId, exceptId ?? '');
  return res.changes;
}

export function backlog(db: DB): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS c FROM build_job WHERE status='queued'`)
    .get() as any;
  return r?.c ?? 0;
}

export function hasActiveForProject(db: DB, projectId: string): boolean {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS c FROM build_job WHERE project_id=? AND status IN ('leased','running')`,
    )
    .get(projectId) as any;
  return (r?.c ?? 0) > 0;
}