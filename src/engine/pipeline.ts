import type { LlmClient } from './llm';
import type { SiteSpec } from './schema';
import type { FileEntry } from '../lib/files';
import { runSpec } from './stages/spec';
import { runEngineer } from './stages/engineer';
import { runReviewRepair, nextRound } from './stages/review';
import { validateArtifacts } from './validate';
import { applyPatches } from './patches';
import { buildVersion, runVersion, stopContainer } from '../sandbox/docker';
import { checkHealth } from '../sandbox/health';
import type { HealthResult } from '../sandbox/health';

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
}

export async function runPipeline(
  job: PipelineJob,
  deps: PipelineDeps,
  emit: EmitFn = () => {},
): Promise<PipelineResult> {
  const port = deps.containerPort ?? 3001;

  const spec = job.spec ?? (await runSpec(deps.llm, { idea: job.idea ?? '', template: job.template }));
  emit('info', `spec ready: ${spec.brief.category} / ${spec.brief.name}`);

  const eng = await runEngineer(deps.llm, {
    spec,
    mode: job.mode,
    existingFiles: job.existingFiles,
    userMessage: job.userMessage,
  });

  let files: FileEntry[];
  let failure = '';

  if (job.mode === 'initial') {
    files = eng.files ?? [];
    if (files.length === 0) failure = 'engineer_returned_no_files';
  } else {
    const applied = applyPatches(job.existingFiles ?? [], eng.patches ?? []);
    if (applied.ok) {
      files = applied.files;
    } else {
      files = job.existingFiles ?? [];
      failure = `patch_error: ${JSON.stringify(applied.violations)}`;
    }
  }

  let round = 0;
  for (;;) {
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
        };
      }
      stopContainer(run.containerId);
      failure = `health: ${h.reason ?? 'unknown'}`;
    }

    emit('warn', `attempt failed (round ${round})`, failure);

    const nr = nextRound(round);
    if (!nr.retry) {
      emit('error', 'pipeline failed: max repair rounds reached', failure);
      return { status: 'failed', error: failure, files, repairRounds: round };
    }

    round = nr.round;
    emit('info', `repair round ${round}: start`);
    const rr = await runReviewRepair(deps.llm, {
      round,
      spec,
      currentFiles: files,
      failure,
    });
    if (rr.files && rr.files.length > 0) {
      files = rr.files;
    } else if (rr.patches && rr.patches.length > 0) {
      const ap = applyPatches(files, rr.patches);
      if (ap.ok) files = ap.files;
    }
    failure = '';
  }
}