import { serverDb } from '@/lib/server';
import * as events from '@/lib/repo/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = serverDb();
  const url = new URL(req.url);
  const startCursor =
    Number(req.headers.get('last-event-id') ?? url.searchParams.get('after') ?? '0') || 0;

  let cursor = startCursor;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (!closed) controller.enqueue(encoder.encode(s));
      };

      const poll = () => {
        const batch = events.sinceForProject(db, id, cursor);
        for (const e of batch) {
          cursor = e.id;
          send(`id: ${e.id}\nevent: build\ndata: ${JSON.stringify(e)}\n\n`);
        }
      };

      const pollTimer = setInterval(poll, 1000);
      const hbTimer = setInterval(() => send(': ping\n\n'), 15_000);

      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(hbTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}