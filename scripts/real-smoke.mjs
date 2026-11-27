// Real end-to-end smoke: create a project, wait for build, publish, fetch public page.
// Usage: BASE_URL=http://localhost:3000 node scripts/real-smoke.mjs "idea..."
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const IDEA =
  process.argv[2] ||
  '一个待办清单 app：可以添加任务、标记完成、删除，并把数据持久保存';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idea: IDEA, templateKey: 'tracker' }),
  });
  if (!r.ok) {
    console.log('create failed', r.status, await r.text());
    process.exit(1);
  }
  const { projectId, slug } = await r.json();
  console.log('created project', projectId, 'slug', slug);

  let prev = '';
  for (let i = 0; i < 220; i++) {
    await sleep(1500);
    const d = await (await fetch(`${BASE}/api/projects/${projectId}`)).json();
    const vs = d.versions || [];
    const v = vs[vs.length - 1];
    const sig = v ? `${v.n}:${v.status}` : 'none';
    if (sig !== prev) {
      console.log(`[${i}] version ${sig} project=${d.project?.status}`);
      prev = sig;
    }
    if (v && v.status === 'failed') {
      console.log('FINAL failed:', v.error);
      process.exit(3);
    }
    if (v && v.status === 'ready') {
      console.log('FINAL ready, containerIp =', v.containerIp);
      await fetch(`${BASE}/api/projects/${projectId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ published: true }),
      });
      const pub = await fetch(`${BASE}/p/${slug}`);
      const html = await pub.text();
      console.log('public /p/' + slug + ' status', pub.status, 'len', html.length);
      console.log('preview sample:', html.replace(/\s+/g, ' ').slice(0, 200));
      const items = await fetch(`${BASE}/p/${slug}/api/items`);
      console.log('generated /api/items status', items.status, (await items.text()).slice(0, 120));
      process.exit(0);
    }
  }
  console.log('TIMEOUT waiting for build');
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});