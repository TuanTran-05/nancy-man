import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import {
  makeAdminReadAuditDocId,
  recordAdminDataReadAudit,
  type AdminReadAuditParams,
} from './adminReadAuditRepository.js';

describe('adminReadAuditRepository', () => {
  const options = { hmacSecret: 'test-admin-audit-secret-at-least-16-chars' };
  it('records started and completed audit entries idempotently and without PII', async () => {
    const { db } = createInMemoryDocumentStore({
      audit_logs: {},
    });

    const startParams: AdminReadAuditParams = {
      actorUid: 'admin_123',
      actorRole: 'admin',
      messageId: 'msg_999',
      accessStage: 'started',
      queryKind: 'student_tuition',
      sensitivityTier: 'high',
      canonicalIds: ['student_canonical_abc'],
      period: '2026-08',
    };

    await recordAdminDataReadAudit(db as any, startParams, options);

    const docId = makeAdminReadAuditDocId('msg_999', 'started', 'student_tuition');
    const snap = await (db as any).collection('audit_logs').doc(docId).get();
    expect(snap.exists).toBe(true);

    const data = snap.data();
    expect(data.action).toBe('admin_data_read');
    expect(data.userId).toBe('admin_123');
    expect(data.metadata.queryKind).toBe('student_tuition');
    expect(data.metadata.accessStage).toBe('started');
    expect(data.metadata.canonicalIds).toEqual(['student_canonical_abc']);
    expect(data.metadata.fingerprint).toBeDefined();

    // Idempotent retry with exact same params succeeds without error
    await expect(
      recordAdminDataReadAudit(db as any, startParams, options)
    ).resolves.toBeUndefined();

    // Now record completed audit
    const completeParams: AdminReadAuditParams = {
      ...startParams,
      accessStage: 'completed',
      resultCount: 1,
    };
    await recordAdminDataReadAudit(db as any, completeParams, options);

    const completeDocId = makeAdminReadAuditDocId('msg_999', 'completed', 'student_tuition');
    const completeSnap = await (db as any).collection('audit_logs').doc(completeDocId).get();
    expect(completeSnap.exists).toBe(true);
    expect(completeSnap.data().metadata.resultCount).toBe(1);
  });

  it('fails closed when conflicting fingerprint is detected for the same key', async () => {
    const { db } = createInMemoryDocumentStore({
      audit_logs: {},
    });

    const initialParams: AdminReadAuditParams = {
      actorUid: 'admin_123',
      actorRole: 'admin',
      messageId: 'msg_999',
      accessStage: 'started',
      queryKind: 'student_phone',
      sensitivityTier: 'critical_pii',
      canonicalIds: ['student_1'],
    };

    await recordAdminDataReadAudit(db as any, initialParams, options);

    // Same docId, but different actor (collision / forgery attempt)
    const conflictingParams: AdminReadAuditParams = {
      ...initialParams,
      actorUid: 'admin_attacker',
    };

    await expect(
      recordAdminDataReadAudit(db as any, conflictingParams, options)
    ).rejects.toMatchObject({
      code: 'audit_failed',
    });
  });

  it('fails closed with code audit_failed when documentStore throws', async () => {
    const brokenDb = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('Database down');
          },
        }),
      }),
    };

    const params: AdminReadAuditParams = {
      actorUid: 'admin_123',
      actorRole: 'admin',
      messageId: 'msg_1',
      accessStage: 'started',
      queryKind: 'center_finance',
      sensitivityTier: 'medium',
    };

    await expect(recordAdminDataReadAudit(brokenDb as any, params, options)).rejects.toMatchObject({
      code: 'audit_failed',
    });
  });
});
