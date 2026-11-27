import { z } from 'zod';

export const PageSchema = z.object({
  path: z.string(),
  purpose: z.string(),
});

export const DataFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
});

export const DataModelSchema = z.object({
  table: z.string(),
  fields: z.array(DataFieldSchema),
});

export const BriefSchema = z.object({
  name: z.string(),
  category: z.enum(['website', 'app', 'game']),
  summary: z.string(),
  // Models sometimes return an object here; coerce to a readable string.
  uiStyle: z.preprocess(
    (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v),
    z.string().optional(),
  ),
  pages: z.array(PageSchema),
  userStories: z.array(z.string()),
  dataModel: z.array(DataModelSchema),
});

export const FileManifestEntrySchema = z.object({
  path: z.string(),
  purpose: z.string(),
  estBytes: z.number().int().nonnegative(),
  source: z.enum(['seed', 'gen']),
});

export const TechConstraintsSchema = z.object({
  runtime: z.literal('node22-cjs'),
  entry: z.string(),
  startCmd: z.string(),
  port: z.number().int(),
  dataDirEnv: z.literal('DATA_DIR'),
  persistence: z.enum(['sqlite', 'json', 'none']),
  deps: z.array(z.string()),
  assetPaths: z.literal('relative'),
  noAbsoluteRoot: z.boolean(),
  noWebSocket: z.boolean(),
});

export const SiteSpecSchema = z.object({
  specVersion: z.literal(1),
  brief: BriefSchema,
  fileManifest: z.array(FileManifestEntrySchema),
  techConstraints: TechConstraintsSchema,
});

export type SiteSpec = z.infer<typeof SiteSpecSchema>;
export type FileManifestEntry = z.infer<typeof FileManifestEntrySchema>;

export const VIOLATION_CODES = [
  'E_ENTRY_MISSING',
  'E_PKG_INVALID',
  'E_FILE_BUDGET',
  'E_PATCH_AMBIGUOUS',
  'E_ABS_PATH',
  'E_FORBIDDEN_DEP',
  'E_FORBIDDEN_MODULE',
  'E_MISSING_ASSET',
  'E_ROOT_ROUTE',
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export const ViolationSchema = z.object({
  code: z.union([z.enum(VIOLATION_CODES), z.string()]),
  path: z.string().optional(),
  message: z.string(),
  fixHint: z.string().optional(),
});

export const ViolationsSchema = z.object({
  ok: z.boolean(),
  violations: z.array(ViolationSchema),
});

export type Violation = z.infer<typeof ViolationSchema>;
export type Violations = z.infer<typeof ViolationsSchema>;