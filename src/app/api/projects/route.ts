import { NextResponse } from 'next/server';
import { getOwnerToken } from '@/lib/owner';
import { serverDb } from '@/lib/server';
import * as projects from '@/lib/repo/projects';
import * as versions from '@/lib/repo/versions';
import * as jobs from '@/lib/repo/jobs';
import * as messages from '@/lib/repo/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await getOwnerToken();
  const db = serverDb();
  return NextResponse.json(projects.listByOwner(db, owner));
}

export async function POST(req: Request) {
  const owner = await getOwnerToken();
  const db = serverDb();
  const body = (await req.json().catch(() => ({}))) as { idea?: string; templateKey?: string };
  const idea = String(body.idea ?? '').trim();
  if (!idea) return NextResponse.json({ error: 'idea_required' }, { status: 400 });

  const slug = Math.random().toString(36).slice(2, 8);
  const project = projects.create(db, {
    slug,
    idea,
    ownerToken: owner,
    templateKey: body.templateKey ?? null,
  });
  messages.add(db, project.id, 'user', idea);
  const v = versions.create(db, { projectId: project.id, n: 1 });
  jobs.enqueue(db, { projectId: project.id, versionId: v.id, type: 'initial' });

  return NextResponse.json({ projectId: project.id, slug: project.slug });
}