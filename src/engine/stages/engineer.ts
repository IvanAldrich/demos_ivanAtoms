import { z } from 'zod';
import { LlmClient } from '../llm';
import type { SiteSpec } from '../schema';
import { PROMPTS } from '../prompts';
import type { FileEntry, Patch } from '../../lib/files';

const FilesResp = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});
const PatchesResp = z.object({
  patches: z.array(z.object({ path: z.string(), search: z.string(), replace: z.string() })),
});

const MAX_CTX_FILES = 8;
const MAX_CTX_BYTES = 32 * 1024;

function contextFiles(files?: FileEntry[]): FileEntry[] {
  if (!files) return [];
  const out: FileEntry[] = [];
  let total = 0;
  for (const f of files) {
    const b = Buffer.byteLength(f.content, 'utf8');
    if (out.length >= MAX_CTX_FILES || total + b > MAX_CTX_BYTES) break;
    out.push(f);
    total += b;
  }
  return out;
}

export async function runEngineer(
  llm: LlmClient,
  input: {
    spec: SiteSpec;
    mode: 'initial' | 'iterate' | 'rewrite';
    existingFiles?: FileEntry[];
    userMessage?: string;
  },
): Promise<{ files?: FileEntry[]; patches?: Patch[] }> {
  const userParts = [`SiteSpec:\n${JSON.stringify(input.spec)}`];
  if (input.mode !== 'initial') {
    userParts.push(`现有文件:\n${JSON.stringify(contextFiles(input.existingFiles))}`);
    if (input.userMessage) userParts.push(`修改要求：${input.userMessage}`);
  }

  const msgs = [
    { role: 'system' as const, content: PROMPTS.engineerSystem },
    { role: 'user' as const, content: userParts.join('\n\n') },
  ];

  if (input.mode === 'iterate') {
    const r = await llm.completeJSON(msgs, PatchesResp);
    return { patches: r.patches };
  }
  const r = await llm.completeJSON(msgs, FilesResp);
  return { files: r.files };
}