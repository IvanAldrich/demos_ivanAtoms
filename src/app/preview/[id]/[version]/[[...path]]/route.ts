import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import { proxyTo } from '@/lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; version: string; path?: string[] }> },
) {
  const { id, version: versionId, path } = await ctx.params;
  const db = serverDb();
  const project = projects.get(db, id);
  if (!project) return new Response('not_found', { status: 404 });

  const version = versions.get(db, versionId);
  if (!version || version.projectId !== id || version.status !== 'ready' || !version.containerIp) {
    return new Response('version_unavailable', { status: 503 });
  }

  return proxyTo(
    req,
    version.containerIp,
    version.containerPort ?? 3001,
    `/preview/${id}/${versionId}/`,
    path ?? [],
  );
}