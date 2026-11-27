// Dev tool: create a project, wait, then inspect generated files on disk.
// Usage: node scripts/gen-check.mjs "<idea>" [templateKey]
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const idea =
  process.argv[2] ||
  '一个可玩的贪吃蛇网页小游戏：方向键控制移动，吃到食物变长加分，撞墙或咬到自己结束并可重新开始，带完整页面样式';
const tk = process.argv[3] || 'game';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function walk(d, base = d) {
  const out = [];
  if (!fs.existsSync(d)) return out;
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    const s = fs.statSync(f);
    if (s.isDirectory()) out.push(...walk(f, base));
    else out.push({ path: path.relative(base, f), size: s.size });
  }
  return out;
}

(async () => {
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idea, templateKey: tk }),
  });
  const { projectId, slug } = await r.json();
  console.log('project', projectId, slug);

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
    if (v && v.status === 'ready') {
      const dir = `storage/projects/${projectId}/versions/v${v.n}`;
      const files = walk(dir);
      console.log('FILES:');
      for (const f of files) console.log('  ', f.path, `${f.size}B`);
      const js = files.find((f) => /game\.js$/.test(f.path));
      if (js) {
        const c = fs.readFileSync(path.join(dir, js.path), 'utf8');
        console.log('game.js canvas:', /canvas/i.test(c), 'key-handler:', /keydown|addEventListener\(\s*["']key/i.test(c));
      }
      console.log('has style.css:', Boolean(files.find((f) => /style\.css$/.test(f.path))));
      console.log('PUBLIC:', `${BASE.replace(/\/$/, '')}/p/${slug}`);
      return;
    }
    if (v && v.status === 'failed') {
      console.log('FAILED', v.error);
      return;
    }
  }
  console.log('TIMEOUT');
})();