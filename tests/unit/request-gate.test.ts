import { describe, it, expect } from 'vitest';
import { requestGate } from '../../src/engine/request-gate';

const base = [
  { path: 'server.js', content: "const express=require('express');const app=express();app.listen(3001);" },
  { path: 'assets/style.css', content: ':root{--bg:#fff;--primary:#4f46e5}' },
  { path: 'index.html', content: '<html></html>' },
];

describe('requestGate', () => {
  it('flags style request when CSS did not change', () => {
    expect(requestGate([...base], base, '主题换成水墨画风格')).toContain('style_not_changed');
  });

  it('passes style request when CSS changed', () => {
    const files = base.map((f) => (f.path === 'assets/style.css' ? { ...f, content: ':root{--paper:#f4efe2;--ink:#231f1a}' } : f));
    expect(requestGate(files, base, '主题换成水墨画风格')).toBeNull();
  });

  it('flags mobile request without touch+controls', () => {
    expect(requestGate([...base], base, '手机上需要摇杆')).toContain('mobile_controls_missing');
  });

  it('passes mobile request with touch handlers + joystick', () => {
    const files = [
      ...base,
      { path: 'assets/game.js', content: "el.addEventListener('touchstart',f);el.addEventListener('pointerdown',f);/* joystick */" },
    ];
    expect(requestGate(files, base, '手机上需要摇杆')).toBeNull();
  });

  it('flags crud request without POST route', () => {
    expect(requestGate([...base], base, '加一个添加任务功能')).toContain('api_post_missing');
  });

  it('passes crud request with POST route', () => {
    const files = base.map((f) =>
      f.path === 'server.js' ? { ...f, content: f.content + "app.post('/api/tasks',(q,s)=>s.end());" } : f,
    );
    expect(requestGate(files, base, '加一个添加任务功能')).toBeNull();
  });
});