import { describe, expect, it, vi } from 'vitest';

import type { ChangeValidationResponse } from '../../../../../packages/config-contracts/src/changeProtocol.js';
import {
  ConfigChangeService,
  type ConfigChangeRecord,
  type ConfigChangeRepository
} from './configChangeService.js';

const principal = {
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
  role: 'ops_viewer' as const,
  ipHash: `sha256:${'1'.repeat(64)}`,
  userAgentHash: `sha256:${'2'.repeat(64)}`
};
const digest = `hmac-sha256:v1:${'a'.repeat(64)}`;
const fingerprint = `hmac-sha256:v1:${'b'.repeat(64)}`;
const record: ConfigChangeRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  applicationId: 'edutrack',
  actorUserId: principal.userId,
  actorSessionId: principal.sessionId,
  state: 'DRAFT',
  reason: 'Rotate endpoint',
  changeDigest: null,
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  version: 0,
  expiresAt: '2026-09-01T00:00:00.000Z'
};

const body = {
  changeId: record.id,
  appId: 'edutrack',
  reason: 'Rotate endpoint',
  replaceDraft: true,
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  items: [
    {
      appId: 'edutrack',
      sourceId: 'edutrack.env',
      catalogId: 'edutrack.api_url',
      name: 'API_URL',
      operation: 'set' as const,
      requirement: 'required' as const,
      mutability: 'managed' as const,
      strategy: 'runtime_restart' as const,
      sourceFingerprint: fingerprint,
      value: 'https://sentinel.invalid'
    }
  ]
};

function validation(): ChangeValidationResponse {
  return {
    changeId: record.id,
    state: 'READY',
    changeDigest: digest,
    itemFingerprints: [
      {
        catalogId: 'edutrack.api_url',
        sourceId: 'edutrack.env',
        oldValueFingerprint: fingerprint,
        newValueFingerprint: fingerprint
      }
    ],
    impactPlan: {
      applicationId: 'edutrack',
      strategies: ['runtime_restart'],
      sourceIds: ['edutrack.env'],
      actionIds: ['pm2.reload_app'],
      checkIds: ['process.active'],
      counts: { items: 1, sets: 1, deletes: 0, sources: 1 },
      warnings: [],
      expectedEffect: 'runtime_restart'
    },
    ruleIds: [],
    warnings: []
  };
}

function serviceFor(overrides: Partial<ConfigChangeRepository> = {}) {
  const repository: ConfigChangeRepository = {
    createChange: vi.fn(async () => undefined),
    findById: vi.fn(async () => record),
    replaceItems: vi.fn(async () => undefined),
    updateValidation: vi.fn(async () => undefined),
    markSaved: vi.fn(async () => undefined),
    transition: vi.fn(),
    ...overrides
  };
  const agent = {
    validateChange: vi.fn(async () => validation()),
    saveChange: vi.fn(async () => ({
      changeId: record.id,
      state: 'SAVED' as const,
      changeDigest: digest,
      expiresAt: record.expiresAt
    })),
    applyChange: vi.fn(async () => ({
      changeId: record.id,
      runId: 'RUN_1',
      state: 'APPLYING' as const
    })),
    cancelChange: vi.fn(),
    getChangeStatus: vi.fn(),
    clearApplyBlock: vi.fn()
  };
  const service = new ConfigChangeService({
    repository,
    agent,
    catalogVersion: '2026-08-31',
    manifestVersion: '2026-08-31',
    draftEnabled: true,
    runtimeApplyEnabled: true
  });
  return { service, repository, agent };
}

describe('ConfigChangeService', () => {
  it('forwards the value only to the agent and persists value-free metadata', async () => {
    const value = serviceFor();
    await value.service.validate({ principal, body });
    expect(value.agent.validateChange).toHaveBeenCalledWith(
      expect.objectContaining({ userId: principal.userId }),
      body
    );
    const persisted = (value.repository.updateValidation as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(persisted).toEqual(
      expect.objectContaining({ changeId: record.id, changeDigest: digest })
    );
    expect(JSON.stringify(persisted)).not.toContain('sentinel.invalid');
  });

  it('binds save/apply to the creating session and current digest', async () => {
    const value = serviceFor({
      findById: vi.fn(async () => ({ ...record, state: 'READY' as const, changeDigest: digest }))
    });
    await expect(
      value.service.save({
        principal: { ...principal, sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f8' },
        body: {
          changeId: record.id,
          changeDigest: digest,
          catalogVersion: '2026-08-31',
          manifestVersion: '2026-08-31'
        }
      })
    ).rejects.toMatchObject({ code: 'CONFIG_CHANGE_INVALID_STATE' });
    expect(value.agent.saveChange).not.toHaveBeenCalled();

    const applying = serviceFor({
      findById: vi.fn(async () => ({ ...record, state: 'SAVED' as const, changeDigest: digest }))
    });
    await expect(
      applying.service.apply({
        principal: { ...principal, sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f8' },
        body: { changeId: record.id, runId: 'RUN_1', changeDigest: digest, idempotencyKey: 'EVT_1' }
      })
    ).rejects.toMatchObject({ code: 'CONFIG_CHANGE_INVALID_STATE' });
    expect(applying.agent.applyChange).not.toHaveBeenCalled();
  });

  it('transitions the database before dispatch and persists cancellation', async () => {
    const applying = serviceFor({
      findById: vi.fn(async () => ({ ...record, state: 'SAVED' as const, changeDigest: digest })),
      transition: vi.fn(async () => undefined)
    });
    await applying.service.apply({
      principal,
      body: { changeId: record.id, runId: 'RUN_1', changeDigest: digest, idempotencyKey: 'EVT_1' }
    });
    expect(applying.repository.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        changeId: record.id,
        applicationId: record.applicationId,
        to: 'APPLYING'
      })
    );
    expect(applying.agent.applyChange).toHaveBeenCalled();

    const cancelled = serviceFor({
      findById: vi.fn(async () => record),
      cancel: vi.fn(async () => undefined)
    });
    await cancelled.service.cancel({ principal, body: { changeId: record.id, eventId: 'EVT_1' } });
    expect(cancelled.repository.cancel).toHaveBeenCalledWith({
      changeId: record.id,
      actorUserId: principal.userId,
      actorSessionId: principal.sessionId
    });
  });
});
