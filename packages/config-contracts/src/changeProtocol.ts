import { z } from 'zod';

const stableIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const opaqueUuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const changeIdPattern = new RegExp(`^(?:CHG_[A-Za-z0-9_]+|${opaqueUuid})$`, 'u');
const runIdPattern = new RegExp(`^(?:RUN_[A-Za-z0-9_]+|${opaqueUuid})$`, 'u');
const eventIdPattern = new RegExp(`^(?:EVT_[A-Za-z0-9_]+|${opaqueUuid})$`, 'u');
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const hmacDigestPattern = /^hmac-sha256:v[0-9]+:[a-f0-9]{64}$/u;
const variableNamePattern = /^[A-Z][A-Z0-9_]*$/u;
const schemaVersionPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[A-Za-z0-9._-]+)?$/u;

const stableId = z.string().regex(stableIdPattern);
const changeId = z.string().regex(changeIdPattern);
const runId = z.string().regex(runIdPattern);
const eventId = z.string().regex(eventIdPattern);
const sourceFingerprint = z.string().regex(hmacDigestPattern);
const digest = z.string().regex(digestPattern);
const changeDigest = z.string().regex(hmacDigestPattern);
const version = z.string().regex(schemaVersionPattern);
const value = z.string().max(65_536).refine((item) => !item.includes('\u0000'), 'Value contains NUL');

export const ConfigChangeStateSchema = z.enum([
  'DRAFT',
  'VALIDATING',
  'INVALID',
  'READY',
  'SAVED',
  'APPLYING',
  'SNAPSHOTTED',
  'WRITTEN',
  'ACTION_RUNNING',
  'HEALTH_CHECKING',
  'COMPLETED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'CANCELLED',
  'EXPIRED'
]);
export type ConfigChangeState = z.infer<typeof ConfigChangeStateSchema>;

export const ChangeOperationSchema = z.enum(['set', 'delete']);
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;
export const ChangeApplyStrategySchema = z.enum([
  'no_runtime_action',
  'next_job',
  'runtime_restart',
  'credential_restart',
  'build_redeploy'
]);
export type ChangeApplyStrategy = z.infer<typeof ChangeApplyStrategySchema>;

const itemMetadata = z
  .object({
    appId: stableId,
    sourceId: stableId,
    catalogId: stableId,
    name: z.string().regex(variableNamePattern),
    operation: ChangeOperationSchema,
    requirement: z.enum(['required', 'optional', 'unknown']),
    mutability: z.enum(['managed', 'observed']),
    strategy: ChangeApplyStrategySchema,
    sourceFingerprint
  })
  .strict();

export const ChangeItemSchema = itemMetadata.extend({
  value: value.optional()
}).superRefine((item, context) => {
  if (item.operation === 'set' && item.value === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Set requires a value' });
  }
  if (item.operation === 'delete' && item.value !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Delete cannot contain a value' });
  }
  if (item.mutability === 'observed' || item.requirement === 'unknown') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mutability'], message: 'Definition is not editable' });
  }
  if (item.operation === 'delete' && item.requirement !== 'optional') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['operation'], message: 'Only optional definitions may be deleted' });
  }
});
export type ChangeItem = z.infer<typeof ChangeItemSchema>;

const uniqueItemIds = (items: readonly ChangeItem[], context: z.RefinementCtx): void => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.sourceId}\u0000${item.catalogId}`;
    if (seen.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index], message: 'Duplicate source/catalog item' });
    }
    seen.add(key);
  });
};

const oneApplication = <T extends { appId: string }>(schema: z.ZodType<T>) =>
  schema.superRefine((body, context) => {
    const items = (body as T & { items?: readonly { appId: string }[] }).items;
    if (items && items.some((item) => item.appId !== body.appId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'A change may target one application only' });
    }
  });

export const ChangeValidateRequestSchema = oneApplication(
  z.object({
    changeId,
    appId: stableId,
    reason: z.string().min(1).max(512),
    items: z.array(ChangeItemSchema).min(1).max(256),
    replaceDraft: z.boolean().default(false),
    catalogVersion: version,
    manifestVersion: version
  }).strict().superRefine((body, context) => uniqueItemIds(body.items, context))
);
export type ChangeValidateRequest = z.infer<typeof ChangeValidateRequestSchema>;

export const ChangeImpactPlanSchema = z.object({
  applicationId: stableId,
  strategies: z.array(ChangeApplyStrategySchema),
  sourceIds: z.array(stableId),
  actionIds: z.array(stableId),
  checkIds: z.array(stableId),
  counts: z.object({
    items: z.number().int().nonnegative(),
    sets: z.number().int().nonnegative(),
    deletes: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative()
  }).strict(),
  warnings: z.array(z.string().min(1).max(512)),
  expectedEffect: ChangeApplyStrategySchema
}).strict();
export type ChangeImpactPlan = z.infer<typeof ChangeImpactPlanSchema>;

export const ChangeSaveRequestSchema = z.object({
  changeId,
  changeDigest,
  catalogVersion: version,
  manifestVersion: version,
  impactPlan: ChangeImpactPlanSchema.optional()
}).strict();
export type ChangeSaveRequest = z.infer<typeof ChangeSaveRequestSchema>;

export const ChangeApplyRequestSchema = z.object({
  changeId,
  runId,
  changeDigest,
  idempotencyKey: eventId
}).strict();
export type ChangeApplyRequest = z.infer<typeof ChangeApplyRequestSchema>;

export const ChangeCancelRequestSchema = z.object({ changeId, eventId }).strict();
export type ChangeCancelRequest = z.infer<typeof ChangeCancelRequestSchema>;
export const ChangeStatusRequestSchema = z.object({ changeId, afterEventId: eventId.optional() }).strict();
export type ChangeStatusRequest = z.infer<typeof ChangeStatusRequestSchema>;
export const ClearApplyBlockRequestSchema = z.object({
  appId: stableId,
  confirmationAppId: stableId,
  remediationSummary: z.string().trim().min(1).max(1_024),
  incidentId: stableId,
  eventId
}).strict().refine((body) => body.appId === body.confirmationAppId, {
  path: ['confirmationAppId'], message: 'Application confirmation does not match'
});
export type ClearApplyBlockRequest = z.infer<typeof ClearApplyBlockRequestSchema>;

export const ChangeValidationResponseSchema = z.object({
  changeId,
  state: ConfigChangeStateSchema,
  changeDigest,
  itemFingerprints: z.array(z.object({ catalogId: stableId, sourceId: stableId, oldValueFingerprint: sourceFingerprint, newValueFingerprint: sourceFingerprint }).strict()),
  impactPlan: ChangeImpactPlanSchema,
  ruleIds: z.array(stableId),
  warnings: z.array(z.string().min(1).max(512))
}).strict();
export type ChangeValidationResponse = z.infer<typeof ChangeValidationResponseSchema>;

export const ChangeSavedResponseSchema = z.object({
  changeId,
  state: z.literal('SAVED'),
  changeDigest,
  expiresAt: z.string().datetime({ offset: true })
}).strict();
export const ChangeApplyStartedResponseSchema = z.object({
  changeId,
  runId,
  state: z.literal('APPLYING')
}).strict();
export const ChangeCancelledResponseSchema = z.object({
  changeId,
  state: z.literal('CANCELLED')
}).strict();
export const ApplyBlockClearedResponseSchema = z.object({
  appId: stableId,
  state: z.literal('CLEARED')
}).strict();

export const ChangeStatusEventSchema = z.object({
  eventId,
  changeId,
  sequence: z.number().int().positive(),
  state: ConfigChangeStateSchema,
  reasonCode: stableId,
  actionId: stableId.optional(),
  checkId: stableId.optional(),
  occurredAt: z.string().datetime({ offset: true })
}).strict();
export type ChangeStatusEvent = z.infer<typeof ChangeStatusEventSchema>;

export const ChangeStatusResponseSchema = z.object({
  changeId,
  state: ConfigChangeStateSchema,
  sequence: z.number().int().nonnegative(),
  events: z.array(ChangeStatusEventSchema),
  impactPlan: ChangeImpactPlanSchema.optional(),
  changeDigest: changeDigest.optional()
}).strict();
export type ChangeStatusResponse = z.infer<typeof ChangeStatusResponseSchema>;

export const AgentChangeOperationSchema = z.enum([
  'change.validate',
  'change.save',
  'change.apply',
  'change.cancel',
  'change.status',
  'application.clearApplyBlock'
]);
export type AgentChangeOperation = z.infer<typeof AgentChangeOperationSchema>;

export const ConfigChangeDigestSchema = changeDigest;
export const SourceFingerprintSchema = sourceFingerprint;
export const CatalogDigestSchema = digest;
