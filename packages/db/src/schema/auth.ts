import {
  bigint,
  boolean,
  customType,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { pgTable } from 'drizzle-orm/pg-core';

const byteaColumn = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea'
});

export const opsUsers = pgTable(
  'ops_users',
  {
    id: uuid('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').$type<'ops_viewer' | 'ops_maintainer' | 'ops_owner'>().notNull(),
    status: text('status').$type<'pending_mfa' | 'active' | 'locked' | 'revoked'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    loginBlockedUntil: timestamp('login_blocked_until', { withTimezone: true }),
    administrativelyLockedAt: timestamp('administratively_locked_at', { withTimezone: true }),
    administrativelyLockedBy: uuid('administratively_locked_by'),
    lockReason: text('lock_reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by')
  },
  (table) => [index('ops_users_status_idx').on(table.status)]
);

export const opsPasswordCredentials = pgTable(
  'ops_password_credentials',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordFingerprint: text('password_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true })
  },
  (table) => [index('ops_password_credentials_user_created_idx').on(table.userId, table.createdAt)]
);

export const opsMfaFactors = pgTable(
  'ops_mfa_factors',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    factorType: text('factor_type').$type<'webauthn' | 'totp'>().notNull(),
    encryptedSecret: byteaColumn('encrypted_secret').notNull(),
    credentialMetadata: jsonb('credential_metadata').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [index('ops_mfa_factors_user_idx').on(table.userId)]
);

export const opsRecoveryCodes = pgTable(
  'ops_recovery_codes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    replacedAt: timestamp('replaced_at', { withTimezone: true })
  },
  (table) => [index('ops_recovery_codes_user_idx').on(table.userId)]
);

export const opsSessions = pgTable(
  'ops_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    sessionHash: text('session_hash').notNull(),
    csrfSecretHash: text('csrf_secret_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    ipHash: text('ip_hash').notNull(),
    userAgent: text('user_agent').notNull()
  },
  (table) => [index('ops_sessions_user_active_idx').on(table.userId, table.idleExpiresAt)]
);

export const opsAccountEvents = pgTable(
  'ops_account_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    eventType: text('event_type')
      .$type<
        | 'created'
        | 'role_changed'
        | 'administratively_locked'
        | 'recovery_issued'
        | 'activated'
        | 'revoked'
      >()
      .notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('ops_account_events_user_occurred_idx').on(table.userId, table.occurredAt)]
);

export const opsSecretElevations = pgTable(
  'ops_secret_elevations',
  {
    id: uuid('id').primaryKey(),
    capability: text('capability')
      .$type<'accounts_write' | 'variables_secret' | 'variables_apply'>()
      .notNull(),
    userId: uuid('user_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    ipHash: text('ip_hash').notNull(),
    userAgentHash: text('user_agent_hash').notNull(),
    subjectDigest: text('subject_digest'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    reusable: boolean('reusable').default(false).notNull()
  },
  (table) => [index('ops_secret_elevations_active_idx').on(table.sessionId, table.capability)]
);

export type OpsConfigChangeState =
  | 'DRAFT'
  | 'VALIDATING'
  | 'INVALID'
  | 'READY'
  | 'SAVED'
  | 'APPLYING'
  | 'SNAPSHOTTED'
  | 'WRITTEN'
  | 'ACTION_RUNNING'
  | 'HEALTH_CHECKING'
  | 'COMPLETED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export type OpsConfigChangeOperation = 'set' | 'delete';
export type OpsConfigChangeRequirement = 'required' | 'optional';
export type OpsConfigChangeStrategy =
  | 'no_runtime_action'
  | 'next_job'
  | 'runtime_restart'
  | 'credential_restart'
  | 'build_redeploy';

export type OpsConfigImpactPlan = {
  applicationId: string;
  sourceIds: string[];
  actionIds: string[];
  checkIds: string[];
  strategies: OpsConfigChangeStrategy[];
  counts: { items: number; sets: number; deletes: number; sources: number };
  warnings: string[];
  expectedEffect: OpsConfigChangeStrategy;
};

export const opsConfigChanges = pgTable(
  'ops_config_changes',
  {
    id: uuid('id').primaryKey(),
    supersedesChangeId: uuid('supersedes_change_id'),
    actorUserId: uuid('actor_user_id').notNull(),
    actorSessionId: uuid('actor_session_id').notNull(),
    applicationId: text('application_id').notNull(),
    state: text('state').$type<OpsConfigChangeState>().notNull(),
    reason: text('reason').notNull(),
    changeDigest: text('change_digest'),
    catalogVersion: text('catalog_version').notNull(),
    manifestVersion: text('manifest_version').notNull(),
    keyVersion: text('key_version').notNull(),
    impactPlan: jsonb('impact_plan').$type<OpsConfigImpactPlan>().notNull(),
    agentEnvelopeId: text('agent_envelope_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: bigint('version', { mode: 'number' }).default(0).notNull()
  },
  (table) => [
    index('ops_config_changes_application_state_idx').on(table.applicationId, table.state)
  ]
);

export const opsConfigChangeItems = pgTable(
  'ops_config_change_items',
  {
    id: uuid('id').primaryKey(),
    changeId: uuid('change_id').notNull(),
    sourceId: text('source_id').notNull(),
    catalogId: text('catalog_id').notNull(),
    operation: text('operation').$type<OpsConfigChangeOperation>().notNull(),
    requirement: text('requirement').$type<OpsConfigChangeRequirement>().notNull(),
    strategy: text('strategy').$type<OpsConfigChangeStrategy>().notNull(),
    oldValueFingerprint: text('old_value_fingerprint'),
    newValueFingerprint: text('new_value_fingerprint'),
    observedSourceFingerprint: text('observed_source_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('ops_config_change_items_change_catalog_idx').on(table.changeId, table.catalogId),
    index('ops_config_change_items_change_source_idx').on(table.changeId, table.sourceId)
  ]
);

export const opsConfigRuns = pgTable(
  'ops_config_runs',
  {
    id: uuid('id').primaryKey(),
    changeId: uuid('change_id').notNull(),
    runId: uuid('run_id').notNull(),
    transitionId: uuid('transition_id').notNull(),
    eventId: uuid('event_id').notNull(),
    sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
    fromState: text('from_state').$type<OpsConfigChangeState>().notNull(),
    state: text('state').$type<OpsConfigChangeState>().notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    actorSessionId: uuid('actor_session_id').notNull(),
    actionId: text('action_id'),
    checkId: text('check_id'),
    resultCode: text('result_code'),
    resultSummary: text('result_summary'),
    snapshotReference: text('snapshot_reference'),
    rollbackResult: text('rollback_result'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('ops_config_runs_change_transition_idx').on(table.changeId, table.transitionId),
    uniqueIndex('ops_config_runs_change_event_idx').on(table.changeId, table.eventId),
    uniqueIndex('ops_config_runs_change_sequence_idx').on(table.changeId, table.sequenceNumber),
    index('ops_config_runs_change_occurred_idx').on(table.changeId, table.occurredAt)
  ]
);

export const opsConfigApplicationBlocks = pgTable('ops_config_application_blocks', {
  applicationId: text('application_id').primaryKey(),
  failedRunId: uuid('failed_run_id').notNull(),
  failedChangeId: uuid('failed_change_id').notNull(),
  reasonCode: text('reason_code').notNull(),
  blockedActorUserId: uuid('blocked_actor_user_id').notNull(),
  blockedAt: timestamp('blocked_at', { withTimezone: true }).defaultNow().notNull(),
  acknowledgedActorUserId: uuid('acknowledged_actor_user_id'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  clearedActorUserId: uuid('cleared_actor_user_id'),
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
  clearRemediationSummary: text('clear_remediation_summary')
});
