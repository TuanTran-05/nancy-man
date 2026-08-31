import { randomUUID } from 'node:crypto';

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
import { ChangeStatusResponseSchema } from '../../../../../packages/config-contracts/src/changeProtocol.js';
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
  markSaved?: (input: { changeId: string; changeDigest: string; envelopeId?: string }) => Promise<void>;
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
  }) => Promise<ConfigChangeRecord>;
  listEvents?: (changeId: string, afterEventId?: string) => Promise<readonly ChangeStatusEventRecord[]>;
  cancel?: (input: { changeId: string; actorUserId: string; actorSessionId: string }) => Promise<void>;
  clearApplyBlock?: (input: {
    appId: string;
    actorUserId: string;
    remediationSummary: string;
    incidentId: string;
  }) => Promise<void>;
};

export type ConfigChangeRecord = Readonly<{
  id: string;
  applicationId: string;
  actorUserId: string;
  actorSessionId: string;
  state: ChangeValidateRequest['replaceDraft'] extends boolean ?
    | 'DRAFT' | 'VALIDATING' | 'INVALID' | 'READY' | 'SAVED' | 'APPLYING' | 'SNAPSHOTTED'
    | 'WRITTEN' | 'ACTION_RUNNING' | 'HEALTH_CHECKING' | 'COMPLETED' | 'ROLLING_BACK'
    | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | 'CANCELLED' | 'EXPIRED' : never;
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
  oldValueFingerprint?: string | null;
  newValueFingerprint?: string | null;
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
  validateChange: (actor: AgentActor, input: ChangeValidateRequest) => Promise<ChangeValidationResponse>;
  saveChange: (actor: AgentActor, input: ChangeSaveRequest) => Promise<{ changeId: string; state: 'SAVED'; changeDigest: string; expiresAt: string }>;
  applyChange: (actor: AgentActor, input: ChangeApplyRequest) => Promise<{ changeId: string; runId: string; state: 'APPLYING' }>;
  cancelChange: (actor: AgentActor, input: ChangeCancelRequest) => Promise<{ changeId: string; state: 'CANCELLED' }>;
  getChangeStatus: (actor: AgentActor, input: ChangeStatusRequest) => Promise<ChangeStatusResponse>;
  clearApplyBlock: (actor: AgentActor, input: ClearApplyBlockRequest) => Promise<{ appId: string; state: 'CLEARED' }>;
};

export class ConfigChangeServiceError extends Error {
  constructor(readonly code:
    | 'CONFIG_CHANGE_NOT_FOUND'
    | 'CONFIG_CHANGE_INVALID_STATE'
    | 'CONFIG_SOURCE_CHANGED'
    | 'CONFIG_APPLICATION_BLOCKED'
    | 'CONFIG_CONTROL_DEGRADED'
    | 'CONFIG_CHANGE_AGENT_ERROR') {
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

function requireOwnerRecord(record: ConfigChangeRecord | null): ConfigChangeRecord {
  if (!record) throw new ConfigChangeServiceError('CONFIG_CHANGE_NOT_FOUND');
  return record;
}

export class ConfigChangeService {
  constructor(private readonly input: {
    repository: ConfigChangeRepository;
    agent: ConfigChangeAgent;
    catalogVersion: string;
    manifestVersion: string;
    keyVersion?: string;
    draftEnabled?: boolean;
    runtimeApplyEnabled?: boolean;
    buildApplyEnabled?: boolean;
  }) {}

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

  async validate(input: { principal: ConfigChangePrincipal; body: ChangeValidateRequest }): Promise<ChangeValidationResponse> {
    if (!this.input.draftEnabled) throw new ConfigChangeServiceError('CONFIG_CONTROL_DEGRADED');
    const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
    if (record.actorUserId !== input.principal.userId || record.actorSessionId !== input.principal.sessionId) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_NOT_FOUND');
    }
    try {
      const result = await this.input.agent.validateChange(actorFor(input.principal), input.body);
      await this.input.repository.updateValidation?.({
        changeId: input.body.changeId,
        changeDigest: result.changeDigest,
        impactPlan: result.impactPlan,
        itemFingerprints: result.itemFingerprints.map((item) => ({
          catalogId: item.catalogId,
          sourceId: item.sourceId,
          operation: 'set',
          requirement: 'optional',
          strategy: result.impactPlan.strategies[0] ?? 'no_runtime_action',
          oldValueFingerprint: item.oldValueFingerprint,
          newValueFingerprint: item.newValueFingerprint,
          observedSourceFingerprint: item.oldValueFingerprint
        })),
        state: result.state === 'READY' ? 'READY' : 'INVALID'
      });
      return result;
    } catch (error) {
      if (error instanceof ConfigChangeServiceError) throw error;
      if (error instanceof Error && error.message.includes('CONFIG_SOURCE_CHANGED')) {
        throw new ConfigChangeServiceError('CONFIG_SOURCE_CHANGED');
      }
      throw new ConfigChangeServiceError('CONFIG_CHANGE_AGENT_ERROR');
    }
  }

  async replaceItems(input: { principal: ConfigChangePrincipal; changeId: string; body: ChangeValidateRequest }): Promise<ChangeValidationResponse> {
    return this.validate({ principal: input.principal, body: { ...input.body, changeId: input.changeId, replaceDraft: true } });
  }

  async save(input: { principal: ConfigChangePrincipal; body: ChangeSaveRequest }) {
    if (!this.input.draftEnabled) throw new ConfigChangeServiceError('CONFIG_CONTROL_DEGRADED');
    const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
    if (record.state !== 'READY' || record.actorUserId !== input.principal.userId) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
    }
    const saved = await this.input.agent.saveChange(actorFor(input.principal), input.body);
    await this.input.repository.markSaved?.({ changeId: saved.changeId, changeDigest: saved.changeDigest });
    return saved;
  }

  async apply(input: { principal: ConfigChangePrincipal; body: ChangeApplyRequest }) {
    if (!this.input.runtimeApplyEnabled && !this.input.buildApplyEnabled) {
      throw new ConfigChangeServiceError('CONFIG_CONTROL_DEGRADED');
    }
    const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
    if (record.state !== 'SAVED' || record.changeDigest !== input.body.changeDigest) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
    }
    try {
      return await this.input.agent.applyChange(actorFor(input.principal), input.body);
    } catch {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_AGENT_ERROR');
    }
  }

  async status(input: { principal: ConfigChangePrincipal; body: ChangeStatusRequest }): Promise<ChangeStatusResponse> {
    try {
      const result = await this.input.agent.getChangeStatus(actorFor(input.principal), input.body);
      return ChangeStatusResponseSchema.parse(result);
    } catch {
      const record = requireOwnerRecord(await this.input.repository.findById(input.body.changeId));
      const events = await this.input.repository.listEvents?.(input.body.changeId, input.body.afterEventId) ?? [];
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
    if (record.actorUserId !== input.principal.userId || !['DRAFT', 'READY', 'SAVED'].includes(record.state)) {
      throw new ConfigChangeServiceError('CONFIG_CHANGE_INVALID_STATE');
    }
    return this.input.agent.cancelChange(actorFor(input.principal), input.body);
  }

  async clearApplyBlock(input: { principal: ConfigChangePrincipal; body: ClearApplyBlockRequest }) {
    if (input.principal.role !== 'ops_owner') throw new ConfigChangeServiceError('CONFIG_APPLICATION_BLOCKED');
    const result = await this.input.agent.clearApplyBlock(actorFor(input.principal), input.body);
    await this.input.repository.clearApplyBlock?.({
      appId: input.body.appId,
      actorUserId: input.principal.userId,
      remediationSummary: input.body.remediationSummary,
      incidentId: input.body.incidentId
    });
    return result;
  }
}
