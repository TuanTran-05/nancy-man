import { z } from 'zod';

import {
  ApplyStrategySchema,
  CategorySchema,
  MutabilitySchema,
  RequirementSchema,
  SensitivitySchema
} from './catalog.js';
import {
  AgentChangeOperationSchema,
  ChangeApplyRequestSchema,
  ChangeCancelRequestSchema,
  ChangeSaveRequestSchema,
  ChangeStatusRequestSchema,
  ChangeValidateRequestSchema,
  ClearApplyBlockRequestSchema,
  ChangeValidationResponseSchema,
  ChangeSavedResponseSchema,
  ChangeApplyStartedResponseSchema,
  ChangeCancelledResponseSchema,
  ChangeStatusResponseSchema,
  ApplyBlockClearedResponseSchema
} from './changeProtocol.js';

export const AGENT_PROTOCOL_VERSION = 1 as const;

const stableIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const variableNamePattern = /^[A-Z][A-Z0-9_]*$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const hmacDigestPattern = /^hmac-sha256:v[0-9]+:[a-f0-9]{64}$/u;
const schemaVersionPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[A-Za-z0-9._-]+)?$/u;
const requestIdPattern = /^REQ_[A-Za-z0-9_]+$/u;
const changeIdPattern = /^CHG_[A-Za-z0-9_]+$/u;

const stableIdSchema = z
  .string()
  .regex(stableIdPattern, 'Stable IDs must be lowercase dotted identifiers');
const isoTimestampSchema = z.string().datetime({ offset: true });
const signatureSchema = z.string().regex(hmacDigestPattern, 'HMAC signature is invalid');

export const AgentOperationSchema = z.enum([
  'agent.capabilities',
  'inventory.read',
  ...AgentChangeOperationSchema.options
]);
export type AgentOperation = z.infer<typeof AgentOperationSchema>;

export const AgentActorSchema = z
  .object({
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
    role: z.enum(['ops_viewer', 'ops_maintainer', 'ops_owner']),
    ipHash: z.string().regex(digestPattern, 'IP hash is invalid'),
    userAgentHash: z.string().regex(digestPattern, 'User-agent hash is invalid')
  })
  .strict();
export type AgentActor = z.infer<typeof AgentActorSchema>;

const precedenceStatusSchema = z
  .object({
    precedenceId: stableIdSchema,
    rank: z.number().int().nonnegative(),
    effective: z.boolean()
  })
  .strict();

const lastOpsChangeSchema = z
  .object({
    actorUserId: z.string().uuid(),
    changeId: z.string().regex(changeIdPattern, 'Change ID is invalid'),
    changedAt: isoTimestampSchema
  })
  .strict();

export const InventoryDefinitionSchema = z
  .object({
    catalogId: stableIdSchema.optional(),
    name: z.string().regex(variableNamePattern, 'Variable name is invalid'),
    value: z.string(),
    appId: stableIdSchema,
    appName: z.string().min(1).max(512),
    functionIds: z.array(stableIdSchema),
    sourceId: stableIdSchema,
    sourcePathLabel: z.string().min(1).max(512),
    sourceAdapter: z.enum([
      'node_env_file',
      'systemd_environment_file',
      'systemd_credential_file',
      'dotenv',
      'pm2_ecosystem_static',
      'none'
    ]),
    consumerIds: z.array(stableIdSchema),
    category: CategorySchema,
    description: z.string().min(1).max(512),
    sensitivity: SensitivitySchema,
    requirement: RequirementSchema,
    mutability: MutabilitySchema,
    applyStrategy: ApplyStrategySchema,
    relatedDefinitionIds: z.array(stableIdSchema),
    precedence: precedenceStatusSchema,
    sourceFingerprint: z.string().regex(hmacDigestPattern, 'Source fingerprint is invalid'),
    valueFingerprint: z.string().regex(hmacDigestPattern, 'Value fingerprint is invalid'),
    sourceMtime: isoTimestampSchema.nullable().optional(),
    lastOpsChange: lastOpsChangeSchema.optional()
  })
  .strict();
export type InventoryDefinition = z.infer<typeof InventoryDefinitionSchema>;

export const InventoryReadRequestSchema = z
  .object({
    includeValues: z.literal(true),
    appIds: z.array(stableIdSchema).optional(),
    sourceIds: z.array(stableIdSchema).optional(),
    categoryIds: z.array(CategorySchema).optional(),
    variableNames: z
      .array(z.string().regex(variableNamePattern, 'Variable name is invalid'))
      .optional(),
    limit: z.number().int().positive().max(1_000).optional()
  })
  .strict();
export type InventoryReadRequest = z.infer<typeof InventoryReadRequestSchema>;

export const InventoryReadResponseSchema = z
  .object({
    catalogVersion: z.string().regex(schemaVersionPattern, 'Catalog version is invalid'),
    manifestVersion: z.string().regex(schemaVersionPattern, 'Manifest version is invalid'),
    generatedAt: isoTimestampSchema,
    items: z.array(InventoryDefinitionSchema)
  })
  .strict();
export type InventoryReadResponse = z.infer<typeof InventoryReadResponseSchema>;

export const AgentCapabilitiesRequestSchema = z.object({}).strict();
export type AgentCapabilitiesRequest = z.infer<typeof AgentCapabilitiesRequestSchema>;

export const AgentCapabilitiesResponseSchema = z
  .object({
    protocolVersion: z.literal(AGENT_PROTOCOL_VERSION),
    readOnly: z.boolean(),
    supportedOperations: z.array(AgentOperationSchema).min(1),
    supportedStrategies: z.array(ApplyStrategySchema).optional(),
    manifestVersion: z.string().regex(schemaVersionPattern, 'Manifest version is invalid'),
    catalogVersion: z.string().regex(schemaVersionPattern, 'Catalog version is invalid'),
    catalogDigest: z.string().regex(digestPattern, 'Catalog digest is invalid'),
    maximumFrameBytes: z.literal(1_048_576)
  })
  .strict();
export type AgentCapabilitiesResponse = z.infer<typeof AgentCapabilitiesResponseSchema>;

const requestEnvelopeBaseSchema = z
  .object({
    version: z.literal(AGENT_PROTOCOL_VERSION),
    requestId: z.string().regex(requestIdPattern, 'Request ID is invalid'),
    issuedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
    actor: AgentActorSchema,
    hmacKeyId: stableIdSchema,
    signature: signatureSchema
  })
  .strict();

const capabilitiesRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('agent.capabilities'),
  body: AgentCapabilitiesRequestSchema
});
const inventoryReadRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('inventory.read'),
  body: InventoryReadRequestSchema
});

const changeValidateRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('change.validate'),
  body: ChangeValidateRequestSchema
});
const changeSaveRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('change.save'),
  body: ChangeSaveRequestSchema
});
const changeApplyRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('change.apply'),
  body: ChangeApplyRequestSchema
});
const changeCancelRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('change.cancel'),
  body: ChangeCancelRequestSchema
});
const changeStatusRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('change.status'),
  body: ChangeStatusRequestSchema
});
const clearApplyBlockRequestEnvelopeSchema = requestEnvelopeBaseSchema.extend({
  operation: z.literal('application.clearApplyBlock'),
  body: ClearApplyBlockRequestSchema
});

export const AgentRequestSchema = z.discriminatedUnion('operation', [
  capabilitiesRequestEnvelopeSchema,
  inventoryReadRequestEnvelopeSchema,
  changeValidateRequestEnvelopeSchema,
  changeSaveRequestEnvelopeSchema,
  changeApplyRequestEnvelopeSchema,
  changeCancelRequestEnvelopeSchema,
  changeStatusRequestEnvelopeSchema,
  clearApplyBlockRequestEnvelopeSchema
]);
export type AgentRequestEnvelope = z.infer<typeof AgentRequestSchema>;

const responseEnvelopeBaseSchema = z
  .object({
    version: z.literal(AGENT_PROTOCOL_VERSION),
    requestId: z.string().regex(requestIdPattern, 'Request ID is invalid'),
    issuedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
    hmacKeyId: stableIdSchema,
    signature: signatureSchema
  })
  .strict();

const protocolErrorSchema = z
  .object({
    // Error codes stay lowercase on the wire; callers may normalize them for
    // their local error enum after signature verification.
    code: stableIdSchema,
    safeMessage: z.string().min(1).max(256),
    retryable: z.boolean().optional(),
    eventId: z
      .string()
      .regex(/^EVT_[A-Za-z0-9_]+$/u, 'Event ID is invalid')
      .optional()
  })
  .strict();

const successfulCapabilitiesResponseSchema = responseEnvelopeBaseSchema.extend({
  operation: z.literal('agent.capabilities'),
  ok: z.literal(true),
  body: AgentCapabilitiesResponseSchema
});
const successfulInventoryResponseSchema = responseEnvelopeBaseSchema.extend({
  operation: z.literal('inventory.read'),
  ok: z.literal(true),
  body: InventoryReadResponseSchema
});
const successfulChangeResponseSchema = z.union([
  responseEnvelopeBaseSchema.extend({
    operation: z.literal('change.validate'),
    ok: z.literal(true),
    body: ChangeValidationResponseSchema
  }),
  responseEnvelopeBaseSchema.extend({
    operation: z.literal('change.save'),
    ok: z.literal(true),
    body: ChangeSavedResponseSchema
  }),
  responseEnvelopeBaseSchema.extend({
    operation: z.literal('change.apply'),
    ok: z.literal(true),
    body: ChangeApplyStartedResponseSchema
  }),
  responseEnvelopeBaseSchema.extend({
    operation: z.literal('change.cancel'),
    ok: z.literal(true),
    body: ChangeCancelledResponseSchema
  }),
  responseEnvelopeBaseSchema.extend({
    operation: z.literal('change.status'),
    ok: z.literal(true),
    body: ChangeStatusResponseSchema
  }),
  responseEnvelopeBaseSchema.extend({
    operation: z.literal('application.clearApplyBlock'),
    ok: z.literal(true),
    body: ApplyBlockClearedResponseSchema
  })
]);
const failedCapabilitiesResponseSchema = responseEnvelopeBaseSchema.extend({
  operation: z.literal('agent.capabilities'),
  ok: z.literal(false),
  error: protocolErrorSchema
});
const failedInventoryResponseSchema = responseEnvelopeBaseSchema.extend({
  operation: z.literal('inventory.read'),
  ok: z.literal(false),
  error: protocolErrorSchema
});
const failedChangeResponseSchema = responseEnvelopeBaseSchema.extend({
  operation: z.enum([
    'change.validate',
    'change.save',
    'change.apply',
    'change.cancel',
    'change.status',
    'application.clearApplyBlock'
  ]),
  ok: z.literal(false),
  error: protocolErrorSchema
});

export const AgentResponseSchema = z.union([
  successfulCapabilitiesResponseSchema,
  successfulInventoryResponseSchema,
  failedCapabilitiesResponseSchema,
  failedInventoryResponseSchema,
  successfulChangeResponseSchema,
  failedChangeResponseSchema
]);
export type AgentResponseEnvelope = z.infer<typeof AgentResponseSchema>;
