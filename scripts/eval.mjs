// On-demand stability eval against a running server+worker (real model).
// Usage: BASE_URL=http://localhost:3000 npm run eval
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { name: 'todo-crud', idea: '一个待办清单应用：可以添加、标记完成、删除任务并持久保存' },
  { name: 'theme-ink', idea: '一个待办清单应用，整体视觉改成水墨画风格' },
  { name: 'mobile-joystick', idea: '一个手机可玩的贪吃蛇小游戏，需要屏幕摇杆和方向键' },
];

async function create(idea) {
  const r = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idea }),
  });
  return r.json();
}
const detail = async (id) => (await fetch(`${BASE}/api/projects/${id}`)).json();
async function getFiles(id) {
  const d = await (await fetch(`${BASE}/api/projects/${id}/files`)).json();
  const out = {};
  for (const f of d.files || []) {
    const c = await (await fetch(`${BASE}/api/projects/${id}/files?path=${encodeURIComponent(f.path)}`)).json();
    out[f.path] = c.content || '';
  }
  return out;
}
function checks(idea, files) {
  const all = Object.values(files).join('\n');
  const res = [];
  if (/主题|风格|水墨|配色|颜色/.test(idea)) {
    const css = Object.entries(files).filter(([p]) => /\.css$/i.test(p)).map(([, c]) => c).join('\n');
    res.push(['css_present', css.length > 0]);
    res.push(['css_substantial', css.length > 200]);
  }
  if (/手机|摇杆|触控|移动/.test(idea)) {
    res.push(['touch', /touchstart|pointerdown|touchmove/i.test(all)]);
    res.push(['controls', /joystick|dpad|摇杆|方向键/i.test(all)]);
  }
  if (/添加|新增|删除|提交|保存/.test(idea)) {
    res.push(['post_route', /app\.post\(/i.test(files['server.js'] || '')]);
  }
  return res;
}

(async () => {
  const rows = [];
  for (const c of CASES) {
    const t0 = Date.now();
    const { projectId, slug } = await create(c.idea);
    let prev = '';
    let v;
    for (let i = 0; i < 650; i++) {
      await sleep(1500);
      const d = await detail(projectId);
      const vs = d.versions || [];
      v = vs[vs.length - 1];
      const sig = v ? `${v.n}:${v.status}` : 'none';
      if (sig !== prev) {
        console.log(`[${c.name}] ${sig} active=${JSON.stringify(d.activeJob)} pending=${d.pending}`);
        prev = sig;
      }
      if (v && (v.status === 'ready' || v.status === 'failed')) break;
    }
    const ms = Date.now() - t0;
    let chk = [];
    if (v && v.status === 'ready') {
      try {
        chk = checks(c.idea, await getFiles(projectId));
      } catch {
        /* ignore */
      }
    }
    const pass = Boolean(v && v.status === 'ready' && chk.every(([, ok]) => ok));
    rows.push({ case: c.name, status: v?.status, ms, slug, pass, checks: chk.map(([k, ok]) => `${k}:${ok ? '✓' : '✗'}`).join(' ') });
  }
  console.log('\n=== EVAL SUMMARY ===');
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.case}  status=${r.status}  ${Math.round(r.ms / 1000)}s  /p/${r.slug}  ${r.checks}`);
  }
})();