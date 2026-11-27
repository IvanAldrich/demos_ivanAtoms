import type { FileEntry, Patch } from '../lib/files';
import type { Violation } from './schema';

export function applyPatches(
  files: FileEntry[],
  patches: Patch[],
): { ok: boolean; files: FileEntry[]; violations: Violation[] } {
  const map = new Map(files.map((f) => [f.path, f.content]));
  const violations: Violation[] = [];

  for (const p of patches) {
    if (!map.has(p.path)) {
      violations.push({
        code: 'E_PATCH_AMBIGUOUS',
        path: p.path,
        message: 'patch target file not found',
      });
      continue;
    }
    const content = map.get(p.path)!;
    const count = p.search === '' ? 0 : content.split(p.search).length - 1;
    if (count !== 1) {
      violations.push({
        code: 'E_PATCH_AMBIGUOUS',
        path: p.path,
        message: `search matched ${count} times (must be exactly 1)`,
      });
      continue;
    }
    map.set(p.path, content.replace(p.search, p.replace));
  }

  const out: FileEntry[] = files.map((f) => ({ path: f.path, content: map.get(f.path)! }));
  return { ok: violations.length === 0, files: out, violations };
}