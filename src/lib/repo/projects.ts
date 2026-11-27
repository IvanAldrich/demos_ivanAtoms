import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { Project } from './types';

function map(r: any): Project {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    idea: r.idea,
    templateKey: r.template_key,
    ownerToken: r.owner_token,
    status: r.status,
    publishedVersionId: r.published_version_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function create(
  db: DB,
  input: {
    slug: string;
    idea: string;
    ownerToken: string;
    name?: string;
    templateKey?: string | null;
  },
): Project {
  const id = randomUUID();
  const t = Date.now();
  const name = input.name ?? input.idea.slice(0, 60);
  db.prepare(
    `INSERT INTO project (id,slug,name,idea,template_key,owner_token,status,published_version_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'idle',NULL,?,?)`,
  ).run(
    id,
    input.slug,
    name,
    input.idea,
    input.templateKey ?? null,
    input.ownerToken,
    t,
    t,
  );
  return get(db, id)!;
}

export function get(db: DB, id: string): Project | undefined {
  const r = db.prepare(`SELECT * FROM project WHERE id=?`).get(id) as any;
  return r ? map(r) : undefined;
}

export function getBySlug(db: DB, slug: string): Project | undefined {
  const r = db.prepare(`SELECT * FROM project WHERE slug=?`).get(slug) as any;
  return r ? map(r) : undefined;
}

export function listByOwner(db: DB, ownerToken: string): Project[] {
  return (
    db
      .prepare(`SELECT * FROM project WHERE owner_token=? ORDER BY created_at DESC`)
      .all(ownerToken) as any[]
  ).map(map);
}

export function update(
  db: DB,
  id: string,
  patch: {
    name?: string;
    status?: Project['status'];
    publishedVersionId?: string | null;
  },
): void {
  const cur = get(db, id);
  if (!cur) return;
  const name = patch.name ?? cur.name;
  const status = patch.status ?? cur.status;
  const pub =
    patch.publishedVersionId !== undefined
      ? patch.publishedVersionId
      : cur.publishedVersionId;
  db.prepare(
    `UPDATE project SET name=?,status=?,published_version_id=?,updated_at=? WHERE id=?`,
  ).run(name, status, pub, Date.now(), id);
}

export function remove(db: DB, id: string): void {
  db.prepare(`DELETE FROM project WHERE id=?`).run(id);
}