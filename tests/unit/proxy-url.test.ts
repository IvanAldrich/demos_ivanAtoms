import { describe, it, expect } from 'vitest';
import { rewriteHtml, joinUpstreamUrl } from '../../src/sandbox/proxy-url';

describe('rewriteHtml', () => {
  it('injects <base> and relativizes root-relative attrs', () => {
    const html = '<html><head></head><body><img src="/a.png"><a href="/b">x</a></body></html>';
    const out = rewriteHtml(html, '/p/abc');
    expect(out).toContain('<base href="/p/abc/">');
    expect(out).toContain('src="a.png"');
    expect(out).toContain('href="b"');
  });

  it('does not touch protocol-relative urls', () => {
    const out = rewriteHtml('<img src="//cdn/x.png">', '/p/x');
    expect(out).toContain('src="//cdn/x.png"');
  });

  it('adds <base> when no head tag', () => {
    const out = rewriteHtml('<body>hi</body>', '/p/x');
    expect(out.startsWith('<base href="/p/x/">')).toBe(true);
  });
});

describe('joinUpstreamUrl', () => {
  it('builds upstream url', () => {
    expect(joinUpstreamUrl('172.18.0.2', 3001, '/api/items?a=1')).toBe(
      'http://172.18.0.2:3001/api/items?a=1',
    );
  });
});