import type { DB } from './db';

/** Compare-and-swap the published pointer. Succeeds only if the current pointer equals expectVersionId. */
export function casPublish(
  db: DB,
  projectId: string,
  expectVersionId: string | null,
  nextVersionId: string,
): boolean {
  const res = db
    .prepare(
      `UPDATE project SET published_version_id=?, updated_at=? WHERE id=? AND published_version_id IS ?`,
    )
    .run(nextVersionId, Date.now(), projectId, expectVersionId);
  return res.changes === 1;
}

/** Keep the N highest-n versions plus the published one; delete the rest. Returns deleted ids. */
export function retainVersions(db: DB, projectId: string, keep = 3): string[] {
  const published =
    (db.prepare(`SELECT published_version_id AS p FROM project WHERE id=?`).get(projectId) as any)?.p ?? null;
  const rows = db
    .prepare(`SELECT id, n FROM version WHERE project_id=? ORDER BY n DESC`)
    .all(projectId) as Array<{ id: string; n: number }>;

  const keepIds = new Set<string>();
  for (const r of rows.slice(0, keep)) keepIds.add(r.id);
  if (published) keepIds.add(published);

  const toDelete = rows.filter((r) => !keepIds.has(r.id)).map((r) => r.id);
  for (const id of toDelete) db.prepare(`DELETE FROM version WHERE id=?`).run(id);
  return toDelete;
}

export function rollback(db: DB, projectId: string, versionId: string): boolean {
  const current =
    (db.prepare(`SELECT published_version_id AS p FROM project WHERE id=?`).get(projectId) as any)?.p ?? null;
  return casPublish(db, projectId, current, versionId);
}