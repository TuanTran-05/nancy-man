import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  writeAuditLog,
  writeCriticalAuditLog,
  writeRequiredAuditLog,
  writeOptionalAuditLog,
  getClientIp,
} from './auditLog.js';

describe('writeAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes undefined fields before writing to DocumentStore', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const db = {
      collection: vi.fn(() => ({ add })),
    };

    await writeAuditLog(db as any, {
      userId: 'uid-1',
      userRole: 'accounting',
      userName: undefined,
      action: 'create',
      collection: 'classes',
      documentId: 'course_fee_ledgers',
      changes: undefined,
      metadata: {
        classIds: undefined,
        createdCount: 2,
        nested: { before: undefined, after: 'ok' },
      },
    });

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'uid-1',
        userRole: 'accounting',
        action: 'create',
        collection: 'classes',
        documentId: 'course_fee_ledgers',
        metadata: {
          createdCount: 2,
          nested: { after: 'ok' },
        },
      })
    );

    const written = add.mock.calls[0][0];
    expect(written).not.toHaveProperty('changes');
    expect(written).not.toHaveProperty('userName');
    expect(written.metadata).not.toHaveProperty('classIds');
    expect(written).toHaveProperty('timestamp');
  });

  it('returns false on DocumentStore audit write failures without throwing', async () => {
    const error = new Error('DocumentStore quota exceeded');
    const add = vi.fn().mockRejectedValue(error);
    const db = {
      collection: vi.fn(() => ({ add })),
    };

    const result = await writeAuditLog(db as any, {
      userId: 'uid-1',
      userRole: 'accounting',
      action: 'create',
      collection: 'receipts',
      documentId: 'receipt-1',
      metadata: {
        studentName: 'Sensitive Student Name',
      },
    });

    expect(result).toBe(false);
  });

  it('throws when a critical audit log cannot be written', async () => {
    const db = {
      collection: vi.fn(() => ({ add: vi.fn().mockRejectedValue(new Error('quota')) })),
    };

    await expect(
      writeCriticalAuditLog(db as any, {
        userId: 'accounting-uid',
        userRole: 'accounting',
        action: 'update',
        collection: 'receipts',
        documentId: 'receipt-1',
      })
    ).rejects.toThrow('Critical audit log failed for receipts/receipt-1');
  });

  it('throws when a required audit log cannot be written', async () => {
    const db = {
      collection: vi.fn(() => ({ add: vi.fn().mockRejectedValue(new Error('quota')) })),
    };

    await expect(
      writeRequiredAuditLog(db as any, {
        userId: 'payos',
        userRole: 'system',
        action: 'update',
        collection: 'payment_requests',
        documentId: 'payment-1',
      })
    ).rejects.toMatchObject({ code: 'critical_audit_failed', statusCode: 503 });
  });

  it('does not silently swallow failures in critical auth and payment handlers', () => {
    const criticalHandlerFiles = [
      'server/api/auth/handlers/studentAuth.ts',
      'server/api/auth/handlers/passwordManagement.ts',
      'server/api/auth/handlers/staffAuth.ts',
      'server/api/auth/handlers/staffAccountManagement.ts',
      'server/api/finance/handlers/expenses.ts',
      'server/api/finance/handlers/receipts.ts',
      'server/api/finance/handlers/invoices.ts',
      'server/api/payments/payos/handlers/create.ts',
      'server/api/payments/payos/handlers/shared.ts',
      'server/api/payments/payos/handlers/webhook.ts',
      'server/api/payments/payos/handlers/resolveReview.ts',
      'server/api/zalo/route.ts',
      'server/api/knowledge-bank/route.ts',
    ];

    for (const file of criticalHandlerFiles) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('.catch(() => {})');
    }
  });
  it('writeOptionalAuditLog defers audit writes without throwing to the caller', async () => {
    vi.useFakeTimers();
    const add = vi.fn().mockRejectedValue(new Error('documentStore unavailable'));
    const db = {
      collection: vi.fn(() => ({ add })),
    };

    expect(() =>
      writeOptionalAuditLog(db as any, {
        userId: 'u1',
        userRole: 'admin',
        action: 'update',
        collection: 'students',
        documentId: 'student-1',
      })
    ).not.toThrow();

    expect(add).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe('getClientIp', () => {
  it('extracts the first forwarded IP when duplicate headers arrive as an array', () => {
    expect(
      getClientIp({
        headers: {
          'x-forwarded-for': ['203.0.113.7, 10.0.0.1', '198.51.100.9'],
        },
        socket: { remoteAddress: '127.0.0.1' },
      })
    ).toBe('203.0.113.7');
  });
});
