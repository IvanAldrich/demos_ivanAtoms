import type { DB } from '../lib/db';
import type { Version } from '../lib/repo/types';
import * as versions from '../lib/repo/versions';
import { runVersion, containerAlive } from './docker';
import { checkHealth } from './health';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensure a ready version has a live run container; if it died, recreate it from disk
 * and wait briefly for it to boot. Used by the reverse proxy (revive-on-access).
 */
export async function ensureVersionRunning(
  db: DB,
  opts: { dataRoot: string; image: string; containerPort?: number },
  v: Version,
): Promise<Version> {
  const port = opts.containerPort ?? 3001;
  if (v.containerId && containerAlive(v.containerId)) return v;

  const r = runVersion({
    dataRoot: opts.dataRoot,
    projectId: v.projectId,
    version: v.n,
    image: opts.image,
    containerPort: port,
  });
  versions.setReady(db, v.id, {
    containerId: r.containerId,
    containerIp: r.containerIp,
    containerPort: port,
  });

  for (let i = 0; i < 12; i++) {
    const h = await checkHealth(`http://${r.containerIp}:${port}`);
    if (h.ok) break;
    await sleep(500);
  }
  return versions.get(db, v.id) ?? v;
}