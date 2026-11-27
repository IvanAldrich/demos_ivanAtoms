import { rewriteHtml, joinUpstreamUrl } from '../sandbox/proxy-url';

/** Forward a request to a run container, rewriting HTML for sub-path hosting. */
export async function proxyTo(
  req: Request,
  containerIp: string,
  port: number,
  basePath: string,
  segments: string[],
): Promise<Response> {
  const url = new URL(req.url);
  const upstreamPath = `/${segments.join('/')}${url.search}`;
  const upstream = joinUpstreamUrl(containerIp, port, upstreamPath);

  const headers = new Headers(req.headers);
  headers.delete('cookie');
  headers.delete('host');

  const method = req.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer();

  let res: Response;
  try {
    res = await fetch(upstream, { method, headers, body, redirect: 'manual' });
  } catch {
    return new Response('upstream_unreachable', { status: 502 });
  }

  const ct = res.headers.get('content-type') ?? '';
  const outHeaders = new Headers(res.headers);
  outHeaders.delete('set-cookie');
  outHeaders.delete('content-encoding');
  outHeaders.delete('content-length');

  if (ct.includes('text/html')) {
    const text = await res.text();
    return new Response(rewriteHtml(text, basePath), { status: res.status, headers: outHeaders });
  }
  return new Response(res.body, { status: res.status, headers: outHeaders });
}