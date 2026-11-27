import { NextResponse } from 'next/server';
import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import * as messages from '@/lib/repo/messages';
import * as jobs from '@/lib/repo/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  return NextResponse.json(messages.list(db, id));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const project = projects.get(db, id);
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { content?: string };
  const content = String(body.content ?? '').trim();
  if (!content) return NextResponse.json({ error: 'content_required' }, { status: 400 });

  messages.add(db, id, 'user', content);

  // serialize per project: supersede any pending iterate for this project
  jobs.supersedeQueuedIterate(db, id);

  const n = versions.maxN(db, id) + 1;
  const v = versions.create(db, { projectId: id, n });
  const job = jobs.enqueue(db, { projectId: id, versionId: v.id, type: 'iterate' });

  return NextResponse.json({ jobId: job.id, version: n });
}