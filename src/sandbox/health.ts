export interface HealthResult {
  ok: boolean;
  reason?: string;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a running app: GET / must be 200. For static apps, /index.html must also be 200.
 */
export async function checkHealth(
  baseUrl: string,
  opts: { isStatic?: boolean; timeoutMs?: number } = {},
): Promise<HealthResult> {
  const { isStatic = false, timeoutMs = 5000 } = opts;
  const root = baseUrl.replace(/\/+$/, '');

  try {
    const res = await fetchWithTimeout(`${root}/`, timeoutMs);
    if (res.status !== 200) {
      // Many static apps serve index at /index.html but not "/"; accept that.
      const idx = await fetchWithTimeout(`${root}/index.html`, timeoutMs);
      if (idx.status !== 200) return { ok: false, reason: `http_status_${res.status}` };
    }
    return { ok: true };
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name;
    return { ok: false, reason: name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}