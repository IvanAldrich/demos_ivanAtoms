'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Project {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: number;
}

export default function DashboardPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ maxWidth: 820, margin: '60px auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 26 }}>我的项目</h1>
        <Link href="/" style={{ color: '#7d9aff', fontSize: 14 }}>
          + 新建
        </Link>
      </div>
      {loading ? (
        <p style={{ color: '#9a9a9a' }}>加载中…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#9a9a9a' }}>还没有项目，去首页创建一个吧。</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((p) => (
            <li
              key={p.id}
              style={{
                border: '1px solid #2a2a2c',
                borderRadius: 10,
                padding: 14,
                marginBottom: 10,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ color: '#888', fontSize: 12 }}>
                  {p.slug} · {p.status}
                </div>
              </div>
              <Link href={`/chat/${p.id}`} style={{ color: '#7d9aff' }}>
                打开 →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}