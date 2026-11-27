import type { DB } from '../lib/db';
import * as versions from '../lib/repo/versions';
import { runVersion, containerAlive } from '../sandbox/docker';

/**
 * Reconcile live containers against persisted ready versions (non-destructive):
 * - For every ready version whose container is NOT running, re-create it from the
 *   on-disk version dir and update its container info.
 * - Never blanket-deletes containers (that previously killed live previews).
 */
export function reviveMissing(
  db: DB,
  opts: { dataRoot: string; image: string },
): { revived: number } {
  const ready = db
    .prepare(
      `SELECT id, project_id AS projectId, n, container_id AS containerId
       FROM version WHERE status='ready'`,
    )
    .all() as Array<{ id: string; projectId: string; n: number; containerId: string | null }>;

  let revived = 0;
  for (const v of ready) {
    if (v.containerId && containerAlive(v.containerId)) continue;
    try {
      const r = runVersion({
        dataRoot: opts.dataRoot,
        projectId: v.projectId,
        version: v.n,
        image: opts.image,
        containerPort: 3001,
      });
      versions.setReady(db, v.id, {
        containerId: r.containerId,
        containerIp: r.containerIp,
        containerPort: 3001,
      });
      revived++;
    } catch {
      /* skip: code dir may be gone */
    }
  }
  return { revived };
}