'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Version {
  id: string;
  n: number;
  status: string;
}
interface Project {
  id: string;
  slug: string;
  name: string;
  idea?: string;
  status: string;
  publishedVersionId: string | null;
}
interface Message {
  id: string;
  role: string;
  content: string;
  meta?: {
    kind?: 'done' | 'error';
    version?: number;
    name?: string;
    category?: string;
    summary?: string;
    features?: string[];
    files?: number;
    error?: string;
  } | null;
}
interface FileMeta {
  path: string;
  size: number;
}
interface Stage {
  k: number;
  n: number;
  label: string;
}

const STAGES = ['需求分析与架构', '生成代码', '代码自检', '构建容器', '启动与健康检查', '发布就绪'];

const navLink: React.CSSProperties = { color: '#9ab', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 };
const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px',
  borderRadius: 8,
  border: '1px solid ' + (active ? '#4267ff' : '#2a2a2c'),
  background: active ? '#1b2350' : 'transparent',
  color: active ? '#dfe6ff' : '#9aa',
  cursor: 'pointer',
  fontSize: 13,
});

function friendly(msg: string): string {
  if (!msg) return '正在处理…';
  if (msg.includes('spec ready')) return '已完成需求分析与架构设计';
  if (msg.includes('completeness')) return '正在补齐缺失文件';
  if (msg.includes('build: start')) return '正在构建';
  if (msg.includes('build: done')) return '构建完成';
  if (msg.includes('run: start')) return '正在启动预览';
  if (msg.includes('repair')) return '遇到问题，正在自动修复';
  if (msg.includes('attempt failed')) return '遇到问题，正在重试';
  if (msg.includes('ready')) return '已就绪';
  return msg.replace(/\[[^\]]*\]/g, '').trim() || '正在处理…';
}

function Avatar({ role }: { role: 'user' | 'assistant' }) {
  const isUser = role === 'user';
  return (
    <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: isUser ? '#4267ff' : '#2a2f45', color: '#fff', marginTop: 2 }}>
      {isUser ? 'U' : 'AI'}
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const isUser = m.role === 'user';
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
      <Avatar role={isUser ? 'user' : 'assistant'} />
      <div style={{ maxWidth: '82%', padding: '9px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: isUser ? '#1b2350' : '#161618', border: isUser ? '1px solid #26306a' : '1px solid #26262a', color: isUser ? '#e7ecff' : '#d7dade', borderTopRightRadius: isUser ? 4 : 12, borderTopLeftRadius: isUser ? 12 : 4 }}>
        {!isUser && <div style={{ fontSize: 11, color: '#7d9aff', marginBottom: 3, fontWeight: 600 }}>Alex · 工程师</div>}
        {m.content}
      </div>
    </div>
  );
}

function CompletionCard({
  m,
  onPreview,
  onOpen,
  onChip,
}: {
  m: Message;
  onPreview: () => void;
  onOpen: () => void;
  onChip: (text: string) => void;
}) {
  const meta: any = m.meta ?? {};
  const features = meta.features ?? [];
  const chips =
    features.length > 0
      ? features.slice(0, 3).map((f: string) => `优化：${f}`)
      : meta.category === 'game'
        ? ['加 Boss / 关卡', '加音效与动画', '性能与手感优化']
        : ['加筛选 / 搜索', '加数据导出', '移动端适配'];
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-start' }}>
      <Avatar role="assistant" />
      <div style={{ maxWidth: '86%', borderRadius: 12, borderTopLeftRadius: 4, background: '#12241a', border: '1px solid #27623c', padding: '12px 14px', fontSize: 13.5, color: '#dff3e6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#5ad17a', fontWeight: 700 }}>Alex · 工程师</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9fe3b4' }}>版本 v{meta.version ?? '?'}</span>
        </div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>✅ {meta.name ?? '已完成'}</div>
        {meta.summary && <div style={{ color: '#bfe9cd', marginBottom: 8 }}>{meta.summary}</div>}
        {features.length > 0 && (
          <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: '#cdebd7' }}>
            {features.slice(0, 6).map((f: string, i: number) => (
              <li key={i} style={{ marginBottom: 2 }}>{f}</li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={onPreview} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#2e6b3f', color: '#eafff1', cursor: 'pointer', fontSize: 12 }}>预览</button>
          <button onClick={onOpen} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #2e6b3f', background: 'transparent', color: '#bfe9cd', cursor: 'pointer', fontSize: 12 }}>新窗口打开</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chips.map((c: string) => (
            <button key={c} onClick={() => onChip(c)} style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid #2e6b3f', background: '#0f1a13', color: '#bfe9cd', cursor: 'pointer', fontSize: 12 }}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StageProgress({ stage, activeStatus, queueHint, pending }: { stage: Stage | null; activeStatus?: string; queueHint?: string; pending?: number }) {
  const k = stage?.k ?? 0;
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-start' }}>
      <Avatar role="assistant" />
      <div style={{ borderRadius: 12, borderTopLeftRadius: 4, background: '#161618', border: '1px solid #26262a', padding: '10px 12px', color: '#cfd6e0', fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#7d9aff', fontWeight: 600 }}>Alex · 工程师</span>
          <span style={{ fontSize: 11, color: '#889' }}>
            {activeStatus === 'queued' ? '排队中…' : stage ? `第 ${stage.k}/${stage.n} 步` : queueHint || '处理中…'}
            {pending && pending > 0 ? `（另有 ${pending} 个排队）` : ''}
          </span>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#7d9aff', marginLeft: 4 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
          {STAGES.map((label, i) => {
            const idx = i + 1;
            const done = k > idx;
            const current = k === idx;
            return (
              <div key={label} style={{ color: done ? '#5ad17a' : current ? '#dfe6ff' : '#5b6270', fontSize: 12 }}>
                {done ? '✓' : current ? '●' : '○'} {label}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [statusLine, setStatusLine] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<{ status: string; type: string } | null>(null);
  const [pending, setPending] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const prevStatus = useRef<string>('');

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}`);
    const d = await r.json();
    setProject(d.project ?? null);
    setVersions(d.versions ?? []);
    setMessages(d.messages ?? []);
    setActiveJob(d.activeJob ?? null);
    setPending(d.pending ?? 0);
  }, [id]);

  useEffect(() => {
    refresh();
    const es = new EventSource(`/api/projects/${id}/events`);
    esRef.current = es;
    const onBuild = (ev: MessageEvent) => {
      try {
        const e = JSON.parse(ev.data);
        if (e.data) {
          try {
            const payload = JSON.parse(e.data);
            if (payload && payload.kind === 'stage') {
              setStage({ k: payload.k, n: payload.n, label: payload.label });
            }
          } catch {
            /* not structured */
          }
        }
        setStatusLine(friendly(String(e.message)));
        refresh();
      } catch {
        /* ignore */
      }
    };
    es.addEventListener('build', onBuild as EventListener);
    return () => {
      es.removeEventListener('build', onBuild as EventListener);
      es.close();
    };
  }, [id, refresh]);

  const latestReady = [...versions].filter((v) => v.status === 'ready').sort((a, b) => b.n - a.n)[0];
  const published = Boolean(project?.publishedVersionId);
  const activeJobBusy = Boolean(activeJob && ['queued', 'leased', 'running'].includes(activeJob.status));
  const building = project?.status === 'building' || busy || activeJobBusy;

  useEffect(() => {
    const s = project?.status ?? '';
    if (prevStatus.current === 'building' && s === 'ready') {
      setToast('✅ 生成完成，可在右侧预览或点击「发布」');
      setTimeout(() => setToast(null), 4500);
    } else if (prevStatus.current === 'building' && s === 'failed') {
      setToast('⚠️ 本次生成未完成，可继续对话或重试');
      setTimeout(() => setToast(null), 4500);
    }
    prevStatus.current = s;
  }, [project?.status]);

  const baseMessages: Message[] = messages.length
    ? messages
    : project
      ? [
          { id: '__idea', role: 'user', content: project.idea ?? project.name },
          ...(latestReady
            ? [{ id: '__done', role: 'assistant', content: `✅ 已生成 v${latestReady.n}《${project.name}》。可在右侧「预览」查看，或点「发布」获取链接。` }]
            : []),
        ]
      : [];

  const openFile = useCallback(
    async (path: string) => {
      setSel(path);
      try {
        const c = await (await fetch(`/api/projects/${id}/files?path=${encodeURIComponent(path)}`)).json();
        setCode(c.content ?? '');
      } catch {
        setCode('');
      }
    },
    [id],
  );

  useEffect(() => {
    if (tab !== 'code' || !latestReady) return;
    let alive = true;
    (async () => {
      try {
        const d = await (await fetch(`/api/projects/${id}/files`)).json();
        if (!alive) return;
        const list: FileMeta[] = d.files ?? [];
        setFiles(list);
        const pick = sel && list.some((f) => f.path === sel) ? sel : list[0]?.path;
        if (pick) openFile(pick);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, latestReady, id, openFile, sel]);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setInput('');
    setBusy(true);
    setStatusLine('正在按你的要求处理');
    try {
      await fetch(`/api/projects/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    await fetch(`/api/projects/${id}/retry`, { method: 'POST' });
    await refresh();
  }

  async function publish(p: boolean) {
    await fetch(`/api/projects/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: p }),
    });
    await refresh();
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '6px 14px', flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid #222', background: '#121214' }}>
        <Link href="/dashboard" style={navLink}>← 项目列表</Link>
        <Link href="/" style={navLink}>首页</Link>
        <span style={{ width: 1, height: 16, background: '#333' }} />
        <span style={{ fontWeight: 700, maxWidth: 420, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={project?.name}>
          {project?.name ?? '加载中…'}
        </span>
        <span style={{ fontSize: 12, color: building ? '#e0b44a' : project?.status === 'ready' ? '#5ad17a' : '#777' }}>
          {building ? (activeJob?.status === 'queued' ? '排队中' : `正在处理${pending > 0 ? ` · ${pending} 个排队` : ''}`) : project?.status ?? ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {project?.status === 'failed' && (
            <button onClick={retry} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #5a3a3a', background: '#2a1618', color: '#f2b8b5', cursor: 'pointer', fontSize: 13 }}>重试</button>
          )}
          <button onClick={() => publish(!published)} disabled={!latestReady} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: published ? '#3a2a12' : '#1e3a1e', color: '#fff', cursor: latestReady ? 'pointer' : 'not-allowed', fontSize: 13 }}>
            {published ? '取消发布' : '发布'}
          </button>
          {published && project && (
            <a href={`/p/${project.slug}`} target="_blank" rel="noreferrer" style={{ color: '#7d9aff', fontSize: 13 }}>打开公开链接 ↗</a>
          )}
        </div>
      </header>

      {toast && (
        <div style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: '#1c3a24', border: '1px solid #2e6b3f', color: '#d6f5df', padding: '10px 16px', borderRadius: 10, fontSize: 13, boxShadow: '0 6px 20px rgba(0,0,0,.4)' }}>
          {toast}
        </div>
      )}

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '420px 1fr', minHeight: 0 }}>
        <section style={{ borderRight: '1px solid #222', padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
            {baseMessages.length === 0 && !building && (
              <p style={{ color: '#777', fontSize: 13 }}>描述你的想法或修改，AI 会生成并迭代你的应用。</p>
            )}
            {baseMessages.map((m) =>
              m.role === 'assistant' && m.meta?.kind === 'done' ? (
                <CompletionCard
                  key={m.id}
                  m={m}
                  onPreview={() => setTab('preview')}
                  onOpen={() => {
                    const u = published && project ? `/p/${project.slug}` : latestReady ? `/preview/${id}/${latestReady.id}` : '';
                    if (u) window.open(u, '_blank');
                  }}
                  onChip={(text) => setInput(text)}
                />
              ) : (
                <Bubble key={m.id} m={m} />
              ),
            )}
            {building && <StageProgress stage={stage} activeStatus={activeJob?.status} queueHint={statusLine} pending={pending} />}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="继续对话修改…" style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #333', background: '#1a1a1c', color: '#eee' }} />
            <button onClick={send} disabled={busy} style={{ padding: '0 16px', borderRadius: 8, border: 'none', background: '#4267ff', color: '#fff', cursor: 'pointer' }}>发送</button>
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #222', fontSize: 12, color: '#888' }}>
            <button style={tabBtn(tab === 'preview')} onClick={() => setTab('preview')}>预览</button>
            <button style={tabBtn(tab === 'code')} onClick={() => setTab('code')}>代码</button>
            <span style={{ marginLeft: 8 }}>{latestReady ? `v${latestReady.n}` : building ? '生成中…' : '暂无版本'}</span>
            {tab === 'preview' && latestReady && (
              <a href={`/preview/${id}/${latestReady.id}`} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: '#7d9aff' }}>新窗口打开 ↗</a>
            )}
          </div>

          {tab === 'preview' ? (
            <div style={{ flex: 1, background: '#fff', minHeight: 0 }}>
              {latestReady ? (
                <iframe title="preview" src={`/preview/${id}/${latestReady.id}`} style={{ width: '100%', height: '100%', border: 'none' }} sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals" />
              ) : (
                <div style={{ color: '#555', padding: 24 }}>{building ? '正在生成，请稍候…' : '生成完成后将在此预览'}</div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', minHeight: 0, background: '#0e0e10' }}>
              <div style={{ width: 220, borderRight: '1px solid #222', overflowY: 'auto', padding: 6 }}>
                {files.length === 0 && <div style={{ color: '#666', fontSize: 12, padding: 8 }}>暂无文件</div>}
                {files.map((f) => (
                  <div key={f.path} onClick={() => openFile(f.path)} title={f.path} style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: sel === f.path ? '#1b2350' : 'transparent', color: sel === f.path ? '#dfe6ff' : '#9aa' }}>
                    {f.path}
                  </div>
                ))}
              </div>
              <pre style={{ flex: 1, margin: 0, padding: 12, overflow: 'auto', fontSize: 12, lineHeight: 1.5, color: '#cdd', fontFamily: 'monospace' }}>{code || '// 选择左侧文件查看内容'}</pre>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}