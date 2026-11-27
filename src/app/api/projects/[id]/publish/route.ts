import { NextResponse } from 'next/server';
import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const project = projects.get(db, id);
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { published?: boolean };

  if (!body.published) {
    projects.update(db, id, { publishedVersionId: null });
    return NextResponse.json({ ok: true, publishedVersionId: null });
  }

  const latestReady = versions
    .listByProject(db, id)
    .filter((v) => v.status === 'ready')
    .sort((a, b) => b.n - a.n)[0];
  if (!latestReady) return NextResponse.json({ error: 'no_ready_version' }, { status: 400 });

  projects.update(db, id, { publishedVersionId: latestReady.id });
  return NextResponse.json({ ok: true, publishedVersionId: latestReady.id, slug: project.slug });
}