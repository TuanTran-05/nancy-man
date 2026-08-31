import { randomUUID } from 'node:crypto';

import type { ParameterizedDatabase } from '../../../../../packages/db/src/repositories/opsUsers.js';
import type {
  OpsConfigChangeOperation,
  OpsConfigChangeRequirement,
  OpsConfigChangeState,
  OpsConfigChangeStrategy,
  OpsConfigImpactPlan
} from '../../../../../packages/db/src/schema/auth.js';
import {
  createTransitionId,
  transitionChange,
  type ChangeState,
  type ChangeStateSnapshot
} from './changeStateMachine.js';

export type ConfigFingerprint = string & { readonly __brand: 'ConfigFingerprint' };
export type ConfigDigest = string & { readonly __brand: 'ConfigDigest' };

const fingerprintPattern = /^hmac-sha256:v[0-9]+:[0-9a-f]{64}$/u;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const strategies: readonly OpsConfigChangeStrategy[] = [
  'no_runtime_action',
  'next_job',
  'runtime_restart',
  'credential_restart',
  'build_redeploy'
];
const states: readonly OpsConfigChangeState[] = [
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
];
const forbiddenMetadataKeys = new Set([
  'value',
  'newValue',
  'oldValue',
  'plaintext',
  'secret',
  'password',
  'totp',
  'credential',
  'token',
  'path',
  'command',
  'url'
]);

export type ImpactPlan = OpsConfigImpactPlan;

export type ConfigChangeCreateInput = {
  id: string;
  supersedesChangeId?: string;
  actorUserId: string;
  actorSessionId: string;
  applicationId: string;
  reason: string;
  changeDigest?: ConfigDigest;
  catalogVersion: string;
  manifestVersion: string;
  keyVersion: string;
  impactPlan: ImpactPlan;
  agentEnvelopeId?: string;
  expiresAt: Date;
};

export type ConfigChangeItem = {
  catalogId: string;
  sourceId: string;
  operation: OpsConfigChangeOperation;
  requirement: OpsConfigChangeRequirement;
  strategy: OpsConfigChangeStrategy;
  oldValueFingerprint: ConfigFingerprint | null;
  newValueFingerprint: ConfigFingerprint | null;
  observedSourceFingerprint: ConfigFingerprint;
};

export type ConfigChangeRecord = {
  id: string;
  supersedesChangeId: string | null;
  actorUserId: string;
  actorSessionId: string;
  applicationId: string;
  state: ChangeState;
  reason: string;
  changeDigest: ConfigDigest | null;
  catalogVersion: string;
  manifestVersion: string;
  keyVersion: string;
  impactPlan: ImpactPlan;
  agentEnvelopeId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ConfigChangeTransitionMetadata = {
  actionId?: string;
  checkId?: string;
  resultCode?: string;
  resultSummary?: string;
  snapshotReference?: string;
  rollbackResult?: 'not_started' | 'succeeded' | 'failed';
};

export type ConfigChangeTransitionInput = ConfigChangeTransitionMetadata & {
  changeId: string;
  applicationId: string;
  transitionId: string;
  eventId: string;
  runId: string;
  actorUserId: string;
  actorSessionId: string;
  expectedVersion: number;
  to: ChangeState;
};

export type ConfigChangeTransitionResult = {
  changeId: string;
  applicationId: string;
  state: ChangeState;
  version: number;
  sequence: number;
  transitionId: string;
  eventId: string;
  idempotent: boolean;
};

export type ConfigApplicationBlock = {
  applicationId: string;
  failedRunId: string;
  failedChangeId: string;
  reasonCode: string;
  blockedActorUserId: string;
  blockedAt: string;
  acknowledgedActorUserId: string | null;
  acknowledgedAt: string | null;
  clearedActorUserId: string | null;
  clearedAt: string | null;
  clearRemediationSummary: string | null;
};

export type ChangeTransitionEventRecord = {
  eventId: string;
  changeId: string;
  sequence: number | string;
  state: ChangeState;
  reasonCode: string;
  actionId?: string;
  checkId?: string;
  occurredAt: string;
};

export type ConfigChangeDatabase = ParameterizedDatabase & {
  transaction?: <T>(operation: (database: ParameterizedDatabase) => Promise<T>) => Promise<T>;
};

export class ConfigMetadataError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ConfigMetadataError';
  }
}

function assertIdentifier(value: string, code: string): void {
  if (!identifierPattern.test(value)) throw new ConfigMetadataError(code);
}

function assertUuid(value: string, code: string): void {
  if (!idPattern.test(value)) throw new ConfigMetadataError(code);
}

function assertFingerprint(value: string, code: string): ConfigFingerprint {
  if (!fingerprintPattern.test(value)) throw new ConfigMetadataError(code);
  return value as ConfigFingerprint;
}

export function configFingerprint(value: string): ConfigFingerprint {
  return assertFingerprint(value, 'CONFIG_FINGERPRINT_INVALID');
}

export function configDigest(value: string): ConfigDigest {
  return assertFingerprint(value, 'CONFIG_DIGEST_INVALID') as unknown as ConfigDigest;
}

function assertExactKeys(value: object, allowed: readonly string[], code: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || forbiddenMetadataKeys.has(key)) {
      throw new ConfigMetadataError(code);
    }
  }
}

function assertSafeText(value: string, code: string, max: number): void {
  const hasForbiddenControl = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13;
  });
  if (value.length < 1 || value.length > max || hasForbiddenControl) {
    throw new ConfigMetadataError(code);
  }
}

function assertValueFreeText(value: string, code: string, max: number): void {
  assertSafeText(value, code, max);
  if (/(?:secret|password|totp|credential|plaintext|cleartext)/iu.test(value)) {
    throw new ConfigMetadataError('CONFIG_METADATA_SENSITIVE_TEXT');
  }
}

function assertImpactPlan(value: ImpactPlan): void {
  if (!value || typeof value !== 'object') throw new ConfigMetadataError('CONFIG_IMPACT_INVALID');
  assertExactKeys(
    value,
    [
      'applicationId',
      'sourceIds',
      'actionIds',
      'checkIds',
      'strategies',
      'counts',
      'warnings',
      'expectedEffect'
    ],
    'CONFIG_IMPACT_METADATA_INVALID'
  );
  assertIdentifier(value.applicationId, 'CONFIG_IMPACT_APPLICATION_INVALID');
  if (
    !Array.isArray(value.sourceIds) ||
    !Array.isArray(value.actionIds) ||
    !Array.isArray(value.checkIds) ||
    !Array.isArray(value.strategies) ||
    !Array.isArray(value.warnings)
  ) {
    throw new ConfigMetadataError('CONFIG_IMPACT_ARRAY_INVALID');
  }
  for (const id of [...value.sourceIds, ...value.actionIds, ...value.checkIds]) {
    if (typeof id !== 'string') throw new ConfigMetadataError('CONFIG_IMPACT_ID_INVALID');
    assertIdentifier(id, 'CONFIG_IMPACT_ID_INVALID');
  }
  for (const strategy of value.strategies) {
    if (typeof strategy !== 'string' || !strategies.includes(strategy as OpsConfigChangeStrategy)) {
      throw new ConfigMetadataError('CONFIG_IMPACT_STRATEGY_INVALID');
    }
  }
  if (!strategies.includes(value.expectedEffect)) {
    throw new ConfigMetadataError('CONFIG_IMPACT_EFFECT_INVALID');
  }
  if (!value.counts || typeof value.counts !== 'object') {
    throw new ConfigMetadataError('CONFIG_IMPACT_COUNTS_INVALID');
  }
  assertExactKeys(
    value.counts,
    ['items', 'sets', 'deletes', 'sources'],
    'CONFIG_IMPACT_COUNTS_INVALID'
  );
  for (const count of [
    value.counts.items,
    value.counts.sets,
    value.counts.deletes,
    value.counts.sources
  ]) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) {
      throw new ConfigMetadataError('CONFIG_IMPACT_COUNT_INVALID');
    }
  }
  if (value.counts.sets + value.counts.deletes !== value.counts.items) {
    throw new ConfigMetadataError('CONFIG_IMPACT_COUNT_INCONSISTENT');
  }
  for (const warning of value.warnings) {
    if (typeof warning !== 'string') throw new ConfigMetadataError('CONFIG_IMPACT_WARNING_INVALID');
    assertSafeText(warning, 'CONFIG_IMPACT_WARNING_INVALID', 500);
    if (/(?:secret|password|totp|credential|plaintext|cleartext)/iu.test(warning)) {
      throw new ConfigMetadataError('CONFIG_IMPACT_SENSITIVE_TEXT');
    }
  }
}

function validateCreateInput(input: ConfigChangeCreateInput): void {
  assertExactKeys(
    input,
    [
      'id',
      'supersedesChangeId',
      'actorUserId',
      'actorSessionId',
      'applicationId',
      'reason',
      'changeDigest',
      'catalogVersion',
      'manifestVersion',
      'keyVersion',
      'impactPlan',
      'agentEnvelopeId',
      'expiresAt'
    ],
    'CONFIG_CHANGE_METADATA_INVALID'
  );
  assertUuid(input.id, 'CONFIG_CHANGE_ID_INVALID');
  assertUuid(input.actorUserId, 'CONFIG_ACTOR_INVALID');
  assertUuid(input.actorSessionId, 'CONFIG_SESSION_INVALID');
  assertIdentifier(input.applicationId, 'CONFIG_APPLICATION_INVALID');
  if (input.supersedesChangeId)
    assertUuid(input.supersedesChangeId, 'CONFIG_SUPERSEDES_ID_INVALID');
  assertValueFreeText(input.reason.trim(), 'CONFIG_REASON_INVALID', 2_000);
  if (input.reason.trim().length < 3) throw new ConfigMetadataError('CONFIG_REASON_INVALID');
  assertSafeText(input.catalogVersion, 'CONFIG_CATALOG_VERSION_INVALID', 128);
  assertSafeText(input.manifestVersion, 'CONFIG_MANIFEST_VERSION_INVALID', 128);
  assertSafeText(input.keyVersion, 'CONFIG_KEY_VERSION_INVALID', 128);
  if (input.changeDigest !== undefined) configDigest(input.changeDigest);
  if (input.agentEnvelopeId !== undefined) {
    assertIdentifier(input.agentEnvelopeId, 'CONFIG_ENVELOPE_ID_INVALID');
  }
  if (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime())) {
    throw new ConfigMetadataError('CONFIG_EXPIRY_INVALID');
  }
  assertImpactPlan(input.impactPlan);
  if (input.impactPlan.applicationId !== input.applicationId) {
    throw new ConfigMetadataError('CONFIG_IMPACT_APPLICATION_MISMATCH');
  }
}

function validateItem(input: ConfigChangeItem): void {
  assertExactKeys(
    input,
    [
      'catalogId',
      'sourceId',
      'operation',
      'requirement',
      'strategy',
      'oldValueFingerprint',
      'newValueFingerprint',
      'observedSourceFingerprint'
    ],
    'CONFIG_ITEM_METADATA_INVALID'
  );
  assertIdentifier(input.catalogId, 'CONFIG_CATALOG_ID_INVALID');
  assertIdentifier(input.sourceId, 'CONFIG_SOURCE_ID_INVALID');
  if (input.operation !== 'set' && input.operation !== 'delete') {
    throw new ConfigMetadataError('CONFIG_OPERATION_INVALID');
  }
  if (input.requirement !== 'required' && input.requirement !== 'optional') {
    throw new ConfigMetadataError('CONFIG_REQUIREMENT_INVALID');
  }
  if (!strategies.includes(input.strategy))
    throw new ConfigMetadataError('CONFIG_STRATEGY_INVALID');
  if (input.oldValueFingerprint !== null)
    assertFingerprint(input.oldValueFingerprint, 'CONFIG_FINGERPRINT_INVALID');
  if (input.observedSourceFingerprint === null)
    throw new ConfigMetadataError('CONFIG_SOURCE_FINGERPRINT_INVALID');
  assertFingerprint(input.observedSourceFingerprint, 'CONFIG_SOURCE_FINGERPRINT_INVALID');
  if (input.operation === 'set') {
    if (input.newValueFingerprint === null)
      throw new ConfigMetadataError('CONFIG_NEW_FINGERPRINT_REQUIRED');
    assertFingerprint(input.newValueFingerprint, 'CONFIG_FINGERPRINT_INVALID');
  } else {
    if (input.requirement !== 'optional') throw new ConfigMetadataError('CONFIG_REQUIRED_DELETE');
    if (input.newValueFingerprint !== null)
      throw new ConfigMetadataError('CONFIG_DELETE_FINGERPRINT_FORBIDDEN');
  }
}

function assertState(value: string): ChangeState {
  if (!states.includes(value as OpsConfigChangeState))
    throw new ConfigMetadataError('CONFIG_STATE_INVALID');
  return value as ChangeState;
}

function mapChange(row: ConfigChangeRow): ConfigChangeRecord {
  const state = assertState(row.state);
  assertImpactPlan(row.impactPlan);
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new ConfigMetadataError('CONFIG_VERSION_INVALID');
  }
  return {
    id: row.id,
    supersedesChangeId: row.supersedesChangeId,
    actorUserId: row.actorUserId,
    actorSessionId: row.actorSessionId,
    applicationId: row.applicationId,
    state,
    reason: row.reason,
    changeDigest: row.changeDigest ? configDigest(row.changeDigest) : null,
    catalogVersion: row.catalogVersion,
    manifestVersion: row.manifestVersion,
    keyVersion: row.keyVersion,
    impactPlan: row.impactPlan,
    agentEnvelopeId: row.agentEnvelopeId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version
  };
}

type ConfigChangeRow = {
  id: string;
  supersedesChangeId: string | null;
  actorUserId: string;
  actorSessionId: string;
  applicationId: string;
  state: string;
  reason: string;
  changeDigest: string | null;
  catalogVersion: string;
  manifestVersion: string;
  keyVersion: string;
  impactPlan: ImpactPlan;
  agentEnvelopeId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  version: number | string;
};

function optionalParameter(input: string | undefined): string | null {
  return input ?? null;
}

export class PostgresConfigChangeRepository {
  constructor(private readonly database: ConfigChangeDatabase) {}

  private async inTransaction<T>(
    operation: (database: ParameterizedDatabase) => Promise<T>
  ): Promise<T> {
    if (!this.database.transaction) throw new Error('CONFIG_TRANSACTION_REQUIRED');
    return this.database.transaction(operation);
  }

  async createChange(input: ConfigChangeCreateInput): Promise<ConfigChangeRecord> {
    validateCreateInput(input);
    return this.inTransaction(async (database) => {
      if (input.supersedesChangeId) {
        const { rows } = await database.query<Pick<ConfigChangeRow, 'applicationId' | 'state'>>(
          `SELECT application_id AS "applicationId", state
           FROM ops_config_changes WHERE id = $1 FOR SHARE`,
          [input.supersedesChangeId]
        );
        const superseded = rows[0];
        if (!superseded || superseded.applicationId !== input.applicationId) {
          throw new ConfigMetadataError('CONFIG_SUPERSEDES_APPLICATION_MISMATCH');
        }
        if (!['INVALID', 'READY', 'SAVED'].includes(superseded.state)) {
          throw new ConfigMetadataError('CONFIG_SUPERSEDES_STATE_INVALID');
        }
      }
      const { rows } = await database.query<ConfigChangeRow>(
        `INSERT INTO ops_config_changes (
           id, supersedes_change_id, actor_user_id, actor_session_id, application_id,
           state, reason, change_digest, catalog_version, manifest_version, key_version,
           impact_plan, agent_envelope_id, expires_at
         ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
         RETURNING id, supersedes_change_id AS "supersedesChangeId", actor_user_id AS "actorUserId",
           actor_session_id AS "actorSessionId", application_id AS "applicationId", state, reason,
           change_digest AS "changeDigest", catalog_version AS "catalogVersion",
           manifest_version AS "manifestVersion", key_version AS "keyVersion", impact_plan AS "impactPlan",
           agent_envelope_id AS "agentEnvelopeId", expires_at AS "expiresAt", created_at AS "createdAt",
           updated_at AS "updatedAt", version`,
        [
          input.id,
          optionalParameter(input.supersedesChangeId),
          input.actorUserId,
          input.actorSessionId,
          input.applicationId,
          input.reason.trim(),
          optionalParameter(input.changeDigest),
          input.catalogVersion,
          input.manifestVersion,
          input.keyVersion,
          JSON.stringify(input.impactPlan),
          optionalParameter(input.agentEnvelopeId),
          input.expiresAt
        ]
      );
      if (!rows[0]) throw new Error('CONFIG_CHANGE_CREATE_FAILED');
      return mapChange(rows[0]);
    });
  }

  async getChange(changeId: string): Promise<ConfigChangeRecord | null> {
    assertUuid(changeId, 'CONFIG_CHANGE_ID_INVALID');
    const { rows } = await this.database.query<ConfigChangeRow>(
      `SELECT id, supersedes_change_id AS "supersedesChangeId", actor_user_id AS "actorUserId",
         actor_session_id AS "actorSessionId", application_id AS "applicationId", state, reason,
         change_digest AS "changeDigest", catalog_version AS "catalogVersion",
         manifest_version AS "manifestVersion", key_version AS "keyVersion", impact_plan AS "impactPlan",
         agent_envelope_id AS "agentEnvelopeId", expires_at AS "expiresAt", created_at AS "createdAt",
         updated_at AS "updatedAt", version
       FROM ops_config_changes WHERE id = $1 LIMIT 1`,
      [changeId]
    );
    return rows[0] ? mapChange(rows[0]) : null;
  }

  /** Compatibility name used by the API service boundary. */
  async findById(changeId: string): Promise<ConfigChangeRecord | null> {
    return this.getChange(changeId);
  }

  async updateValidation(input: {
    changeId: string;
    changeDigest: string;
    impactPlan: ImpactPlan;
    itemFingerprints: readonly ConfigChangeItem[];
    state: 'READY' | 'INVALID';
  }): Promise<void> {
    configDigest(input.changeDigest);
    assertImpactPlan(input.impactPlan);
    for (const item of input.itemFingerprints) validateItem(item);
    const current = await this.getChange(input.changeId);
    if (!current) throw new Error('CONFIG_CHANGE_NOT_FOUND');
    if (!['DRAFT', 'INVALID'].includes(current.state)) {
      throw new Error('CONFIG_CHANGE_INVALID_STATE');
    }
    await this.replaceItems(input.changeId, input.itemFingerprints);
    await this.inTransaction(async (database) => {
      await database.query(
        `UPDATE ops_config_changes
         SET state = $2, change_digest = $3, impact_plan = $4::jsonb,
             version = version + 1, updated_at = now()
         WHERE id = $1 AND state IN ('DRAFT', 'INVALID')`,
        [input.changeId, input.state, input.changeDigest, JSON.stringify(input.impactPlan)]
      );
    });
  }

  async markSaved(input: {
    changeId: string;
    changeDigest: string;
    envelopeId?: string;
  }): Promise<void> {
    configDigest(input.changeDigest);
    await this.inTransaction(async (database) => {
      const { rows } = await database.query<{ id: string }>(
        `UPDATE ops_config_changes
         SET state = 'SAVED', change_digest = $2, agent_envelope_id = $3,
             version = version + 1, updated_at = now()
         WHERE id = $1 AND state = 'READY' AND change_digest = $2
         RETURNING id`,
        [input.changeId, input.changeDigest, input.envelopeId ?? null]
      );
      if (!rows[0]) throw new Error('CONFIG_CHANGE_INVALID_STATE');
    });
  }

  async listEvents(
    changeId: string,
    afterEventId?: string
  ): Promise<ChangeTransitionEventRecord[]> {
    assertUuid(changeId, 'CONFIG_CHANGE_ID_INVALID');
    if (
      afterEventId !== undefined &&
      !idPattern.test(afterEventId) &&
      !/^EVT_[A-Za-z0-9_]+$/u.test(afterEventId)
    ) {
      throw new ConfigMetadataError('CONFIG_EVENT_ID_INVALID');
    }
    const databaseEventId = afterEventId && idPattern.test(afterEventId) ? afterEventId : null;
    const { rows } = await this.database.query<ChangeTransitionEventRecord>(
      `SELECT event_id AS "eventId", change_id AS "changeId", sequence_number AS sequence,
         state, COALESCE(result_code, 'STATE_TRANSITION') AS "reasonCode",
         action_id AS "actionId", check_id AS "checkId", occurred_at AS "occurredAt"
       FROM ops_config_runs
       WHERE change_id = $1
         AND ($2::uuid IS NULL OR sequence_number > COALESCE(
           (SELECT sequence_number FROM ops_config_runs WHERE change_id = $1 AND event_id = $2), 0))
       ORDER BY sequence_number ASC`,
      [changeId, databaseEventId]
    );
    return rows.map((row) => ({
      ...row,
      reasonCode: row.reasonCode.toLowerCase(),
      sequence: Number(row.sequence)
    }));
  }

  async cancel(input: {
    changeId: string;
    actorUserId: string;
    actorSessionId: string;
  }): Promise<void> {
    const current = await this.getChange(input.changeId);
    if (
      !current ||
      current.actorUserId !== input.actorUserId ||
      current.actorSessionId !== input.actorSessionId
    ) {
      throw new Error('CONFIG_CHANGE_NOT_FOUND');
    }
    if (!['DRAFT', 'READY', 'SAVED'].includes(current.state)) {
      throw new Error('CONFIG_CHANGE_INVALID_STATE');
    }
    await this.inTransaction(async (database) => {
      const { rows } = await database.query<{ id: string }>(
        `UPDATE ops_config_changes
         SET state = 'CANCELLED', version = version + 1, updated_at = now()
         WHERE id = $1 AND state = $2 AND version = $3
         RETURNING id`,
        [input.changeId, current.state, current.version]
      );
      if (!rows[0]) throw new Error('CONFIG_CHANGE_INVALID_STATE');
    });
  }

  async replaceItems(changeId: string, items: readonly ConfigChangeItem[]): Promise<void> {
    assertUuid(changeId, 'CONFIG_CHANGE_ID_INVALID');
    if (items.length > 10_000) throw new ConfigMetadataError('CONFIG_ITEM_COUNT_INVALID');
    for (const item of items) validateItem(item);
    await this.inTransaction(async (database) => {
      await database.query('DELETE FROM ops_config_change_items WHERE change_id = $1', [changeId]);
      for (const item of items) {
        await database.query(
          `INSERT INTO ops_config_change_items (
             id, change_id, source_id, catalog_id, operation, requirement, strategy,
             old_value_fingerprint, new_value_fingerprint, observed_source_fingerprint
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            randomUUID(),
            changeId,
            item.sourceId,
            item.catalogId,
            item.operation,
            item.requirement,
            item.strategy,
            item.oldValueFingerprint,
            item.newValueFingerprint,
            item.observedSourceFingerprint
          ]
        );
      }
    });
  }

  async transition(input: ConfigChangeTransitionInput): Promise<ConfigChangeTransitionResult> {
    assertUuid(input.changeId, 'CONFIG_CHANGE_ID_INVALID');
    assertIdentifier(input.applicationId, 'CONFIG_APPLICATION_INVALID');
    const transitionId = createTransitionId(input.transitionId);
    const eventId = createTransitionId(input.eventId);
    assertUuid(input.runId, 'CONFIG_RUN_ID_INVALID');
    assertUuid(input.actorUserId, 'CONFIG_ACTOR_INVALID');
    assertUuid(input.actorSessionId, 'CONFIG_SESSION_INVALID');
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new ConfigMetadataError('CONFIG_VERSION_INVALID');
    }
    assertExactKeys(
      input,
      [
        'changeId',
        'applicationId',
        'transitionId',
        'eventId',
        'runId',
        'actorUserId',
        'actorSessionId',
        'expectedVersion',
        'to',
        'actionId',
        'checkId',
        'resultCode',
        'resultSummary',
        'snapshotReference',
        'rollbackResult'
      ],
      'CONFIG_TRANSITION_METADATA_INVALID'
    );
    if (!states.includes(input.to)) throw new ConfigMetadataError('CONFIG_STATE_INVALID');
    if (input.actionId) assertIdentifier(input.actionId, 'CONFIG_ACTION_ID_INVALID');
    if (input.checkId) assertIdentifier(input.checkId, 'CONFIG_CHECK_ID_INVALID');
    if (input.resultCode && !/^[A-Z0-9][A-Z0-9._:-]{0,127}$/u.test(input.resultCode)) {
      throw new ConfigMetadataError('CONFIG_RESULT_CODE_INVALID');
    }
    if (input.resultSummary)
      assertValueFreeText(input.resultSummary, 'CONFIG_RESULT_SUMMARY_INVALID', 500);
    if (input.snapshotReference)
      assertIdentifier(input.snapshotReference, 'CONFIG_SNAPSHOT_REFERENCE_INVALID');

    return this.inTransaction(async (database) => {
      if (input.to === 'APPLYING') {
        await database.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          input.applicationId
        ]);
      }

      const { rows: currentRows } = await database.query<ConfigChangeRow>(
        `SELECT id, supersedes_change_id AS "supersedesChangeId", actor_user_id AS "actorUserId",
           actor_session_id AS "actorSessionId", application_id AS "applicationId", state, reason,
           change_digest AS "changeDigest", catalog_version AS "catalogVersion",
           manifest_version AS "manifestVersion", key_version AS "keyVersion", impact_plan AS "impactPlan",
           agent_envelope_id AS "agentEnvelopeId", expires_at AS "expiresAt", created_at AS "createdAt",
           updated_at AS "updatedAt", version
         FROM ops_config_changes WHERE id = $1 AND application_id = $2 FOR UPDATE`,
        [input.changeId, input.applicationId]
      );
      const current = currentRows[0];
      if (!current) throw new Error('CONFIG_CHANGE_NOT_FOUND');

      const { rows: existingRows } = await database.query<{
        transitionId: string;
        eventId: string;
        state: string;
        sequence: number | string;
        runId: string;
        actorUserId: string;
        actorSessionId: string;
      }>(
        `SELECT transition_id AS "transitionId", event_id AS "eventId", state,
           sequence_number AS sequence, run_id AS "runId", actor_user_id AS "actorUserId",
           actor_session_id AS "actorSessionId"
         FROM ops_config_runs
         WHERE change_id = $1 AND (transition_id = $2 OR event_id = $3)
         LIMIT 1`,
        [input.changeId, input.transitionId, input.eventId]
      );
      const existing = existingRows[0];
      if (existing) {
        if (
          existing.state !== input.to ||
          (existing.transitionId === input.transitionId &&
            (existing.eventId !== input.eventId ||
              existing.runId !== input.runId ||
              existing.actorUserId !== input.actorUserId ||
              existing.actorSessionId !== input.actorSessionId))
        ) {
          throw new Error('CHANGE_IDEMPOTENCY_CONFLICT');
        }
        return {
          changeId: input.changeId,
          applicationId: input.applicationId,
          state: assertState(existing.state),
          version: Number(existing.sequence),
          sequence: Number(existing.sequence),
          transitionId: existing.transitionId,
          eventId: existing.eventId,
          idempotent: true
        };
      }

      if (input.to === 'APPLYING') {
        const { rows: blockRows } = await database.query<{ applicationId: string }>(
          `SELECT application_id AS "applicationId"
           FROM ops_config_application_blocks
           WHERE application_id = $1 AND cleared_at IS NULL
           FOR SHARE`,
          [input.applicationId]
        );
        if (blockRows[0]) throw new Error('CONFIG_APPLICATION_BLOCKED');
      }

      const currentRecord = mapChange(current);
      const snapshot: ChangeStateSnapshot = {
        changeId: currentRecord.id,
        applicationId: currentRecord.applicationId,
        state: currentRecord.state,
        version: currentRecord.version,
        events: []
      };
      const next = transitionChange({
        snapshot,
        to: input.to,
        expectedVersion: input.expectedVersion,
        transitionId,
        eventId,
        actorUserId: input.actorUserId,
        occurredAt: new Date().toISOString()
      });
      const update = await database.query<{ id: string }>(
        `UPDATE ops_config_changes
         SET state = $3, version = $4, updated_at = now()
         WHERE id = $1 AND application_id = $2 AND state = $5 AND version = $6
         RETURNING id`,
        [
          input.changeId,
          input.applicationId,
          next.state,
          next.version,
          currentRecord.state,
          currentRecord.version
        ]
      );
      if (!update.rows[0]) throw new Error('CHANGE_VERSION_CONFLICT');
      await database.query(
        `INSERT INTO ops_config_runs (
           id, change_id, run_id, transition_id, event_id, sequence_number, from_state, state,
           actor_user_id, actor_session_id, action_id, check_id, result_code, result_summary,
           snapshot_reference, rollback_result
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          randomUUID(),
          input.changeId,
          input.runId,
          input.transitionId,
          input.eventId,
          next.version,
          currentRecord.state,
          next.state,
          input.actorUserId,
          input.actorSessionId,
          input.actionId ?? null,
          input.checkId ?? null,
          input.resultCode ?? null,
          input.resultSummary ?? null,
          input.snapshotReference ?? null,
          input.rollbackResult ?? null
        ]
      );
      return {
        changeId: input.changeId,
        applicationId: input.applicationId,
        state: next.state,
        version: next.version,
        sequence: next.version,
        transitionId: input.transitionId,
        eventId: input.eventId,
        idempotent: false
      };
    });
  }

  async findActiveApplicationBlock(applicationId: string): Promise<ConfigApplicationBlock | null> {
    assertIdentifier(applicationId, 'CONFIG_APPLICATION_INVALID');
    const { rows } = await this.database.query<ConfigApplicationBlock>(
      `SELECT application_id AS "applicationId", failed_run_id AS "failedRunId",
         failed_change_id AS "failedChangeId", reason_code AS "reasonCode",
         blocked_actor_user_id AS "blockedActorUserId", blocked_at AS "blockedAt",
         acknowledged_actor_user_id AS "acknowledgedActorUserId", acknowledged_at AS "acknowledgedAt",
         cleared_actor_user_id AS "clearedActorUserId", cleared_at AS "clearedAt",
         clear_remediation_summary AS "clearRemediationSummary"
       FROM ops_config_application_blocks
       WHERE application_id = $1 AND cleared_at IS NULL LIMIT 1`,
      [applicationId]
    );
    return rows[0] ?? null;
  }

  async findLatestRunId(changeId: string): Promise<string | null> {
    assertUuid(changeId, 'CONFIG_CHANGE_ID_INVALID');
    const { rows } = await this.database.query<{ id: string }>(
      `SELECT id FROM ops_config_runs
       WHERE change_id = $1
       ORDER BY sequence_number DESC, occurred_at DESC
       LIMIT 1`,
      [changeId]
    );
    return rows[0]?.id ?? null;
  }

  async blockApplication(input: {
    applicationId: string;
    failedRunId: string;
    failedChangeId: string;
    reasonCode: string;
    blockedActorUserId: string;
  }): Promise<boolean> {
    assertIdentifier(input.applicationId, 'CONFIG_APPLICATION_INVALID');
    assertUuid(input.failedRunId, 'CONFIG_RUN_ID_INVALID');
    assertUuid(input.failedChangeId, 'CONFIG_CHANGE_ID_INVALID');
    assertUuid(input.blockedActorUserId, 'CONFIG_ACTOR_INVALID');
    if (!/^[A-Z0-9][A-Z0-9._:-]{2,127}$/u.test(input.reasonCode)) {
      throw new ConfigMetadataError('CONFIG_BLOCK_REASON_INVALID');
    }
    const { rows } = await this.database.query<{ applicationId: string }>(
      `INSERT INTO ops_config_application_blocks (
         application_id, failed_run_id, failed_change_id, reason_code, blocked_actor_user_id
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (application_id) WHERE cleared_at IS NULL DO NOTHING
       RETURNING application_id AS "applicationId"`,
      [
        input.applicationId,
        input.failedRunId,
        input.failedChangeId,
        input.reasonCode,
        input.blockedActorUserId
      ]
    );
    return rows.length === 1;
  }

  async clearApplicationBlock(input: {
    applicationId: string;
    actorUserId: string;
    remediationSummary: string;
    incidentId: string;
  }): Promise<boolean> {
    assertIdentifier(input.applicationId, 'CONFIG_APPLICATION_INVALID');
    assertUuid(input.actorUserId, 'CONFIG_ACTOR_INVALID');
    assertIdentifier(input.incidentId, 'CONFIG_INCIDENT_INVALID');
    assertValueFreeText(input.remediationSummary.trim(), 'CONFIG_REMEDIATION_INVALID', 2_000);
    if (input.remediationSummary.trim().length < 3)
      throw new ConfigMetadataError('CONFIG_REMEDIATION_INVALID');
    const { rows } = await this.database.query<{ applicationId: string }>(
      `UPDATE ops_config_application_blocks
       SET cleared_actor_user_id = $2, cleared_at = now(), clear_remediation_summary = $3
       WHERE application_id = $1 AND cleared_at IS NULL
         AND EXISTS (
           SELECT 1 FROM incidents
           WHERE (incidents.id::text = $4 OR incidents.incident_key = $4)
             AND incidents.status = 'resolved'
         )
       RETURNING application_id AS "applicationId"`,
      [input.applicationId, input.actorUserId, input.remediationSummary.trim(), input.incidentId]
    );
    return rows.length === 1;
  }
}
