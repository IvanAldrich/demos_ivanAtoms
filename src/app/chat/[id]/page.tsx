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

const navLink: React.CSSProperties = { color: '#9ab', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 };

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);

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
        setLog((prev) => [...prev.slice(-80), `[${e.level}] ${e.message}`]);
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

  async function publish(published: boolean) {
    await fetch(`/api/projects/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published }),
    });
    await refresh();
  }

  const latestReady = [...versions].filter((v) => v.status === 'ready').sort((a, b) => b.n - a.n)[0];
  const published = Boolean(project?.publishedVersionId);
  const building = project?.status === 'building';

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
        <Link href="/dashboard" style={navLink}>
          ← 项目列表
        </Link>
        <Link href="/" style={navLink}>
          首页
        </Link>
        <span style={{ width: 1, height: 16, background: '#333' }} />
        <span
          style={{
            fontWeight: 700,
            maxWidth: 420,
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={project?.name}
        >
          {project?.name ?? '加载中…'}
        </span>
        <span style={{ fontSize: 12, color: building ? '#e0b44a' : '#777' }}>
          {building ? '构建中…' : project?.status ?? ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => publish(!published)}
            disabled={!latestReady}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              background: published ? '#3a2a12' : '#1e3a1e',
              color: '#fff',
              cursor: latestReady ? 'pointer' : 'not-allowed',
              fontSize: 13,
            }}
          >
            {published ? '取消发布' : '发布'}
          </button>
          {published && project && (
            <a
              href={`/p/${project.slug}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#7d9aff', fontSize: 13 }}
            >
              打开公开链接 ↗
            </a>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '380px 1fr', minHeight: 0 }}>
        <section
          style={{
            borderRight: '1px solid #222',
            padding: 16,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
            {messages.length === 0 && (
              <p style={{ color: '#777', fontSize: 13 }}>
                这是你与 AI 的对话。描述你想要的修改（如：把标题改蓝色、加一个联系表单、给游戏加计分）。
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: m.role === 'user' ? '#1b2350' : '#1a1a1c',
                    fontSize: 13,
                    maxWidth: '90%',
                  }}
                >
                  {m.content}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="继续对话修改…"
              style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #333', background: '#1a1a1c', color: '#eee' }}
            />
            <button
              onClick={send}
              disabled={busy}
              style={{ padding: '0 16px', borderRadius: 8, border: 'none', background: '#4267ff', color: '#fff', cursor: 'pointer' }}
            >
              发送
            </button>
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderBottom: '1px solid #222',
              fontSize: 12,
              color: '#888',
            }}
          >
            <span>{latestReady ? `预览 · 最新版本 v${latestReady.n}` : building ? '生成中…' : '暂无可用版本'}</span>
            {latestReady && (
              <a href={`/preview/${id}/${latestReady.id}`} target="_blank" rel="noreferrer" style={{ color: '#7d9aff' }}>
                新窗口打开 ↗
              </a>
            )}
          </div>

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

          <div
            style={{
              height: 130,
              overflowY: 'auto',
              borderTop: '1px solid #222',
              padding: 10,
              fontFamily: 'monospace',
              fontSize: 12,
              background: '#0b0b0c',
              color: '#9aa',
            }}
          >
            {log.length === 0 ? '构建日志：等待中…' : log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </section>
      </div>
    </main>
  );
}