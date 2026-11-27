import { z } from 'zod';
import type { LlmClient } from './llm';
import type { SiteSpec } from './schema';
import type { FileEntry } from '../lib/files';
import { PROMPTS } from './prompts';
import { runSpec } from './stages/spec';
import { runEngineer } from './stages/engineer';
import { runReviewRepair, nextRound } from './stages/review';
import { validateArtifacts, findMissingAssets } from './validate';
import { applyPatches } from './patches';
import { normalizeRelativePaths } from './normalize';
import { buildVersion, runVersion, stopContainer } from '../sandbox/docker';
import { checkHealth } from '../sandbox/health';
import type { HealthResult } from '../sandbox/health';

const FilesRespSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});

const VerifyRespSchema = z.object({
  satisfied: z.boolean(),
  reason: z.string().optional(),
  summary: z.string().optional(),
  files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
});

/** Verify the user's latest request is actually implemented; return fixed files + a user-facing change summary. */
async function verifyAgainstRequest(
  llm: LlmClient,
  spec: SiteSpec,
  files: FileEntry[],
  userMessage: string,
): Promise<{ files: FileEntry[] | null; summary?: string }> {
  const user = [
    `用户最新要求：${userMessage}`,
    `SiteSpec:\n${JSON.stringify(spec)}`,
    `当前文件:\n${JSON.stringify(files)}`,
    '请严格判断当前代码是否真正实现了上述要求；未满足则给出修正后的全部文件。并且无论如何都给出 summary（1-2 句、面向用户、直接说明为满足该请求做了什么变更，不要复述整个应用介绍）。只输出 JSON。',
  ].join('\n\n');
  const r = await llm.completeJSON(
    [
      { role: 'system', content: PROMPTS.verifySystem },
      { role: 'user', content: user },
    ],
    VerifyRespSchema,
  );
  const fixed = !r.satisfied && r.files && r.files.length ? r.files : null;
  return { files: fixed, summary: r.summary };
}

async function smokeServer(
  files: FileEntry[],
  ip: string,
  port: number,
): Promise<{ ok: boolean; detail?: string }> {
  const server = files.find((f) => /(^|\/)server\.js$/.test(f.path));
  if (!server) return { ok: true };
  const routes: string[] = [];
  const re = /app\.get\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(server.content))) {
    const r = m[1];
    if (r.includes('*') || r.includes(':') || r === '/') continue;
    routes.push(r);
  }
  for (const r of routes.slice(0, 8)) {
    try {
      const res = await fetch(`http://${ip}:${port}${r.startsWith('/') ? r : '/' + r}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.status >= 500) return { ok: false, detail: `${r} -> ${res.status}` };
    } catch {
      return { ok: false, detail: `${r} unreachable` };
    }
  }
  return { ok: true };
}

const STAGES = ['需求分析与架构', '生成代码', '代码自检', '构建容器', '启动与健康检查', '发布就绪'];

export interface PipelineJob {
  projectId: string;
  version: number;
  mode: 'initial' | 'iterate';
  idea?: string;
  userMessage?: string;
  template?: string;
  spec?: SiteSpec;
  existingFiles?: FileEntry[];
}

export interface PipelineDeps {
  llm: LlmClient;
  plannerLlm?: LlmClient;
  dataRoot: string;
  image: string;
  containerPort?: number;
}

export type EmitFn = (
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: unknown,
) => void;

export interface PipelineResult {
  status: 'ready' | 'failed';
  containerId?: string;
  containerIp?: string;
  files?: FileEntry[];
  error?: string;
  repairRounds: number;
  brief?: { name: string; category: string; summary: string; features?: string[] };
  reply?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(baseUrl: string, timeoutMs = 15_000): Promise<HealthResult> {
  const start = Date.now();
  let last: HealthResult = { ok: false, reason: 'timeout' };
  while (Date.now() - start < timeoutMs) {
    last = await checkHealth(baseUrl);
    if (last.ok) return last;
    await sleep(500);
  }
  return last;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Deterministically close the loop on HTML references to missing local files. */
async function fillMissingAssets(
  llm: LlmClient,
  files: FileEntry[],
  spec: SiteSpec,
  emit: EmitFn,
): Promise<FileEntry[]> {
  const missing = findMissingAssets(files);
  if (missing.length === 0) return files;
  emit('info', `completeness: generating ${missing.length} missing file(s)`, missing);
  try {
    const resp = await llm.completeJSON(
      [
        { role: 'system', content: PROMPTS.engineerSystem },
        {
          role: 'user',
          content: `以下文件被 HTML 引用但尚未生成，请只生成这些文件的完整内容（不要输出其它文件）：\n${missing
            .map((m) => `- ${m}`)
            .join('\n')}\n类别：${spec.brief.category}；uiStyle：${spec.brief.uiStyle ?? ''}。只输出 {"files":[{"path","content"}]}。`,
        },
      ],
      FilesRespSchema,
    );
    const existing = new Set(files.map((f) => f.path));
    const add = resp.files.filter((f) => !existing.has(f.path));
    return [...files, ...add];
  } catch (e: unknown) {
    emit('warn', 'completeness error', errMsg(e));
    return files;
  }
}

export async function runPipeline(
  job: PipelineJob,
  deps: PipelineDeps,
  emit: EmitFn = () => {},
): Promise<PipelineResult> {
  const port = deps.containerPort ?? 3001;
  const planner = deps.plannerLlm ?? deps.llm;
  const emitStage = (k: number) =>
    emit('info', `第 ${k}/${STAGES.length} 步：${STAGES[k - 1]}`, {
      kind: 'stage',
      k,
      n: STAGES.length,
      label: STAGES[k - 1],
    });
  emitStage(1);

  let spec: SiteSpec;
  if (job.spec) {
    spec = job.spec;
  } else {
    const specLlm = job.mode === 'initial' ? planner : deps.llm;
    try {
      spec = await runSpec(specLlm, { idea: job.idea ?? '', template: job.template });
    } catch (e: unknown) {
      emit('warn', 'spec retry with planner', errMsg(e));
      spec = await runSpec(planner, { idea: job.idea ?? '', template: job.template });
    }
  }
  emit('info', `spec ready: ${spec.brief.category} / ${spec.brief.name}`);

  let files: FileEntry[] = job.existingFiles ?? [];
  let failure = '';
  let reply: string | undefined;

  emitStage(2);
  const engMode: 'initial' | 'rewrite' = job.mode === 'initial' ? 'initial' : 'rewrite';
  try {
    const eng = await runEngineer(deps.llm, {
      spec,
      mode: engMode,
      existingFiles: job.existingFiles,
      userMessage: job.userMessage,
    });
    files = eng.files ?? (job.mode === 'initial' ? [] : job.existingFiles ?? []);
    if (files.length === 0) failure = 'engineer_returned_no_files';
  } catch (e: unknown) {
    emit('warn', 'engineer retry with planner', errMsg(e));
    try {
      const eng2 = await runEngineer(planner, {
        spec,
        mode: engMode,
        existingFiles: job.existingFiles,
        userMessage: job.userMessage,
      });
      files = eng2.files ?? [];
      if (files.length === 0) failure = 'engineer_returned_no_files';
    } catch (e2: unknown) {
      failure = `engineer: ${errMsg(e2)}`;
    }
  }

  if (!failure && job.mode === 'iterate' && job.userMessage) {
    emit('info', '验收：核对是否满足你的最新要求');
    try {
      const vres = await verifyAgainstRequest(planner, spec, files, job.userMessage);
      if (vres.files) {
        files = vres.files;
        emit('info', '已按你的要求校正实现');
      }
      if (vres.summary && vres.summary.trim()) reply = vres.summary.trim();
    } catch (e: unknown) {
      emit('warn', 'verify error', errMsg(e));
    }
    if (!reply) {
      const prev = new Map((job.existingFiles ?? []).map((f) => [f.path, f.content]));
      const changed = files.filter((f) => prev.get(f.path) !== f.content).map((f) => f.path);
      reply = changed.length ? `本次修改了 ${changed.join('、')}。` : '本次已按你的要求更新。';
    }
  }

  let round = 0;
  for (;;) {
    files = normalizeRelativePaths(files);
    if (!failure) files = await fillMissingAssets(deps.llm, files, spec, emit);

    if (!failure) {
      emitStage(3);
      const v = validateArtifacts({ files, spec, mode: job.mode });
      if (!v.ok) failure = `validation: ${JSON.stringify(v.violations)}`;
    }

    if (!failure) {
      emitStage(4);
      emit('info', 'build: start');
      const built = buildVersion({
        dataRoot: deps.dataRoot,
        projectId: job.projectId,
        version: job.version,
        files,
        image: deps.image,
      });
      if (!built.ok) failure = `build: ${built.logTail ?? 'failed'}`;
      else emit('info', 'build: done');
    }

    if (!failure) {
      emitStage(5);
      emit('info', 'run: start');
      const run = runVersion({
        dataRoot: deps.dataRoot,
        projectId: job.projectId,
        version: job.version,
        image: deps.image,
        containerPort: port,
      });
      const h = await waitHealth(`http://${run.containerIp}:${port}`);
      if (h.ok) {
        const smoke = await smokeServer(files, run.containerIp, port);
        if (!smoke.ok) {
          stopContainer(run.containerId);
          failure = `smoke: ${smoke.detail ?? 'api check failed'}`;
        } else {
          emitStage(6);
          emit('info', 'ready');
          return {
            status: 'ready',
            containerId: run.containerId,
            containerIp: run.containerIp,
            files,
            repairRounds: round,
            brief: { name: spec.brief.name, category: spec.brief.category, summary: spec.brief.summary, features: spec.brief.userStories },
            reply,
          };
        }
      } else {
        stopContainer(run.containerId);
        failure = `health: ${h.reason ?? 'unknown'}`;
      }
    }

    emit('warn', `attempt failed (round ${round})`, failure);

    const nr = nextRound(round);
    if (!nr.retry) {
      emit('error', 'pipeline failed: max repair rounds reached', failure);
      return {
        status: 'failed',
        error: failure,
        files,
        repairRounds: round,
        brief: { name: spec.brief.name, category: spec.brief.category, summary: spec.brief.summary, features: spec.brief.userStories },
      };
    }

    round = nr.round;
    emit('info', `repair round ${round}: start`);
    let repaired = false;
    try {
      const rr = await runReviewRepair(deps.llm, { round, spec, currentFiles: files, failure });
      if (rr.files && rr.files.length > 0) {
        files = rr.files;
        repaired = true;
      } else if (rr.patches && rr.patches.length > 0) {
        const ap = applyPatches(files, rr.patches);
        if (ap.ok) {
          files = ap.files;
          repaired = true;
        }
      }
    } catch (e: unknown) {
      emit('warn', 'repair error', errMsg(e));
    }
    if (repaired) failure = '';
  }
}