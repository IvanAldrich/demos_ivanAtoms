'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

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

  const latestReady = [...versions]
    .filter((v) => v.status === 'ready')
    .sort((a, b) => b.n - a.n)[0];
  const published = Boolean(project?.publishedVersionId);

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '380px 1fr', height: '100vh' }}>
      <section
        style={{ borderRight: '1px solid #222', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{project?.name ?? '项目'}</div>
        <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          状态：{project?.status ?? '-'} · 版本 {versions.length}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
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
            placeholder="继续对话修改，如：把标题改成蓝色、加一个联系表单"
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

      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #222' }}>
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
            }}
          >
            {published ? '取消发布' : '发布'}
          </button>
          {published && project && (
            <a href={`/p/${project.slug}`} target="_blank" rel="noreferrer" style={{ color: '#7d9aff', fontSize: 13 }}>
              公开链接 /p/{project.slug} ↗
            </a>
          )}
          <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>
            {latestReady ? `最新版本 v${latestReady.n}` : '构建中…'}
          </span>
        </div>

        <div style={{ flex: 1, background: '#fff' }}>
          {latestReady ? (
            <iframe
              title="preview"
              src={`/preview/${id}/${latestReady.id}`}
              style={{ width: '100%', height: '100%', border: 'none' }}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
            />
          ) : (
            <div style={{ color: '#555', padding: 24 }}>生成中，稍候…</div>
          )}
        </div>

        <div
          style={{
            height: 140,
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
    </main>
  );
}