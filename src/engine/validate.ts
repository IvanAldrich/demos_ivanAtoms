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
  return (
    /(?:src|href)\s*=\s*["']\/[^/]/.test(content) ||
    /fetch\(\s*["']\/[^/]/.test(content) ||
    /url\(\s*["']?\/[^/]/.test(content) ||
    /["']\/(api|assets|static)\//.test(content)
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

export function validateArtifacts(input: {
  files: FileEntry[];
  spec: SiteSpec;
  mode: 'initial' | 'iterate';
}): { ok: boolean; violations: Violation[] } {
  const { files, spec } = input;
  const violations: Violation[] = [];

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
  }

  return { ok: violations.length === 0, violations };
}