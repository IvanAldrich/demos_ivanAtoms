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
  const allJobs = jobs.listByProject(db, id);
  const running = allJobs.find((j) => j.status === 'leased' || j.status === 'running');
  const queued = allJobs.filter((j) => j.status === 'queued');
  const active = running ?? queued[0];
  const activeJob = active ? { id: active.id, status: active.status, type: active.type } : null;

  return NextResponse.json({
    project,
    versions: versions.listByProject(db, id),
    messages: messages.list(db, id),
    activeJob,
    pending: queued.length,
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