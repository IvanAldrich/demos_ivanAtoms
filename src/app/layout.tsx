import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'IvanAtomsDemo',
  description: '想法 → 可运行网站',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0f0f10', color: '#eaeaea' }}>
        {children}
      </body>
    </html>
  );
}