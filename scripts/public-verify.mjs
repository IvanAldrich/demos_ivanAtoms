// Verify a real generation on a public instance: create → wait → publish → check page + referenced assets.
// Usage: BASE_URL=http://47.97.47.74:3000 node scripts/public-verify.mjs ["idea"]
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const idea =
  process.argv[2] ||
  '一个可玩的贪吃蛇网页小游戏：方向键控制移动，吃到食物变长加分，撞墙或咬到自己结束并可重新开始，带完整页面样式';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idea, templateKey: 'game' }),
  });
  const { projectId, slug } = await r.json();
  console.log('project', projectId, 'slug', slug);

  let prev = '';
  for (let i = 0; i < 220; i++) {
    await sleep(1500);
    const d = await (await fetch(`${BASE}/api/projects/${projectId}`)).json();
    const vs = d.versions || [];
    const v = vs[vs.length - 1];
    const sig = v ? `${v.n}:${v.status}` : '';
    if (sig !== prev) {
      console.log(`[${i}] ${sig}`);
      prev = sig;
    }
    if (v && v.status === 'failed') {
      console.log('FAILED', v.error);
      return;
    }
    if (v && v.status === 'ready') {
      await fetch(`${BASE}/api/projects/${projectId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ published: true }),
      });
      const pageUrl = `${BASE}/p/${slug}`;
      const html = await (await fetch(pageUrl)).text();
      console.log('public page status ok, len', html.length);
      const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
      for (const ref of refs) {
        const url = `${BASE}/p/${slug}/${ref.replace(/^\.?\//, '')}`;
        const st = (await fetch(url)).status;
        console.log(`  asset ${ref}: ${st}`);
      }
      console.log('PUBLIC:', pageUrl);
      return;
    }
  }
  console.log('TIMEOUT');
})();