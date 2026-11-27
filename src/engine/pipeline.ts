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

  const spec = job.spec ?? (await runSpec(deps.llm, { idea: job.idea ?? '', template: job.template }));
  emit('info', `spec ready: ${spec.brief.category} / ${spec.brief.name}`);

  let files: FileEntry[] = job.existingFiles ?? [];
  let failure = '';

  try {
    const eng = await runEngineer(deps.llm, {
      spec,
      mode: job.mode,
      existingFiles: job.existingFiles,
      userMessage: job.userMessage,
    });
    if (job.mode === 'initial') {
      files = eng.files ?? [];
      if (files.length === 0) failure = 'engineer_returned_no_files';
    } else {
      const applied = applyPatches(job.existingFiles ?? [], eng.patches ?? []);
      if (applied.ok) files = applied.files;
      else failure = `patch_error: ${JSON.stringify(applied.violations)}`;
    }
  } catch (e: unknown) {
    failure = `engineer: ${errMsg(e)}`;
  }

  let round = 0;
  for (;;) {
    files = normalizeRelativePaths(files);
    if (!failure) files = await fillMissingAssets(deps.llm, files, spec, emit);

    if (!failure) {
      const v = validateArtifacts({ files, spec, mode: job.mode });
      if (!v.ok) failure = `validation: ${JSON.stringify(v.violations)}`;
    }

    if (!failure) {
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
        emit('info', 'ready');
        return {
          status: 'ready',
          containerId: run.containerId,
          containerIp: run.containerIp,
          files,
          repairRounds: round,
          brief: { name: spec.brief.name, category: spec.brief.category, summary: spec.brief.summary, features: spec.brief.userStories },
        };
      }
      stopContainer(run.containerId);
      failure = `health: ${h.reason ?? 'unknown'}`;
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