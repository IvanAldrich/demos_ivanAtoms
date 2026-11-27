import { z } from 'zod';
import { LlmClient } from '../llm';
import type { SiteSpec } from '../schema';
import { PROMPTS } from '../prompts';
import type { FileEntry, Patch } from '../../lib/files';

const ReviewResp = z.object({
  diagnosis: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
  patches: z
    .array(z.object({ path: z.string(), search: z.string(), replace: z.string() }))
    .optional(),
});

const MAX_REPAIR_ROUNDS = 3;

/** round is the number of repair attempts already made. */
export function nextRound(round: number): { retry: boolean; round: number } {
  if (round >= MAX_REPAIR_ROUNDS) return { retry: false, round };
  return { retry: true, round: round + 1 };
}

export async function runReviewRepair(
  llm: LlmClient,
  input: {
    round: number;
    spec: SiteSpec;
    currentFiles: FileEntry[];
    failure: string;
  },
): Promise<{ files?: FileEntry[]; patches?: Patch[]; diagnosis: string }> {
  const user = [
    `失败信息：\n${input.failure}`,
    `SiteSpec:\n${JSON.stringify(input.spec)}`,
    `当前文件:\n${JSON.stringify(input.currentFiles)}`,
  ].join('\n\n');

  const r = await llm.completeJSON(
    [
      { role: 'system', content: PROMPTS.reviewSystem },
      { role: 'user', content: user },
    ],
    ReviewResp,
  );

  return { files: r.files, patches: r.patches, diagnosis: r.diagnosis };
}