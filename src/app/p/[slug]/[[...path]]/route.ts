import { serverDb, serverEnv } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import { proxyTo } from '@/lib/proxy';
import { ensureVersionRunning } from '@/sandbox/ensure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(
  req: Request,
  ctx: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await ctx.params;
  const db = serverDb();
  const env = serverEnv();
  const project = projects.getBySlug(db, slug);
  if (!project) return new Response('not_found', { status: 404 });
  if (!project.publishedVersionId) return new Response('not_published', { status: 404 });

  let version = versions.get(db, project.publishedVersionId);
  if (!version || version.status !== 'ready') return new Response('version_unavailable', { status: 503 });

  try {
    version = await ensureVersionRunning(db, { dataRoot: env.DATA_ROOT, image: env.SANDBOX_IMAGE }, version);
  } catch {
    /* fall through to reactive check */
  }
  if (!version.containerIp) return new Response('version_unavailable', { status: 503 });

  return proxyTo(req, version.containerIp, version.containerPort ?? 3001, `/p/${slug}/`, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const HEAD = handle;