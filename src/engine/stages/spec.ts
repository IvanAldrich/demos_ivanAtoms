import { LlmClient } from '../llm';
import { SiteSpecSchema, type SiteSpec } from '../schema';
import { PROMPTS } from '../prompts';

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

const MAX_MANIFEST_FILES = 12;

export async function runSpec(
  llm: LlmClient,
  input: { idea: string; template?: string; existingManifest?: string[] },
): Promise<SiteSpec> {
  const parts = [`想法：${input.idea}`];
  if (input.template) parts.push(`优先模板方向：${input.template}`);
  if (input.existingManifest?.length) {
    parts.push(`已有文件：${input.existingManifest.join(', ')}`);
  }

  const spec = await llm.completeJSON<SiteSpec>(
    [
      { role: 'system', content: PROMPTS.specSystem },
      { role: 'user', content: parts.join('\n') },
    ],
    SiteSpecSchema,
  );

  if (spec.fileManifest.length > MAX_MANIFEST_FILES) {
    throw new BudgetError(`fileManifest too large: ${spec.fileManifest.length} > ${MAX_MANIFEST_FILES}`);
  }
  return spec;
}