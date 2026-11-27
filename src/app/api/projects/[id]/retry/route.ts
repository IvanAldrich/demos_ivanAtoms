import { NextResponse } from 'next/server';
import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import * as jobs from '@/lib/repo/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const project = projects.get(db, id);
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // retry = regenerate from the original idea as a fresh initial build
  const n = versions.maxN(db, id) + 1;
  const v = versions.create(db, { projectId: id, n });
  const job = jobs.enqueue(db, { projectId: id, versionId: v.id, type: 'initial' });

  return NextResponse.json({ jobId: job.id, version: n });
}