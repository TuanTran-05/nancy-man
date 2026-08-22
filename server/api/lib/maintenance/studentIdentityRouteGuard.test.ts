import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guardStudentIdentityRouteMutation } from './studentIdentityRouteGuard.js';
import { resetStudentIdentityMaintenanceCacheForTests } from './studentIdentityMaintenance.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

function maintenance(mode: 'normal' | 'read_only') {
  return {
    '_maintenance/student_identity': {
      mode,
      activeRunId: mode === 'read_only' ? 'run-1' : null,
      migrationActorId: mode === 'read_only' ? 'migration' : null,
      updatedAt: '2026-08-09T09:00:00.000Z',
      updatedBy: 'operator',
    },
  };
}

function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function request(overrides: Record<string, unknown> = {}) {
  return { method: 'POST', headers: {}, body: {}, query: {}, ...overrides } as never;
}

describe('guardStudentIdentityRouteMutation', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  it('lets a guarded mutation through while maintenance is normal', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('normal'));
    const res = response();

    const blocked = await guardStudentIdentityRouteMutation(() => db, res as never, {
      surface: 'students',
      action: 'create',
      req: request(),
    });

    expect(blocked).toBe(false);
    expect(res.statusCode).toBe(0);
  });

  it('rejects a guarded mutation with 503 before the handler runs', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('read_only'));
    const res = response();

    const blocked = await guardStudentIdentityRouteMutation(() => db, res as never, {
      surface: 'students',
      action: 'create',
      req: request(),
    });

    expect(blocked).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: 'STUDENT_IDENTITY_MAINTENANCE' });
  });

  it('fails closed for a newly registered write without an inventory decision', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('normal'));
    const res = response();
    const blocked = await guardStudentIdentityRouteMutation(() => db, res as never, {
      surface: 'finance',
      resource: 'receipts',
      action: 'future-write',
      req: request({ method: 'POST' }),
    });

    expect(blocked).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      code: 'STUDENT_IDENTITY_MUTATION_UNCLASSIFIED',
    });
  });

  it('leaves reads alone during the window', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('read_only'));
    const res = response();

    const blocked = await guardStudentIdentityRouteMutation(() => db, res as never, {
      surface: 'students',
      action: 'evaluation-insights',
      req: request({ method: 'GET' }),
    });

    expect(blocked).toBe(false);
  });

  it('cannot be bypassed by anything a client sends', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('read_only'));

    for (const forged of [
      request({ headers: { 'x-migration-run-id': 'run-1', 'x-actor-id': 'migration' } }),
      request({ body: { migrationRunId: 'run-1', actorId: 'migration' } }),
      request({ query: { migrationRunId: 'run-1', actorId: 'migration' } }),
    ]) {
      const res = response();
      const blocked = await guardStudentIdentityRouteMutation(() => db, res as never, {
        surface: 'students',
        action: 'create',
        req: forged,
      });
      expect(blocked).toBe(true);
      expect(res.statusCode).toBe(503);
    }
  });

  it('names the surface and action so an operator can see what was refused', async () => {
    const { db } = createInMemoryDocumentStore(maintenance('read_only'));
    const res = response();

    await guardStudentIdentityRouteMutation(() => db, res as never, {
      surface: 'finance',
      action: 'receipts',
      req: request(),
    });

    expect(String((res.body as { error?: string }).error)).toContain('finance:receipts');
  });

  it('fails closed when the control document cannot be read', async () => {
    const db = {
      doc: vi.fn(() => ({ get: vi.fn().mockRejectedValue(new Error('unavailable')) })),
    } as never;
    const res = response();
    vi.stubEnv('STUDENT_IDENTITY_MAINTENANCE_REQUIRED', 'true');

    const blocked = await guardStudentIdentityRouteMutation(() => db, res as never, {
      surface: 'students',
      action: 'create',
      req: request(),
    });

    expect(blocked).toBe(true);
    expect(res.statusCode).toBe(503);
    vi.unstubAllEnvs();
  });

  it('fails closed exactly once when a guard dependency throws', async () => {
    const res = response();
    const status = vi.spyOn(res, 'status');
    const json = vi.spyOn(res, 'json');

    const blocked = await guardStudentIdentityRouteMutation(
      () => {
        throw new Error('database initialization failed');
      },
      res as never,
      {
        surface: 'students',
        action: 'create',
        req: request(),
      }
    );

    expect(blocked).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'STUDENT_IDENTITY_MAINTENANCE_CHECK_FAILED',
    });
    expect(status).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
  });
});
