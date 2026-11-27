'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TEMPLATES } from '@/templates';

export default function HomePage() {
  const [idea, setIdea] = useState('');
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    if (!idea.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea, templateKey }),
      });
      const data = await res.json();
      if (data.projectId) router.push(`/chat/${data.projectId}`);
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '80px auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 34, marginBottom: 8 }}>IvanAtomsDemo</h1>
        <Link href="/dashboard" style={{ color: '#7d9aff', fontSize: 14 }}>
          我的项目 →
        </Link>
      </div>
      <p style={{ color: '#9a9a9a', marginTop: 0 }}>
        用一句话描述你的想法，AI 生成一个可运行的全栈网站，并可对话迭代、发布。
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTemplateKey(t.key);
              setIdea(t.exampleIdea);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: `1px solid ${templateKey === t.key ? '#4267ff' : '#333'}`,
              background: templateKey === t.key ? '#1b2350' : '#1a1a1c',
              color: '#ddd',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="例如：一个待办清单 app，可以增删任务并保存"
        style={{
          width: '100%',
          height: 140,
          padding: 12,
          borderRadius: 10,
          border: '1px solid #333',
          background: '#1a1a1c',
          color: '#eee',
          fontSize: 15,
        }}
      />
      <div style={{ marginTop: 12 }}>
        <button
          onClick={submit}
          disabled={busy}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            background: '#4267ff',
            color: '#fff',
            fontSize: 15,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? '创建中…' : '开始生成'}
        </button>
      </div>
    </main>
  );
}