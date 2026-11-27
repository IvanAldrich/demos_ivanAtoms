import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { Version } from './types';

function map(r: any): Version {
  return {
    id: r.id,
    projectId: r.project_id,
    n: r.n,
    status: r.status,
    containerId: r.container_id,
    containerIp: r.container_ip,
    containerPort: r.container_port,
    error: r.error,
    createdAt: r.created_at,
  };
}

export function create(db: DB, input: { projectId: string; n: number }): Version {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO version (id,project_id,n,status,container_id,container_ip,container_port,error,created_at)
     VALUES (?,?,?,'building',NULL,NULL,NULL,NULL,?)`,
  ).run(id, input.projectId, input.n, Date.now());
  return get(db, id)!;
}

export function get(db: DB, id: string): Version | undefined {
  const r = db.prepare(`SELECT * FROM version WHERE id=?`).get(id) as any;
  return r ? map(r) : undefined;
}

export function listByProject(db: DB, projectId: string): Version[] {
  return (
    db
      .prepare(`SELECT * FROM version WHERE project_id=? ORDER BY n ASC`)
      .all(projectId) as any[]
  ).map(map);
}

export function maxN(db: DB, projectId: string): number {
  const r = db
    .prepare(`SELECT MAX(n) AS m FROM version WHERE project_id=?`)
    .get(projectId) as any;
  return r?.m ?? 0;
}

export function setReady(
  db: DB,
  id: string,
  info: { containerId: string; containerIp: string; containerPort: number },
): void {
  db.prepare(
    `UPDATE version SET status='ready',container_id=?,container_ip=?,container_port=?,error=NULL WHERE id=?`,
  ).run(info.containerId, info.containerIp, info.containerPort, id);
}

export function setFailed(db: DB, id: string, error: string): void {
  db.prepare(`UPDATE version SET status='failed',error=? WHERE id=?`).run(
    error.slice(0, 2000),
    id,
  );
}