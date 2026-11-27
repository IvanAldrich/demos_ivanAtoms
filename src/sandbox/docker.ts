import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { FileEntry } from '../lib/files';
export type { FileEntry } from '../lib/files';

function safeJoin(base: string, rel: string): string {
  const resolvedBase = path.resolve(base);
  const target = path.resolve(base, rel);
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw new Error(`unsafe path: ${rel}`);
  }
  return target;
}

function docker(args: string[], timeoutMs = 120_000): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function projectRoot(dataRoot: string, projectId: string): string {
  return path.join(dataRoot, projectId);
}

export function versionDir(dataRoot: string, projectId: string, n: number): string {
  return path.join(projectRoot(dataRoot, projectId), 'versions', `v${n}`);
}

export function projectDataDir(dataRoot: string, projectId: string): string {
  return path.join(projectRoot(dataRoot, projectId), 'data');
}

function ensureNetwork(name: string): void {
  try {
    docker(['network', 'inspect', name]);
  } catch {
    docker(['network', 'create', name]);
  }
}

export interface BuildResult {
  ok: boolean;
  dir: string;
  logTail?: string;
}

/**
 * Write files into a fresh version dir (v{n}.tmp → rename). Optionally run npm install
 * inside a throwaway build container (bridge network) when extra deps are needed.
 */
export function buildVersion(params: {
  dataRoot: string;
  projectId: string;
  version: number;
  files: FileEntry[];
  image: string;
  needsInstall?: boolean;
}): BuildResult {
  const finalDir = versionDir(params.dataRoot, params.projectId, params.version);
  const tmpDir = `${finalDir}.tmp`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const f of params.files) {
    const target = safeJoin(tmpDir, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }
  fs.mkdirSync(projectDataDir(params.dataRoot, params.projectId), { recursive: true });

  if (params.needsInstall) {
    try {
      docker(
        [
          'run', '--rm', '--network', 'bridge',
          '-v', `${tmpDir}:/app/code`, '-w', '/app/code',
          params.image,
          'npm', 'install', '--omit=dev', '--no-audit', '--no-fund',
        ],
        90_000,
      );
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      const logTail = String(err.stderr || err.stdout || err.message || '').slice(-4000);
      return { ok: false, dir: tmpDir, logTail };
    }
  }

  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(tmpDir, finalDir);
  return { ok: true, dir: finalDir };
}

export interface RunResult {
  containerId: string;
  containerIp: string;
}

/**
 * Start a run container: internal-ish bridge network, read-only rootfs, code (ro) + data (rw).
 * Entrypoint runs `node server.js` with cwd /app/code and DATA_DIR=/app/data.
 */
export function runVersion(params: {
  dataRoot: string;
  projectId: string;
  version: number;
  image: string;
  network?: string;
  containerPort?: number;
}): RunResult {
  const network = params.network ?? 'ivanatoms-net';
  ensureNetwork(network);

  const cname = `ia-${params.projectId.slice(0, 8)}-v${params.version}`;
  try {
    docker(['rm', '-f', cname]);
  } catch {
    /* not found */
  }

  const codeDir = versionDir(params.dataRoot, params.projectId, params.version);
  const dataDir = projectDataDir(params.dataRoot, params.projectId);
  fs.mkdirSync(dataDir, { recursive: true });
  const port = String(params.containerPort ?? 3001);

  const containerId = docker([
    'run', '-d', '--name', cname,
    '--network', network,
    '--label', 'ivanatoms=1',
    '--label', `project=${params.projectId}`,
    '--read-only', '--tmpfs', '/tmp',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '256',
    '-m', '512m', '--cpus', '2',
    '-v', `${codeDir}:/app/code:ro`,
    '-v', `${dataDir}:/app/data:rw`,
    '-e', 'DATA_DIR=/app/data',
    '-e', `PORT=${port}`,
    '-w', '/app/code',
    params.image,
    'node', 'server.js',
  ]).trim();

  const containerIp = docker([
    'inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', containerId,
  ]).trim();

  return { containerId, containerIp };
}

export function stopContainer(id: string): void {
  try {
    docker(['rm', '-f', id]);
  } catch {
    /* ignore */
  }
}

export function reapOrphans(projectId?: string): void {
  const filters = ['--filter', 'label=ivanatoms=1'];
  if (projectId) filters.push('--filter', `label=project=${projectId}`);
  try {
    const ids = docker(['ps', '-aq', ...filters]).trim();
    if (ids) docker(['rm', '-f', ...ids.split(/\s+/)]);
  } catch {
    /* ignore */
  }
}