import { NextResponse } from 'next/server';
import { serverDb, serverEnv } from '@/lib/server';
import * as jobs from '@/lib/repo/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const env = serverEnv();
  const db = serverDb();
  let dbStatus = 'ok';
  try {
    db.prepare('SELECT 1').get();
  } catch {
    dbStatus = 'error';
  }
  return NextResponse.json({
    db: dbStatus,
    isolation: env.RUNTIME_ISOLATION,
    backlog: jobs.backlog(db),
    image: env.SANDBOX_IMAGE,
  });
}