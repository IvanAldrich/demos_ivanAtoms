import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { checkHealth } from '../../src/sandbox/health';

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/500')) {
      res.statusCode = 500;
      res.end('boom');
      return;
    }
    if (req.url === '/index.html') {
      res.statusCode = 200;
      res.end('<html></html>');
      return;
    }
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe('checkHealth', () => {
  it('passes for 200', async () => {
    expect((await checkHealth(base)).ok).toBe(true);
  });

  it('requires index.html for static apps', async () => {
    expect((await checkHealth(base, { isStatic: true })).ok).toBe(true);
  });

  it('fails on non-200', async () => {
    const r = await checkHealth(`${base}/500`);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('http_status');
  });
});