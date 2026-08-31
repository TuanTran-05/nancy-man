import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const schemaVersionPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[A-Za-z0-9._-]+)?$/u;
const stableIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const accountNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*[$]?$/u;
const modePattern = /^[0-7]{4}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

const stableIdSchema = z.string().regex(stableIdPattern, 'Stable IDs must be lowercase dotted identifiers');
const nonEmptyTextSchema = z.string().min(1).max(512);
const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('/') && !value.includes('\u0000'), 'Absolute path is invalid');
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.startsWith('/') && !value.includes('..') && !value.includes('\u0000'),
    'Relative path is invalid'
  );

function addUniqueIdIssue(
  context: z.RefinementCtx,
  values: readonly { id: string }[],
  path: (string | number)[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate id "${value.id}"`,
        path
      });
      return;
    }
    seen.add(value.id);
  }
}

export const SourceAdapterSchema = z.enum([
  'node_env_file',
  'systemd_environment_file',
  'systemd_credential_file',
  'dotenv',
  'pm2_ecosystem_static',
  'none'
]);
export type SourceAdapter = z.infer<typeof SourceAdapterSchema>;

export const ManifestActionIdSchema = z.enum([
  'application.clear_apply_block',
  'job.next_run',
  'pm2.reload_app',
  'release.build_redeploy',
  'systemd.reload_unit',
  'systemd.restart_unit'
]);
export type ManifestActionId = z.infer<typeof ManifestActionIdSchema>;

export const ManifestCheckIdSchema = z.enum([
  'agent.healthy',
  'dependency.probe',
  'http.readiness_local',
  'http.smoke_public',
  'process.active',
  'release.identity'
]);
export type ManifestCheckId = z.infer<typeof ManifestCheckIdSchema>;

const fileLocatorSchema = z
  .object({
    kind: z.literal('file'),
    path: absolutePathSchema
  })
  .strict();
const activeReleaseLinkLocatorSchema = z
  .object({
    kind: z.literal('active_release_link'),
    currentPath: absolutePathSchema,
    approvedTargetRoot: absolutePathSchema,
    fixedDescendant: relativePathSchema
  })
  .strict();

export const SourceLocatorSchema = z.discriminatedUnion('kind', [
  fileLocatorSchema,
  activeReleaseLinkLocatorSchema
]);
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;

export const ManifestSourceSchema = z
  .object({
    id: stableIdSchema,
    appId: stableIdSchema,
    pathLabel: nonEmptyTextSchema,
    adapterId: SourceAdapterSchema,
    locator: SourceLocatorSchema,
    owner: z.string().regex(accountNamePattern, 'Owner is invalid'),
    group: z.string().regex(accountNamePattern, 'Group is invalid'),
    mode: z.string().regex(modePattern, 'Mode must be an exact four-digit octal string'),
    maximumBytes: z.number().int().positive(),
    precedenceRank: z.number().int().nonnegative(),
    consumerIds: z.array(stableIdSchema).optional(),
    actionIds: z.array(ManifestActionIdSchema).optional(),
    checkIds: z.array(ManifestCheckIdSchema).optional()
  })
  .strict();
export type ManifestSource = z.infer<typeof ManifestSourceSchema>;

export const ManifestActionSchema = z
  .object({
    id: ManifestActionIdSchema,
    description: nonEmptyTextSchema
  })
  .strict();
export type ManifestAction = z.infer<typeof ManifestActionSchema>;

export const ManifestCheckSchema = z
  .object({
    id: ManifestCheckIdSchema,
    description: nonEmptyTextSchema
  })
  .strict();
export type ManifestCheck = z.infer<typeof ManifestCheckSchema>;

export const AgentManifestSchema = z
  .object({
    manifestVersion: z.string().regex(schemaVersionPattern, 'Manifest version is invalid'),
    catalogVersion: z.string().regex(schemaVersionPattern, 'Catalog version is invalid'),
    catalogDigest: z.string().regex(digestPattern, 'Catalog digest is invalid'),
    readOnly: z.literal(true),
    sources: z.array(ManifestSourceSchema),
    actions: z.array(ManifestActionSchema),
    checks: z.array(ManifestCheckSchema)
  })
  .strict()
  .superRefine((manifest, context) => {
    addUniqueIdIssue(context, manifest.sources, ['sources']);
    addUniqueIdIssue(context, manifest.actions, ['actions']);
    addUniqueIdIssue(context, manifest.checks, ['checks']);
  });
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export function parseAgentManifest(text: string): AgentManifest {
  return AgentManifestSchema.parse(parseYaml(text));
}
