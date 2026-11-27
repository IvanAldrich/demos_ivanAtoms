import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../env';
import { openDb } from '../lib/db';
import * as projects from '../lib/repo/projects';
import * as versions from '../lib/repo/versions';
import * as jobs from '../lib/repo/jobs';
import * as messages from '../lib/repo/messages';
import * as eventsRepo from '../lib/repo/events';
import { casPublish } from '../lib/cas';
import { LlmClient } from '../engine/llm';
import { runPipeline } from '../engine/pipeline';
import { selectNextJob, requeueExpired } from './queue';
import { readDirFiles, stopContainer, versionDir } from '../sandbox/docker';
import { reviveMissing } from './revive';

const CONTAINER_PORT = 3001;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function acquireWorkerLock(dbPath: string): boolean {
  const lock = path.join(path.dirname(path.resolve(dbPath)), 'worker.lock');
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, 'utf8').trim());
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 0); // alive?
          return false;
        } catch {
          /* stale lock */
        }
      }
    }
    fs.writeFileSync(lock, String(process.pid));
    const cleanup = () => {
      try {
        if (fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock);
      } catch {
        /* ignore */
      }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    return true;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = openDb(env.DB_PATH);
  if (!acquireWorkerLock(env.DB_PATH)) {
    console.error('[worker] another worker is already running; exiting');
    process.exit(1);
  }
  const llm = new LlmClient({
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    apiKey: env.DASHSCOPE_API_KEY,
  });
  const plannerLlm = new LlmClient({
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL_PLANNER,
    apiKey: env.DASHSCOPE_API_KEY,
  });

  const rev = reviveMissing(db, { dataRoot: env.DATA_ROOT, image: env.SANDBOX_IMAGE });
  process.stdout.write(`[worker] started (revived=${rev.revived})\n`);

  let lastRevive = Date.now();
  for (;;) {
    requeueExpired(db);
    if (Date.now() - lastRevive > 30_000) {
      lastRevive = Date.now();
      try {
        reviveMissing(db, { dataRoot: env.DATA_ROOT, image: env.SANDBOX_IMAGE });
      } catch {
        /* ignore */
      }
    }
    const job = selectNextJob(db, 120_000);
    if (!job) {
      await sleep(1000);
      continue;
    }

    jobs.setStatus(db, job.id, 'running');
    const emit = (level: 'info' | 'warn' | 'error', message: string, data?: unknown) =>
      eventsRepo.append(db, job.id, level, message, data);
    const project = projects.get(db, job.projectId);
    const version = versions.get(db, job.versionId);

    if (!project || !version) {
      jobs.setStatus(db, job.id, 'failed', { error: 'project_or_version_missing' });
      continue;
    }

    emit('info', `job ${job.type} v${version.n} started`);
    projects.update(db, project.id, { status: 'building' });
    const hb = setInterval(() => jobs.heartbeat(db, job.id, 120_000), 10_000);

    try {
      let result;
      if (job.type === 'initial') {
        result = await runPipeline(
          { projectId: project.id, version: version.n, mode: 'initial', idea: project.idea, template: project.templateKey ?? undefined },
          { llm, plannerLlm, dataRoot: env.DATA_ROOT, image: env.SANDBOX_IMAGE, containerPort: CONTAINER_PORT },
          emit,
        );
      } else {
        const ready = versions
          .listByProject(db, project.id)
          .filter((v) => v.status === 'ready')
          .sort((a, b) => b.n - a.n)[0];
        const existingFiles = ready ? readDirFiles(versionDir(env.DATA_ROOT, project.id, ready.n)) : [];
        const lastUser = messages
          .list(db, project.id)
          .filter((m) => m.role === 'user')
          .pop()?.content;
        result = await runPipeline(
          {
            projectId: project.id,
            version: version.n,
            mode: 'iterate',
            idea: project.idea,
            userMessage: lastUser,
            existingFiles,
          },
          { llm, plannerLlm, dataRoot: env.DATA_ROOT, image: env.SANDBOX_IMAGE, containerPort: CONTAINER_PORT },
          emit,
        );
      }

      if (jobs.get(db, job.id)?.status !== 'running') {
        emit('warn', 'job no longer active; discard result');
        continue;
      }

      if (result.status === 'ready' && result.containerId && result.containerIp) {
        versions.setReady(db, version.id, {
          containerId: result.containerId,
          containerIp: result.containerIp,
          containerPort: CONTAINER_PORT,
        });
        projects.update(db, project.id, { status: 'ready' });

        // if the project is already published, atomically switch to the new version
        if (project.publishedVersionId) {
          const oldId = project.publishedVersionId;
          const old = versions.get(db, oldId);
          if (casPublish(db, project.id, oldId, version.id)) {
            if (old?.containerId) stopContainer(old.containerId);
          }
        }
        jobs.setStatus(db, job.id, 'done');
        emit('info', 'job done');
        const isIterate = job.type !== 'initial';
        const changeText = result.reply && result.reply.trim() ? result.reply.trim() : '';
        const content = isIterate
          ? `✅ 已按你的要求完成：${changeText || '本次修改已生效。'}`.replace(/\s+/g, ' ').trim()
          : `✅ 已完成：v${version.n}《${result.brief?.name ?? project.name}》${result.brief?.category ? `(${result.brief.category})` : ''}。${result.brief?.summary ?? ''}${result.brief?.features && result.brief.features.length ? ` 功能：${result.brief.features.slice(0, 6).join('；')}。` : ''} 共 ${result.files?.length ?? 0} 个文件。可在右侧「预览」查看，或点「发布」获取公开链接。`
              .replace(/\s+/g, ' ')
              .trim();
        const changeSummary = changeText || '本次修改已生效。';
        messages.add(db, project.id, 'assistant', content, {
          kind: 'done',
          version: version.n,
          name: result.brief?.name ?? project.name,
          category: result.brief?.category ?? null,
          summary: isIterate ? changeSummary : result.brief?.summary ?? '',
          features: isIterate ? [] : result.brief?.features ?? [],
          files: result.files?.length ?? 0,
        });
      } else {
        versions.setFailed(db, version.id, result.error ?? 'unknown');
        projects.update(db, project.id, { status: 'failed' });
        jobs.setStatus(db, job.id, 'failed', { error: result.error });
        emit('error', 'job failed', result.error);
        messages.add(
          db,
          project.id,
          'assistant',
          `⚠️ 本次未完成：${(result.error ?? '').slice(0, 200)}。可继续对话调整需求，或点击「重试」。`,
          { kind: 'error', error: result.error ?? '' },
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      versions.setFailed(db, version.id, msg);
      jobs.setStatus(db, job.id, 'failed', { error: msg });
      emit('error', 'job crashed', msg);
      projects.update(db, project.id, { status: 'failed' });
      messages.add(db, project.id, 'assistant', `⚠️ 生成过程出错：${msg.slice(0, 200)}`, { kind: 'error', error: msg });
    } finally {
      clearInterval(hb);
    }
  }
}

main().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});