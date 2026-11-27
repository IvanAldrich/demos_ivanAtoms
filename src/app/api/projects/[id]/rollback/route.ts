import { NextResponse } from 'next/server';
import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import { rollback } from '@/lib/cas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const project = projects.get(db, id);
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { versionId?: string };
  if (!body.versionId) return NextResponse.json({ error: 'versionId_required' }, { status: 400 });

  const target = versions.get(db, body.versionId);
  if (!target || target.projectId !== id || target.status !== 'ready') {
    return NextResponse.json({ error: 'version_not_ready' }, { status: 400 });
  }

  const ok = rollback(db, id, body.versionId);
  return NextResponse.json({ ok });
}