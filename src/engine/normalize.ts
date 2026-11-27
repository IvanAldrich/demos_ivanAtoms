import type { FileEntry } from '../lib/files';

/**
 * Make client-side references relative so the app works under a sub-path.
 * The reverse proxy injects <base href="/p/{slug}/">, so fetch('api/x') resolves correctly.
 * Only touches fetch(...) strings, src/href attributes, and url(...) — never server route strings.
 */
export function normalizeRelativePaths(files: FileEntry[]): FileEntry[] {
  return files.map((f) => ({
    path: f.path,
    content: f.content
      .replace(/(\bfetch\(\s*)(["'])\/(?!\/)/g, '$1$2')
      .replace(/(\b(?:src|href)\s*=\s*)(["'])\/(?!\/)/g, '$1$2')
      .replace(/(url\(\s*["']?)\/(?!\/)/g, '$1'),
  }));
}