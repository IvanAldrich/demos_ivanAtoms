import { NextResponse } from 'next/server';
import { serverDb, serverEnv } from '@/lib/server';
import * as versions from '@/lib/repo/versions';
import { versionDir, readDirFiles } from '@/sandbox/docker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const env = serverEnv();

  const ready = versions
    .listByProject(db, id)
    .filter((v) => v.status === 'ready')
    .sort((a, b) => b.n - a.n)[0];
  if (!ready) return NextResponse.json({ files: [] });

  const files = readDirFiles(versionDir(env.DATA_ROOT, id, ready.n));
  const url = new URL(req.url);
  const p = url.searchParams.get('path');

  if (p) {
    const f = files.find((x) => x.path === p);
    if (!f) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ path: f.path, content: f.content });
  }

  return NextResponse.json({
    version: ready.n,
    files: files
      .map((f) => ({ path: f.path, size: Buffer.byteLength(f.content, 'utf8') }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  });
}