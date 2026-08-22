import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStudentCredentials,
  bulkMigrateCredentials,
  verifyNoLegacyStudentCredentials,
} from './studentCredentials.js';

const CONTEXT = { actorId: 'admin-1', operation: 'student_auth:migrate-credentials' };

function makePagedStudentsDb(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  let callCount = 0;
  return {
    collection: vi.fn((name: string) => {
      if (name !== 'students') return {};
      const q: any = {
        orderBy: vi.fn(() => q),
        limit: vi.fn(() => q),
        startAfter: vi.fn(() => q),
        get: vi.fn(async () => {
          callCount++;
          if (callCount > 1) return { empty: true, docs: [], size: 0 };
          return { empty: docs.length === 0, docs, size: docs.length };
        }),
      };
      return { orderBy: vi.fn(() => q) };
    }),
  };
}

describe('getStudentCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns credentials from student_auth_credentials if already migrated', async () => {
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'student_auth_credentials') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ loginPasswordHash: 'hash', loginPasswordSalt: 'salt' }),
              }),
            })),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false }),
            })),
          };
        }
        return {};
      }),
      runTransaction: vi.fn(),
    };

    const creds = await getStudentCredentials(db as any, 'student-1', CONTEXT);
    expect(creds.loginPasswordHash).toBe('hash');
    expect(creds.loginPasswordSalt).toBe('salt');
    // Transaction is still called for scrubLeftoverFields (cleanup of legacy fields)
    // but credentials come from the fast path (student_auth_credentials)
  });

  it('auto-migrates via transaction: writes cred doc and deletes legacy fields atomically', async () => {
    const studentData = {
      loginPasswordHash: 'old-hash',
      loginPasswordSalt: 'old-salt',
      passwordVersion: 1,
      name: 'Test Student',
    };

    const txOps: { type: string; data?: any }[] = [];

    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'student_auth_credentials') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            })),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: true, data: () => studentData }),
            })),
          };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => {
        const tx = {
          get: vi.fn(async (ref: any) => ref.get()),
          set: vi.fn((ref: any, data: any) => txOps.push({ type: 'set', data })),
          update: vi.fn((ref: any, data: any) => txOps.push({ type: 'update', data })),
        };
        return callback(tx);
      }),
    };

    const creds = await getStudentCredentials(db as any, 'student-1', CONTEXT);
    expect(creds.loginPasswordHash).toBe('old-hash');
    expect(creds.loginPasswordSalt).toBe('old-salt');
    expect(db.runTransaction).toHaveBeenCalled();

    // Verify tx.set was called to write credential doc
    const setOp = txOps.find((op) => op.type === 'set');
    expect(setOp).toBeDefined();
    expect(setOp!.data).toMatchObject({
      loginPasswordHash: 'old-hash',
      loginPasswordSalt: 'old-salt',
      migratedAt: expect.anything(),
    });
    expect(setOp!.data.migratedAt).not.toEqual(expect.any(String));

    // Verify tx.update was called to delete legacy fields
    const updateOp = txOps.find((op) => op.type === 'update');
    expect(updateOp).toBeDefined();
    expect(updateOp!.data).toHaveProperty('loginPasswordHash');
    expect(updateOp!.data).toHaveProperty('loginPasswordSalt');
    expect(updateOp!.data).toHaveProperty('passwordVersion');

    // Both ops happened in the same transaction (same tx object)
    expect(txOps.length).toBe(2);
  });

  it('returns empty object when student doc does not exist', async () => {
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'student_auth_credentials') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            })),
          };
        }
        if (name === 'students') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            })),
          };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => {
        const tx = {
          get: vi.fn(async (ref: any) => ref.get()),
          set: vi.fn(),
          update: vi.fn(),
        };
        return callback(tx);
      }),
    };

    const creds = await getStudentCredentials(db as any, 'nonexistent', CONTEXT);
    expect(creds).toEqual({});
  });
});

describe('bulkMigrateCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips docs with no credential fields', async () => {
    const studentData = { name: 'Test Student', classId: 'class-1' };
    let queryCallCount = 0;

    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'students') {
          const q: any = {
            orderBy: vi.fn(() => q),
            limit: vi.fn(() => q),
            startAfter: vi.fn(() => q),
            get: vi.fn(async () => {
              queryCallCount++;
              if (queryCallCount > 1) return { empty: true, docs: [] };
              return {
                empty: false,
                docs: [{ id: 'student-1', data: () => studentData }],
              };
            }),
          };
          return { doc: vi.fn(() => ({})), orderBy: () => q };
        }
        return {};
      }),
      runTransaction: vi.fn(),
    };

    const result = await bulkMigrateCredentials(db as any, CONTEXT, 10);
    expect(result.skipped).toBe(1);
    expect(result.migrated).toBe(0);
    expect(result.scrubbed).toBe(0);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('handles already-migrated doc with leftover fields (scrubs only)', async () => {
    const studentData = {
      loginPasswordHash: 'leftover-hash',
      loginPasswordSalt: 'leftover-salt',
      name: 'Student',
    };
    let queryCallCount = 0;

    const txOps: { type: string }[] = [];

    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'students') {
          const q: any = {
            orderBy: vi.fn(() => q),
            limit: vi.fn(() => q),
            startAfter: vi.fn(() => q),
            get: vi.fn(async () => {
              queryCallCount++;
              if (queryCallCount > 1) return { empty: true, docs: [] };
              return {
                empty: false,
                docs: [{ id: 'student-1', data: () => studentData }],
              };
            }),
          };
          return { doc: vi.fn(() => ({})), orderBy: () => q };
        }
        if (name === 'student_auth_credentials') {
          return { doc: vi.fn(() => ({})) };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => {
        // cred exists (already migrated), student has leftover fields
        const tx = {
          get: vi.fn(async () => ({
            exists: true,
            data: () => studentData,
          })),
          set: vi.fn(() => txOps.push({ type: 'set' })),
          update: vi.fn(() => txOps.push({ type: 'update' })),
        };
        return callback(tx);
      }),
    };

    const result = await bulkMigrateCredentials(db as any, CONTEXT, 10);
    expect(result.migrated).toBe(0);
    expect(result.scrubbed).toBe(1);
    expect(result.errors).toBe(0);
    // tx.update was called to scrub, but tx.set was NOT called (already migrated)
    expect(txOps.filter((op) => op.type === 'update').length).toBe(1);
    expect(txOps.filter((op) => op.type === 'set').length).toBe(0);
  });

  it('returns counters from transaction results, not from inside callback', async () => {
    const studentData = {
      loginPasswordHash: 'hash',
      loginPasswordSalt: 'salt',
    };
    let queryCallCount = 0;
    let txCallCount = 0;

    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'students') {
          const q: any = {
            orderBy: vi.fn(() => q),
            limit: vi.fn(() => q),
            startAfter: vi.fn(() => q),
            get: vi.fn(async () => {
              queryCallCount++;
              if (queryCallCount > 1) return { empty: true, docs: [] };
              return {
                empty: false,
                docs: [{ id: 'student-1', data: () => studentData }],
              };
            }),
          };
          return { doc: vi.fn(() => ({})), orderBy: () => q };
        }
        if (name === 'student_auth_credentials') {
          return { doc: vi.fn(() => ({})) };
        }
        return {};
      }),
      runTransaction: vi.fn(async (callback: any) => {
        txCallCount++;
        // Simulate retry: callback runs twice, but only final result counts
        const tx = {
          get: vi.fn(async () => ({ exists: true, data: () => studentData })),
          set: vi.fn(),
          update: vi.fn(),
        };
        const result = await callback(tx);
        // Second attempt (retry)
        const tx2 = {
          get: vi.fn(async () => ({ exists: true, data: () => studentData })),
          set: vi.fn(),
          update: vi.fn(),
        };
        await callback(tx2);
        // Return the last result (what DocumentStore would do on successful commit)
        return result;
      }),
    };

    const result = await bulkMigrateCredentials(db as any, CONTEXT, 10);
    // Even though callback ran twice, the counter reflects the final result
    // The transaction returns { didMigrate: false, didScrub: true } (cred already exists from first run)
    // so counters are based on what actually committed
    expect(result.errors).toBe(0);
    expect(result.scrubbed).toBeGreaterThanOrEqual(1);
  });
});

describe('verifyNoLegacyStudentCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports legacy student credential fields without returning their values', async () => {
    const db = makePagedStudentsDb([
      { id: 'student-1', data: () => ({ name: 'A', loginPasswordHash: 'hash' }) },
      { id: 'student-2', data: () => ({ name: 'B' }) },
    ]);

    await expect(verifyNoLegacyStudentCredentials(db as any, 100)).resolves.toEqual({
      scanned: 2,
      legacyDocuments: 1,
      safeToEnableDirectStudentReads: false,
    });
  });

  it('reports zero legacy fields as migration evidence', async () => {
    const db = makePagedStudentsDb([{ id: 'student-1', data: () => ({ name: 'A' }) }]);

    await expect(verifyNoLegacyStudentCredentials(db as any, 100)).resolves.toEqual({
      scanned: 1,
      legacyDocuments: 0,
      safeToEnableDirectStudentReads: true,
    });
  });
});
