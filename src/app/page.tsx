'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    if (!idea.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea }),
      });
      const data = await res.json();
      if (data.projectId) router.push(`/chat/${data.projectId}`);
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '90px auto', padding: 20 }}>
      <h1 style={{ fontSize: 34, marginBottom: 8 }}>IvanAtomsDemo</h1>
      <p style={{ color: '#9a9a9a', marginTop: 0 }}>
        用一句话描述你的想法，AI 生成一个可运行的全栈网站，并可对话迭代、发布。
      </p>
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="例如：一个待办清单 app，可以增删任务并保存"
        style={{ width: '100%', height: 140, padding: 12, borderRadius: 10, border: '1px solid #333', background: '#1a1a1c', color: '#eee', fontSize: 15 }}
      />
      <div style={{ marginTop: 12 }}>
        <button
          onClick={submit}
          disabled={busy}
          style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#4267ff', color: '#fff', fontSize: 15, cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? '创建中…' : '开始生成'}
        </button>
      </div>
    </main>
  );
}