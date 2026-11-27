import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import { proxyTo } from '@/lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await ctx.params;
  const db = serverDb();
  const project = projects.getBySlug(db, slug);
  if (!project) return new Response('not_found', { status: 404 });
  if (!project.publishedVersionId) return new Response('not_published', { status: 404 });

  const version = versions.get(db, project.publishedVersionId);
  if (!version || version.status !== 'ready' || !version.containerIp) {
    return new Response('version_unavailable', { status: 503 });
  }

  return proxyTo(req, version.containerIp, version.containerPort ?? 3001, `/p/${slug}/`, path ?? []);
}