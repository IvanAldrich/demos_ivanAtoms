import { describe, it, expect } from 'vitest';
import { validateArtifacts } from '../../src/engine/validate';
import { SiteSpecSchema } from '../../src/engine/schema';

const spec = SiteSpecSchema.parse({
  specVersion: 1,
  brief: {
    name: 'x',
    category: 'app',
    summary: 's',
    pages: [],
    userStories: [],
    dataModel: [],
  },
  fileManifest: [],
  techConstraints: {
    runtime: 'node22-cjs',
    entry: 'server.js',
    startCmd: 'node server.js',
    port: 3000,
    dataDirEnv: 'DATA_DIR',
    persistence: 'json',
    deps: ['express'],
    assetPaths: 'relative',
    noAbsoluteRoot: true,
    noWebSocket: true,
  },
});

const entry = 'const express=require("express");const app=express();app.get("/",(q,s)=>s.send("ok"));app.listen(process.env.PORT||3001);';
const ok = [{ path: 'server.js', content: entry }];

describe('validateArtifacts', () => {
  it('passes for a valid entry', () => {
    expect(validateArtifacts({ files: ok, spec, mode: 'initial' }).ok).toBe(true);
  });

  it('flags E_ENTRY_MISSING', () => {
    const r = validateArtifacts({ files: [{ path: 'other.js', content: 'x' }], spec, mode: 'initial' });
    expect(r.violations.map((v) => v.code)).toContain('E_ENTRY_MISSING');
  });

  it('flags E_ABS_PATH', () => {
    const r = validateArtifacts({
      files: [{ path: 'server.js', content: `${entry}\nconst h='<img src="/a.png">';` }],
      spec,
      mode: 'initial',
    });
    expect(r.violations.map((v) => v.code)).toContain('E_ABS_PATH');
  });

  it('flags E_FORBIDDEN_MODULE for ESM', () => {
    const r = validateArtifacts({
      files: [{ path: 'server.js', content: `import x from 'y';\n${entry}` }],
      spec,
      mode: 'initial',
    });
    expect(r.violations.map((v) => v.code)).toContain('E_FORBIDDEN_MODULE');
  });

  it('flags E_FORBIDDEN_DEP for non-allowlisted dependency', () => {
    const r = validateArtifacts({
      files: [{ path: 'server.js', content: `const _=require('lodash');\n${entry}` }],
      spec,
      mode: 'initial',
    });
    expect(r.violations.map((v) => v.code)).toContain('E_FORBIDDEN_DEP');
  });

  it('flags E_FILE_BUDGET for too many files', () => {
    const files = [{ path: 'server.js', content: entry }, ...Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.js`, content: 'x' }))];
    const r = validateArtifacts({ files, spec, mode: 'initial' });
    expect(r.violations.map((v) => v.code)).toContain('E_FILE_BUDGET');
  });

  it('flags E_PKG_INVALID', () => {
    const r = validateArtifacts({ files: [{ path: 'package.json', content: '{bad' }, ...ok], spec, mode: 'initial' });
    expect(r.violations.map((v) => v.code)).toContain('E_PKG_INVALID');
  });

  it('flags E_MISSING_ASSET when referenced asset is not generated', () => {
    const html = {
      path: 'index.html',
      content:
        '<link rel="stylesheet" href="assets/style.css"><canvas></canvas><script src="assets/game.js"></script>',
    };
    const r = validateArtifacts({ files: [html, ...ok], spec, mode: 'initial' });
    expect(r.violations.map((v) => v.code)).toContain('E_MISSING_ASSET');
  });

  it('passes when all referenced assets exist', () => {
    const html = {
      path: 'index.html',
      content: '<link rel="stylesheet" href="assets/style.css"><script src="assets/game.js"></script>',
    };
    const files = [
      html,
      { path: 'assets/style.css', content: 'body{color:#fff}' },
      { path: 'assets/game.js', content: 'console.log(1)' },
      ...ok,
    ];
    expect(validateArtifacts({ files, spec, mode: 'initial' }).ok).toBe(true);
  });
});