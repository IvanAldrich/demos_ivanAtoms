/**
 * Rewrite HTML served under a sub-path so root-relative asset refs keep working:
 * - inject <base href="basePath/">
 * - strip the leading slash of src="/x" / href="/x" (but not protocol-relative //x)
 * - strip leading slash inside url(/x)
 */
export function rewriteHtml(html: string, basePath: string): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;

  let out = html
    .replace(/(\b(?:src|href)\s*=\s*)(["'])\/(?!\/)/g, (_m, p1: string, q: string) => `${p1}${q}`)
    .replace(/(url\(\s*["']?)\/(?!\/)/g, (_m, p1: string) => p1);

  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
  } else {
    out = `<base href="${base}">` + out;
  }
  return out;
}

export function joinUpstreamUrl(containerIp: string, port: number, pathAndQuery: string): string {
  const suffix = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return `http://${containerIp}:${port}${suffix}`;
}