import type { DB } from '../lib/db';
import type { BuildJob } from '../lib/repo/types';
import * as jobs from '../lib/repo/jobs';

/** Move leased jobs whose lease expired back to queued. */
export function requeueExpired(db: DB, now = Date.now()): number {
  return db
    .prepare(
      `UPDATE build_job SET status='queued', lease_until=NULL, updated_at=?
       WHERE status='leased' AND lease_until IS NOT NULL AND lease_until < ?`,
    )
    .run(now, now).changes;
}

/**
 * Pick and lease the next runnable job. A project with an active job (leased/running)
 * is skipped so jobs of the same project run serially.
 */
export function selectNextJob(db: DB, leaseMs = 30_000): BuildJob | null {
  const rows = db
    .prepare(`SELECT id, project_id FROM build_job WHERE status='queued' ORDER BY created_at ASC, rowid ASC`)
    .all() as Array<{ id: string; project_id: string }>;

  for (const row of rows) {
    if (jobs.hasActiveForProject(db, row.project_id)) continue;
    const t = Date.now();
    const res = db
      .prepare(
        `UPDATE build_job SET status='leased', lease_until=?, updated_at=? WHERE id=? AND status='queued'`,
      )
      .run(t + leaseMs, t, row.id);
    if (res.changes === 1) return jobs.get(db, row.id) ?? null;
  }
  return null;
}