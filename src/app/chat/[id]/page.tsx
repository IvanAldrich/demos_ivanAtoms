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
  status: string;
  publishedVersionId: string | null;
}
interface Message {
  id: string;
  role: string;
  content: string;
}
interface FileMeta {
  path: string;
  size: number;
}

const navLink: React.CSSProperties = {
  color: '#9ab',
  fontSize: 13,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};
const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px',
  borderRadius: 8,
  border: '1px solid ' + (active ? '#4267ff' : '#2a2a2c'),
  background: active ? '#1b2350' : 'transparent',
  color: active ? '#dfe6ff' : '#9aa',
  cursor: 'pointer',
  fontSize: 13,
});

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}`);
    const d = await r.json();
    setProject(d.project ?? null);
    setVersions(d.versions ?? []);
    setMessages(d.messages ?? []);
  }, [id]);

  useEffect(() => {
    refresh();
    const es = new EventSource(`/api/projects/${id}/events`);
    esRef.current = es;
    const onBuild = (ev: MessageEvent) => {
      try {
        const e = JSON.parse(ev.data);
        setLog((prev) => [...prev.slice(-60), `[${e.level}] ${e.message}`]);
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
  const building = project?.status === 'building';

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
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px 14px',
          flexWrap: 'wrap',
          padding: '10px 16px',
          borderBottom: '1px solid #222',
          background: '#121214',
        }}
      >
        <Link href="/dashboard" style={navLink}>← 项目列表</Link>
        <Link href="/" style={navLink}>首页</Link>
        <span style={{ width: 1, height: 16, background: '#333' }} />
        <span style={{ fontWeight: 700, maxWidth: 420, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={project?.name}>
          {project?.name ?? '加载中…'}
        </span>
        <span style={{ fontSize: 12, color: building ? '#e0b44a' : '#777' }}>
          {building ? '构建中…' : project?.status ?? ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => publish(!published)}
            disabled={!latestReady}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: published ? '#3a2a12' : '#1e3a1e', color: '#fff', cursor: latestReady ? 'pointer' : 'not-allowed', fontSize: 13 }}
          >
            {published ? '取消发布' : '发布'}
          </button>
          {published && project && (
            <a href={`/p/${project.slug}`} target="_blank" rel="noreferrer" style={{ color: '#7d9aff', fontSize: 13 }}>
              打开公开链接 ↗
            </a>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '380px 1fr', minHeight: 0 }}>
        {/* conversation */}
        <section style={{ borderRight: '1px solid #222', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
            {messages.length === 0 && (
              <p style={{ color: '#777', fontSize: 13 }}>这是你与 AI 的对话。描述你想要的修改（如：把标题改蓝色、加一个联系表单、给游戏加计分）。</p>
            )}
            {messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                <span style={{ display: 'inline-block', padding: '7px 11px', borderRadius: 8, background: m.role === 'user' ? '#1b2350' : '#171719', border: m.role === 'user' ? 'none' : '1px solid #26262a', fontSize: 13, lineHeight: 1.5, maxWidth: '92%', textAlign: 'left' }}>
                  {m.role !== 'user' && <b style={{ color: '#7d9aff', fontWeight: 600 }}>AI · </b>}
                  {m.content}
                </span>
              </div>
            ))}
            {log.length > 0 && (
              <div ref={logRef} style={{ marginTop: 10, borderTop: '1px solid #1c1c1e', paddingTop: 8 }}>
                {log.slice(-12).map((l, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#6f7f8f', fontFamily: 'monospace' }}>{l}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="继续对话修改…"
              style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #333', background: '#1a1a1c', color: '#eee' }}
            />
            <button onClick={send} disabled={busy} style={{ padding: '0 16px', borderRadius: 8, border: 'none', background: '#4267ff', color: '#fff', cursor: 'pointer' }}>
              发送
            </button>
          </div>
        </section>

        {/* preview / code */}
        <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #222', fontSize: 12, color: '#888' }}>
            <button style={tabBtn(tab === 'preview')} onClick={() => setTab('preview')}>预览</button>
            <button style={tabBtn(tab === 'code')} onClick={() => setTab('code')}>代码</button>
            <span style={{ marginLeft: 8 }}>{latestReady ? `v${latestReady.n}` : building ? '生成中…' : '暂无版本'}</span>
            {tab === 'preview' && latestReady && (
              <a href={`/preview/${id}/${latestReady.id}`} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: '#7d9aff' }}>
                新窗口打开 ↗
              </a>
            )}
          </div>

          {tab === 'preview' ? (
            <div style={{ flex: 1, background: '#fff', minHeight: 0 }}>
              {latestReady ? (
                <iframe
                  title="preview"
                  src={`/preview/${id}/${latestReady.id}`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
                />
              ) : (
                <div style={{ color: '#555', padding: 24 }}>{building ? '正在生成，请稍候…' : '生成完成后将在此预览'}</div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', minHeight: 0, background: '#0e0e10' }}>
              <div style={{ width: 220, borderRight: '1px solid #222', overflowY: 'auto', padding: 6 }}>
                {files.length === 0 && <div style={{ color: '#666', fontSize: 12, padding: 8 }}>暂无文件</div>}
                {files.map((f) => (
                  <div
                    key={f.path}
                    onClick={() => openFile(f.path)}
                    title={f.path}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      background: sel === f.path ? '#1b2350' : 'transparent',
                      color: sel === f.path ? '#dfe6ff' : '#9aa',
                    }}
                  >
                    {f.path}
                  </div>
                ))}
              </div>
              <pre style={{ flex: 1, margin: 0, padding: 12, overflow: 'auto', fontSize: 12, lineHeight: 1.5, color: '#cdd', fontFamily: 'monospace' }}>
                {code || '// 选择左侧文件查看内容'}
              </pre>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}