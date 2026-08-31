import { createHash, randomUUID } from 'node:crypto';

import type {
  AgentActor,
  ChangeApplyRequest,
  ChangeCancelRequest,
  ChangeSaveRequest,
  ChangeStatusRequest,
  ChangeValidateRequest,
  ClearApplyBlockRequest,
  ChangeImpactPlan,
  ChangeStatusResponse,
  ChangeValidationResponse
} from '../../../../../packages/config-contracts/src/index.js';
import {
  ChangeStatusResponseSchema,
  type ConfigChangeState
} from '../../../../../packages/config-contracts/src/changeProtocol.js';
import type { OpsRole } from '../../../../../packages/security/src/sessions.js';

export type ConfigChangePrincipal = Readonly<{
  userId: string;
  sessionId: string;
  role: OpsRole;
  ipHash: string;
  userAgentHash: string;
}>;

export type ConfigChangeRepository = {
  createChange: (input: {
    id: string;
    actorUserId: string;
    actorSessionId: string;
    applicationId: string;
    reason: string;
    supersedesChangeId?: string;
    catalogVersion: string;
    manifestVersion: string;
    keyVersion: string;
    expiresAt: Date;
    impactPlan: ChangeImpactPlan;
  }) => Promise<unknown>;
  findById: (changeId: string) => Promise<ConfigChangeRecord | null>;
  replaceItems: (changeId: string, items: readonly ConfigChangeItem[]) => Promise<void>;
  updateValidation?: (input: {
    changeId: string;
    changeDigest: string;
    impactPlan: ChangeImpactPlan;
    itemFingerprints: readonly ConfigChangeItem[];
    state: 'READY' | 'INVALID';
  }) => Promise<void>;
  markSaved?: (input: {
    changeId: string;
    changeDigest: string;
    envelopeId?: string;
  }) => Promise<void>;
  transition: (input: {
    changeId: string;
    applicationId: string;
    transitionId: string;
    eventId: string;
    runId: string;
    actorUserId: string;
    actorSessionId: string;
    expectedVersion: number;
    to: ConfigChangeRecord['state'];
    resultCode?: string;
    actionId?: string;
    checkId?: string;
  }) => Promise<ConfigChangeRecord>;
  listEvents?: (
    changeId: string,
    afterEventId?: string
  ) => Promise<readonly ChangeStatusEventRecord[]>;
  cancel?: (input: {
    changeId: string;
    actorUserId: string;
    actorSessionId: string;
  }) => Promise<void>;
  clearApplyBlock?: (input: {
    appId: string;
    actorUserId: string;
    remediationSummary: string;
    incidentId: string;
  }) => Promise<boolean>;
  blockApplication?: (input: {
    applicationId: string;
    failedRunId: string;
    failedChangeId: string;
    reasonCode: string;
    blockedActorUserId: string;
  }) => Promise<boolean>;
  findLatestRunId?: (changeId: string) => Promise<string | null>;
};

export type ConfigChangeRecord = Readonly<{
  id: string;
  applicationId: string;
  actorUserId: string;
  actorSessionId: string;
  state: ConfigChangeState;
  reason: string;
  changeDigest?: string | null;
  catalogVersion: string;
  manifestVersion: string;
  impactPlan?: ChangeImpactPlan;
  version: number;
  expiresAt: string;
}>;

export type ConfigChangeItem = Readonly<{
  catalogId: string;
  sourceId: string;
  operation: 'set' | 'delete';
  requirement: 'required' | 'optional';
  strategy: ChangeValidateRequest['items'][number]['strategy'];
  oldValueFingerprint: string | null;
  newValueFingerprint: string | null;
  observedSourceFingerprint: string;
}>;

export type ChangeStatusEventRecord = Readonly<{
  eventId: string;
  changeId: string;
  sequence: number;
  state: ConfigChangeRecord['state'];
  reasonCode: string;
  actionId?: string;
  checkId?: string;
  occurredAt: string;
}>;

export type ConfigChangeAgent = {
  validateChange: (
    actor: AgentActor,
    input: ChangeValidateRequest
  ) => Promise<ChangeValidationResponse>;
  saveChange: (
    actor: AgentActor,
    input: ChangeSaveRequest
  ) => Promise<{ changeId: string; state: 'SAVED'; changeDigest: string; expiresAt: string }>;
  applyChange: (
    actor: AgentActor,
    input: ChangeApplyRequest
  ) => Promise<{ changeId: string; runId: string; state: 'APPLYING' }>;
  cancelChange: (
    actor: AgentActor,
    input: ChangeCancelRequest
  ) => Promise<{ changeId: string; state: 'CANCELLED' }>;
  getChangeStatus: (actor: AgentActor, input: ChangeStatusRequest) => Promise<ChangeStatusResponse>;
  clearApplyBlock: (
    actor: AgentActor,
    input: ClearApplyBlockRequest
  ) => Promise<{ appId: string; state: 'CLEARED' }>;
};

export class ConfigChangeServiceError extends Error {
  constructor(
    readonly code:
      | 'CONFIG_CHANGE_NOT_FOUND'
      | 'CONFIG_CHANGE_INVALID_STATE'
      | 'CONFIG_SOURCE_CHANGED'
      | 'CONFIG_APPLICATION_BLOCKED'
      | 'CONFIG_CONTROL_DEGRADED'
      | 'CONFIG_CHANGE_AGENT_ERROR'
  ) {
    super(code);
    this.name = 'ConfigChangeServiceError';
  }
}

function actorFor(principal: ConfigChangePrincipal): AgentActor {
  return {
    userId: principal.userId,
    sessionId: principal.sessionId,
    role: principal.role,
    ipHash: principal.ipHash,
    userAgentHash: principal.userAgentHash
  };
}

function uuid(): string {
  return randomUUID();
}

/**
 * The public protocol deliberately accepts opaque RUN_/EVT_ identifiers, while
 * the PostgreSQL audit tables use UUID columns. Keep the protocol identifier
 * out of SQL and derive a stable UUID only for the value-free database event.
 */
function databaseUuid(seed: string): string {
  const bytes = createHash('sha256').update(seed, 'utf8').digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const terminalStates = new Set<ConfigChangeState>([
  'COMPLETED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'CANCELLED',
  'EXPIRED',
  'INVALID'
]);

function unrefDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });
}

function requireOwnerRecord(record: ConfigChangeRecord | null): ConfigChangeRecord {
  if (!record) throw new ConfigChangeServiceError('CONFIG_CHANGE_NOT_FOUND');
  return record;
}

export class ConfigChangeService {
  constructor(
    private readonly input: {
      repository: ConfigChangeRepository;
      agent: ConfigChangeAgent;
      catalogVersion: string;
      manifestVersion: string;
      keyVersion?: string;
      draftEnabled?: boolean;
      runtimeApplyEnabled?: boolean;
      buildApplyEnabled?: boolean;
      incident?: {
        create: (input: {
          actorUserId: string;
          title: string;
          severity: 'critical';
          summary: string;
          issueIds: string[];
        }) => Promise<unknown>;
      };
    }
  ) {}

  private async transitionDatabase(input: {
    record: ConfigChangeRecord;
    state: ConfigChangeState;
    seed: string;
    reasonCode?: string;
  }): Promise<ConfigChangeRecord> {
    if (input.record.state === input.state) return input.record;
    const result = await this.input.repository.transition({
      changeId: input.record.id,
      applicationId: input.record.applicationId,
      transitionId: databaseUuid(`config-reconcile-transition:${input.seed}`),
      eventId: databaseUuid(`config-reconcile-event:${input.seed}`),
      runId: databaseUuid(`config-reconcile-run:${input.record.id}`),
      actorUserId: input.record.actorUserId,
      actorSessionId: input.record.actorSessionId,
      expectedVersion: input.record.version,
      to: input.state,
      ...(input.reasonCode ? { resultCode: input.reasonCode.toUpperCase() } : {})
    });
    return result;
  }

  private async reconcileAgentStatus(
    record: ConfigChangeRecord,
    result: ChangeStatusResponse
  ): Promise<ConfigChangeRecord> {
    let current = record;
    for (const event of result.events) {
      if (event.state === current.state) continue;
      try {
        current = await this.transitionDatabase({
          record: current,
          state: event.state,
          seed: `${record.id}:${event.eventId}`,
          reasonCode: event.reasonCode
        });
      } catch (error) {
        const refreshed = await this.input.repository.findById(record.id);
        if (!refreshed || refreshed.state !== event.state) throw error;
        current = refreshed;
      }
    }
    if (result.state === 'ROLLBACK_FAILED' && this.input.repository.blockApplication) {
      const failedRunId =
        (await this.input.repository.findLatestRunId?.(record.id)) ??
        databaseUuid(`config-failed-run:${record.id}:${result.sequence}`);
      const blocked = await this.input.repository.blockApplication({
        applicationId: record.applicationId,
        failedRunId,
        failedChangeId: record.id,
        reasonCode: 'ROLLBACK_FAILED',
        blockedActorUserId: record.actorUserId
      });
      if (blocked) {
        await this.input.incident?.create({
          actorUserId: record.actorUserId,
          title: `Configuration rollback failed for ${record.applicationId}`,
          severity: 'critical',
          summary: 'Automatic configuration rollback failed; remediation is required.',
          issueIds: []
        });
      }
    }
    return current;
  }

  private async persistDispatchFailure(record: ConfigChangeRecord): Promise<void> {
    if (record.state !== 'APPLYING') return;
    let current = record;
    try {
      current = await this.transitionDatabase({
        record: current,
        state: 'ROLLING_BACK',
        seed: `${record.id}:dispatch:rollback`
      });
      current = await this.transitionDatabase({
        record: current,
        state: 'ROLLBACK_FAILED',
        seed: `${record.id}:dispatch:failed`
      });
    } catch {
      const refreshed = await this.input.repository.findById(record.id);
      if (refreshed) current = refreshed;
      if (current.state === 'ROLLING_BACK') {
        try {
          current = await this.transitionDatabase({
            record: current,
            state: 'ROLLBACK_FAILED',
            seed: `${record.id}:dispatch:failed:retry`
          });
        } catch {
          const retry = await this.input.repository.findById(record.id);
          if (retry) current = retry;
        }
      }
    }
    if (current.state === 'ROLLBACK_FAILED') {
      const failedRunId =
        (await this.input.repository.findLatestRunId?.(record.id)) ??
        databaseUuid(`config-failed-run:${record.id}:dispatch`);
      const blocked = await this.input.repository.blockApplication?.({
        applicationId: record.applicationId,
        failedRunId,
        failedChangeId: record.id,
        reasonCode: 'DISPATCH_FAILED',
        blockedActorUserId: record.actorUserId
      });
      if (blocked) {
        await this.input.incident?.create({
          actorUserId: record.actorUserId,
          title: `Configuration dispatch failed for ${record.applicationId}`,
          severity: 'critical',
          summary: 'Config Agent dispatch failed after database apply state was recorded.',
          issueIds: []
        });
      }
    }
  }

  private async monitorApply(
    principal: ConfigChangePrincipal,
    body: ChangeApplyRequest
  ): Promise<void> {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await unrefDelay(1_000);
      try {
        const result = ChangeStatusResponseSchema.parse(
          await this.input.agent.getChangeStatus(actorFor(principal), { changeId: body.changeId })
        );
        const record = await this.input.repository.findById(body.changeId);
        if (record) await this.reconcileAgentStatus(record, result);
        if (terminalStates.has(result.state)) return;
      } catch {
        // A restarting agent is not evidence of a failed run; the final timeout below
        // converts a permanently unreachable apply into a durable blocked state.
      }
    }
    const record = await this.input.repository.findById(body.changeId);
    if (record?.state === 'APPLYING') await this.persistDispatchFailure(record);
  }

  async createDraft(input: {
    principal: ConfigChangePrincipal;
    applicationId: string;
    reason: string;
    supersedesChangeId?: string;
  }): Promise<{ changeId: string; state: 'DRAFT'; expiresAt: string }> {
    if (!this.input.draftEnabled) throw new ConfigChangeServiceError('CONFIG_CONTROL_DEGRADED');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.applicationId)) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_AGENT_ERROR');
    }
    const changeId = uuid();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    await this.input.repository.createChange({
      id: changeId,
      actorUserId: input.principal.userId,
      actorSessionId: input.principal.sessionId,
      applicationId: input.applicationId,
      reason: input.reason,
      ...(input.supersedesChangeId ? { supersedesChangeId: input.supersedesChangeId } : {}),
      catalogVersion: this.input.catalogVersion,
      manifestVersion: this.input.manifestVersion,
      keyVersion: this.input.keyVersion ?? 'v1',
      expiresAt: new Date(expiresAt),
      impactPlan: {
        applicationId: input.applicationId,
        sourceIds: [],
        actionIds: [],
        checkIds: [],
        strategies: [],
        counts: { items: 0, sets: 0, deletes: 0, sources: 0 },
        warnings: [],
        expectedEffect: 'no_runtime_action'
      }
    });
    return { changeId, state: 'DRAFT', expiresAt };
  }

  async validate(input: {
    principal: ConfigChangePrincipal;
    body: ChangeValidateRequest;
  }): Promise<ChangeValidationResponse> {
    if (!this.input.draftEnabled) throw new ConfigChangeServiceError('CONFIG_CONTROL_DEGRADED');
    const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
    if (
      record.actorUserId !== input.principal.userId ||
      record.actorSessionId !== input.principal.sessionId
    ) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_NOT_FOUND');
    }
    try {
      const result = await this.input.agent.validateChange(actorFor(input.principal), input.body);
      const requestItems = new Map(
        input.body.items.map((item) => [`${item.sourceId}\u0000${item.catalogId}`, item])
      );
      const itemFingerprints = result.itemFingerprints.map((item) => {
        const requested = requestItems.get(`${item.sourceId}\u0000${item.catalogId}`);
        if (!requested) throw new ConfigChangeServiceError('CONFIG_CHANGE_AGENT_ERROR');
        return {
          catalogId: item.catalogId,
          sourceId: item.sourceId,
          operation: requested.operation,
          requirement: requested.requirement === 'unknown' ? 'optional' : requested.requirement,
          strategy: requested.strategy,
          oldValueFingerprint: item.oldValueFingerprint,
          newValueFingerprint: requested.operation === 'delete' ? null : item.newValueFingerprint,
          observedSourceFingerprint: requested.sourceFingerprint
        } satisfies ConfigChangeItem;
      });
      if (this.input.repository.updateValidation) {
        await this.input.repository.updateValidation({
          changeId: input.body.changeId,
          changeDigest: result.changeDigest,
          impactPlan: result.impactPlan,
          itemFingerprints,
          state: result.state === 'READY' ? 'READY' : 'INVALID'
        });
      } else {
        await this.input.repository.replaceItems(input.body.changeId, itemFingerprints);
      }
      return result;
    } catch (error) {
      if (error instanceof ConfigChangeServiceError) throw error;
      if (error instanceof Error && error.message.includes('CONFIG_SOURCE_CHANGED')) {
        throw new ConfigChangeServiceError('CONFIG_SOURCE_CHANGED');
      }
      throw new ConfigChangeServiceError('CONFIG_CHANGE_AGENT_ERROR');
    }
  }

  async replaceItems(input: {
    principal: ConfigChangePrincipal;
    changeId: string;
    body: ChangeValidateRequest;
  }): Promise<ChangeValidationResponse> {
    return this.validate({
      principal: input.principal,
      body: { ...input.body, changeId: input.changeId, replaceDraft: true }
    });
  }

  async save(input: { principal: ConfigChangePrincipal; body: ChangeSaveRequest }) {
    if (!this.input.draftEnabled) throw new ConfigChangeServiceError('CONFIG_CONTROL_DEGRADED');
    const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
    if (
      record.state !== 'READY' ||
      record.actorUserId !== input.principal.userId ||
      record.actorSessionId !== input.principal.sessionId
    ) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
    }
    const saved = await this.input.agent.saveChange(actorFor(input.principal), input.body);
    await this.input.repository.markSaved?.({
      changeId: saved.changeId,
      changeDigest: saved.changeDigest
    });
    return saved;
  }

  async apply(input: { principal: ConfigChangePrincipal; body: ChangeApplyRequest }) {
    if (!this.input.runtimeApplyEnabled && !this.input.buildApplyEnabled) {
      throw new ConfigChangeServiceError('CONFIG_CONTROL_DEGRADED');
    }
    const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
    if (
      record.state !== 'SAVED' ||
      record.changeDigest !== input.body.changeDigest ||
      record.actorUserId !== input.principal.userId ||
      record.actorSessionId !== input.principal.sessionId
    ) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
    }
    let databaseApplying = false;
    let databaseApplyingRecord = record;
    try {
      const transitioned = await this.input.repository.transition({
        changeId: record.id,
        applicationId: record.applicationId,
        transitionId: databaseUuid(
          `config-transition:${input.body.changeId}:${input.body.runId}:${input.body.idempotencyKey}`
        ),
        eventId: databaseUuid(`config-event:${input.body.changeId}:${input.body.idempotencyKey}`),
        runId: databaseUuid(`config-run:${input.body.changeId}:${input.body.runId}`),
        actorUserId: input.principal.userId,
        actorSessionId: input.principal.sessionId,
        expectedVersion: record.version,
        to: 'APPLYING'
      });
      databaseApplying = true;
      databaseApplyingRecord = transitioned ?? {
        ...record,
        state: 'APPLYING',
        version: record.version + 1
      };
      const result = await this.input.agent.applyChange(actorFor(input.principal), input.body);
      void this.monitorApply(input.principal, input.body).catch(() => undefined);
      return result;
    } catch (error) {
      if (databaseApplying) {
        await this.persistDispatchFailure(databaseApplyingRecord);
      }
      if (error instanceof Error && error.message.includes('CONFIG_APPLICATION_BLOCKED')) {
        throw new ConfigChangeServiceError('CONFIG_APPLICATION_BLOCKED');
      }
      if (
        error instanceof Error &&
        /(?:INVALID_STATE|VERSION_CONFLICT|TERMINAL)/u.test(error.message)
      ) {
        throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
      }
      throw new ConfigChangeServiceError('CONFIG_CHANGE_AGENT_ERROR');
    }
  }

  async status(input: {
    principal: ConfigChangePrincipal;
    body: ChangeStatusRequest;
  }): Promise<ChangeStatusResponse> {
    try {
      const result = await this.input.agent.getChangeStatus(actorFor(input.principal), input.body);
      const parsed = ChangeStatusResponseSchema.parse(result);
      const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
      await this.reconcileAgentStatus(record, parsed);
      return parsed;
    } catch {
      const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
      const events =
        (await this.input.repository.listEvents?.(input.body.changeId, input.body.afterEventId)) ??
        [];
      return ChangeStatusResponseSchema.parse({
        changeId: record.id,
        state: record.state,
        sequence: record.version,
        events,
        ...(record.impactPlan ? { impactPlan: record.impactPlan } : {}),
        ...(record.changeDigest ? { changeDigest: record.changeDigest } : {})
      });
    }
  }

  async cancel(input: { principal: ConfigChangePrincipal; body: ChangeCancelRequest }) {
    const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
    if (
      record.actorUserId !== input.principal.userId ||
      record.actorSessionId !== input.principal.sessionId ||
      !['DRAFT', 'READY', 'SAVED'].includes(record.state)
    ) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
    }
    try {
      const result = await this.input.agent.cancelChange(actorFor(input.principal), input.body);
      await this.input.repository.cancel?.({
        changeId: input.body.changeId,
        actorUserId: input.principal.userId,
        actorSessionId: input.principal.sessionId
      });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('CONFIG_CHANGE_NOT_FOUND')) {
        throw new ConfigChangeServiceError('CONFIG_CHANGE_NOT_FOUND');
      }
      if (
        error instanceof Error &&
        /(?:INVALID_STATE|VERSION_CONFLICT|TERMINAL)/u.test(error.message)
      ) {
        throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
      }
      throw new ConfigChangeServiceError('CONFIG_CHANGE_AGENT_ERROR');
    }
  }

  async clearApplyBlock(input: { principal: ConfigChangePrincipal; body: ClearApplyBlockRequest }) {
    if (input.principal.role !== 'ops_owner')
      throw new ConfigChangeServiceError('CONFIG_APPLICATION_BLOCKED');
    const cleared = await this.input.repository.clearApplyBlock?.({
      appId: input.body.appId,
      actorUserId: input.principal.userId,
      remediationSummary: input.body.remediationSummary,
      incidentId: input.body.incidentId
    });
    if (cleared === false) throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
    const result = await this.input.agent.clearApplyBlock(actorFor(input.principal), input.body);
    return result;
  }
}
