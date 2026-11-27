import { NextResponse } from 'next/server';
import { getOwnerToken } from '@/lib/owner';
import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import * as messages from '@/lib/repo/messages';
import * as jobs from '@/lib/repo/jobs';
import { stopContainer } from '@/sandbox/docker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const project = projects.get(db, id);
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    project,
    versions: versions.listByProject(db, id),
    messages: messages.list(db, id),
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const project = projects.get(db, id);
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  for (const v of versions.listByProject(db, id)) {
    if (v.containerId) stopContainer(v.containerId);
  }
  db.prepare('DELETE FROM build_event WHERE job_id IN (SELECT id FROM build_job WHERE project_id=?)').run(id);
  db.prepare('DELETE FROM build_job WHERE project_id=?').run(id);
  db.prepare('DELETE FROM version WHERE project_id=?').run(id);
  db.prepare('DELETE FROM message WHERE project_id=?').run(id);
  projects.remove(db, id);

  return NextResponse.json({ ok: true });
}