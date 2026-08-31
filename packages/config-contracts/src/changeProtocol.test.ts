import { describe, expect, it } from 'vitest';

import {
  ChangeApplyRequestSchema,
  ChangeItemSchema,
  ChangeStatusEventSchema,
  ChangeValidateRequestSchema,
  ClearApplyBlockRequestSchema
} from './changeProtocol.js';

const fingerprint = `hmac-sha256:v1:${'a'.repeat(64)}`;
const baseItem = {
  appId: 'ops',
  sourceId: 'ops.api_env',
  catalogId: 'ops.api.port',
  name: 'OPS_API_PORT',
  operation: 'set' as const,
  requirement: 'optional' as const,
  mutability: 'managed' as const,
  strategy: 'runtime_restart' as const,
  sourceFingerprint: fingerprint
};

describe('change protocol contracts', () => {
  it('requires a value for set and forbids one for delete', () => {
    expect(ChangeItemSchema.safeParse(baseItem).success).toBe(false);
    expect(ChangeItemSchema.safeParse({ ...baseItem, value: '8080' }).success).toBe(true);
    expect(
      ChangeItemSchema.safeParse({ ...baseItem, operation: 'delete', value: '8080' }).success
    ).toBe(false);
    expect(
      ChangeItemSchema.safeParse({ ...baseItem, operation: 'delete', value: undefined }).success
    ).toBe(true);
  });

  it('rejects unknown/observed definitions, duplicate items, and mixed applications', () => {
    const item = { ...baseItem, value: '8080' };
    expect(ChangeItemSchema.safeParse({ ...item, requirement: 'unknown' }).success).toBe(false);
    expect(ChangeItemSchema.safeParse({ ...item, mutability: 'observed' }).success).toBe(false);
    const result = ChangeValidateRequestSchema.safeParse({
      changeId: 'CHG_test',
      appId: 'ops',
      reason: 'rotate port',
      catalogVersion: '2026-08-31',
      manifestVersion: '2026-08-31',
      items: [item, item]
    });
    expect(result.success).toBe(false);
    expect(
      ChangeValidateRequestSchema.safeParse({
        changeId: 'CHG_test',
        appId: 'ops',
        reason: 'mixed',
        catalogVersion: '2026-08-31',
        manifestVersion: '2026-08-31',
        items: [item, { ...item, appId: 'edutrack', catalogId: 'edutrack.port' }]
      }).success
    ).toBe(false);
  });

  it('keeps apply/status and block contracts value-free', () => {
    expect(
      ChangeApplyRequestSchema.safeParse({
        changeId: 'CHG_test',
        runId: 'RUN_test',
        changeDigest: fingerprint,
        idempotencyKey: 'EVT_apply'
      }).success
    ).toBe(true);
    expect(
      ClearApplyBlockRequestSchema.safeParse({
        appId: 'ops',
        confirmationAppId: 'edutrack',
        remediationSummary: 'remediated',
        incidentId: 'incident_1',
        eventId: 'EVT_clear'
      }).success
    ).toBe(false);
    expect(
      ChangeStatusEventSchema.safeParse({
        eventId: 'EVT_status',
        changeId: 'CHG_test',
        sequence: 1,
        state: 'READY',
        reasonCode: 'validated',
        occurredAt: new Date().toISOString(),
        value: 'secret'
      }).success
    ).toBe(false);
  });
});
