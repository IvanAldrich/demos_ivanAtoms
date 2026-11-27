import type { SiteSpec, Violation, ViolationCode } from './schema';
import type { FileEntry } from '../lib/files';

const NODE_BUILTINS = new Set([
  'fs', 'path', 'http', 'https', 'url', 'crypto', 'os', 'util', 'events',
  'stream', 'zlib', 'assert', 'child_process', 'net', 'tty', 'querystring', 'buffer',
]);
const ALLOWED_DEPS = new Set(['express']);

const MAX_FILES = 12;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024;

function violation(
  code: ViolationCode,
  message: string,
  path?: string,
  fixHint?: string,
): Violation {
  return { code, message, path, fixHint };
}

function detectAbsoluteRoot(content: string): boolean {
  // Only client-side resource references; server route strings (app.get('/api/x')) are fine.
  return (
    /(?:src|href)\s*=\s*["']\/[^/]/.test(content) ||
    /fetch\(\s*["']\/[^/]/.test(content) ||
    /url\(\s*["']?\/[^/]/.test(content)
  );
}

function detectEsm(content: string): boolean {
  return (
    /\bimport\s+[^\n;]*\bfrom\s+["']/.test(content) ||
    /\bexport\s+(default|const|function|class)\b/.test(content) ||
    /\.(ts|tsx)\b/.test(content) ||
    /\bvite\b/i.test(content) ||
    /\bwebpack\b/i.test(content)
  );
}

function detectForbiddenDeps(content: string): string[] {
  const out: string[] = [];
  const re = /require\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const dep = m[1];
    if (dep.startsWith('.') || dep.startsWith('/')) continue;
    if (ALLOWED_DEPS.has(dep) || NODE_BUILTINS.has(dep) || dep.startsWith('node:')) continue;
    out.push(dep);
  }
  return out;
}

function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function extractLocalRefs(content: string, filePath: string): string[] {
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    let u = m[1].trim();
    if (/^(https?:)?\/\//i.test(u) || /^(data:|mailto:|tel:|#)/i.test(u)) continue;
    u = u.split('?')[0].split('#')[0];
    if (!u) continue;
    const resolved = u.startsWith('/') ? u.slice(1) : dir ? `${dir}/${u}` : u;
    const norm = normalizePath(resolved);
    if (norm) out.push(norm);
  }
  return out;
}

/** Local files referenced by HTML but not present in the generated file set. */
export function findMissingAssets(files: FileEntry[]): string[] {
  const present = new Set(files.map((f) => f.path));
  const missing = new Set<string>();
  for (const f of files) {
    if (!/\.html?$/i.test(f.path)) continue;
    for (const ref of extractLocalRefs(f.content, f.path)) {
      if (!present.has(ref)) missing.add(ref);
    }
  }
  return [...missing];
}

export function validateArtifacts(input: {
  files: FileEntry[];
  spec: SiteSpec;
  mode: 'initial' | 'iterate';
}): { ok: boolean; violations: Violation[] } {
  const { files, spec } = input;
  const violations: Violation[] = [];
  const filePaths = new Set(files.map((f) => f.path));

  const entry = spec.techConstraints.entry || 'server.js';
  if (!files.some((f) => f.path === entry)) {
    violations.push(
      violation('E_ENTRY_MISSING', `entry ${entry} not found`, entry, 'include the entry file'),
    );
  }

  const total = files.reduce((s, f) => s + Buffer.byteLength(f.content, 'utf8'), 0);
  if (files.length > MAX_FILES) {
    violations.push(violation('E_FILE_BUDGET', `too many files: ${files.length} > ${MAX_FILES}`));
  }
  if (total > MAX_TOTAL_BYTES) {
    violations.push(violation('E_FILE_BUDGET', `total size ${total} > ${MAX_TOTAL_BYTES}`));
  }

  for (const f of files) {
    const bytes = Buffer.byteLength(f.content, 'utf8');
    if (bytes > MAX_FILE_BYTES) {
      violations.push(violation('E_FILE_BUDGET', `file too large: ${bytes} > ${MAX_FILE_BYTES}`, f.path));
    }
    if (f.path === 'package.json') {
      try {
        JSON.parse(f.content);
      } catch {
        violations.push(violation('E_PKG_INVALID', 'invalid package.json', f.path));
      }
    }
    if (detectAbsoluteRoot(f.content)) {
      violations.push(
        violation('E_ABS_PATH', 'use relative asset paths, not root-relative', f.path, 'e.g. "assets/x.js" not "/assets/x.js"'),
      );
    }
    if (detectEsm(f.content)) {
      violations.push(violation('E_FORBIDDEN_MODULE', 'use CommonJS require; ESM/TS/vite forbidden', f.path));
    }
    for (const dep of detectForbiddenDeps(f.content)) {
      violations.push(violation('E_FORBIDDEN_DEP', `forbidden dependency: ${dep}`, f.path));
    }
    if (/\.html?$/i.test(f.path)) {
      for (const ref of extractLocalRefs(f.content, f.path)) {
        if (!filePaths.has(ref)) {
          violations.push(
            violation(
              'E_MISSING_ASSET',
              `referenced file not generated: ${ref}`,
              f.path,
              'generate every referenced js/css/img file with full content',
            ),
          );
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}