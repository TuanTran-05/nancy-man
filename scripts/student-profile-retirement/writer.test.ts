import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  applyLegacyStudentRetirementOperation,
  operationId,
} from './writer.js';
import { LEGACY_PROJECTION_FIELDS } from './types.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../../server/api/lib/maintenance/studentIdentityMaintenance.js';
import { createInMemoryDocumentStore } from '../../test-utils/inMemoryDocumentStore.js';

const NOW = new Date('2026-09-15T10:00:00.000Z');

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const TOMBSTONE = {
  studentProfileState: 'merged_tombstone',
  canonicalProfileId: 'canonical-1',
  mergeRunId: 'run-0',
  mergedAt: '2026-08-01T00:00:00.000Z',
  identityWriteDisabled: true,
  authDisabled: true,
  walletOwnership: 'canonicalized',
  tombstoneSourceFingerprint: 'b'.repeat(64),
};

function seed(mode: 'read_only' | 'normal' = 'read_only', extra: Record<string, unknown> = {}) {
  return {
    '_maintenance/student_identity': {
      mode,
      activeRunId: mode === 'read_only' ? 'ret-1' : null,
      migrationActorId: mode === 'read_only' ? 'migration' : null,
      updatedAt: 't',
      updatedBy: 'operator',
    },
    'students/legacy-1': TOMBSTONE,
    ...extra,
  };
}

const DELETE_OP = {
  kind: 'delete_profile_tombstone' as const,
  documentId: 'legacy-1',
  beforeFingerprint: fingerprint(TOMBSTONE),
};

function apply(db: never, operation: unknown) {
  return applyLegacyStudentRetirementOperation(db, {
    operation: operation as never,
    runId: 'ret-1',
    actorId: 'migration',
    reviewedPlan: {
      planDigest: 'p',
      approvalDigest: 'a',
      auditPhase: 'final',
      approvals: { identity_technical: 'x', finance: 'y' },
      // The manifest names what it approved; the writer refuses anything else.
      operationIds: [operationId(operation as never)],
    },
    now: NOW,
  });
}

describe('applyLegacyStudentRetirementOperation', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  it('deletes the tombstone and journals the operation', async () => {
    const { db, store } = createInMemoryDocumentStore(seed());

    const outcome = await apply(db as never, DELETE_OP);

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(store.has('students/legacy-1')).toBe(false);
    expect(
      store.get(`student_profile_merge_journal/ret-1__${operationId(DELETE_OP)}`)?.status
    ).toBe('applied');
  });

  it('is a no-op on the second pass, which is the whole resume path', async () => {
    // Re-running the same plan skips what is already gone and re-checks what
    // is not. There is no separate resume path to get wrong.
    const { db } = createInMemoryDocumentStore(seed());

    await apply(db as never, DELETE_OP);
    const second = await apply(db as never, DELETE_OP);

    expect(second.status).toBe('already_applied');
  });

  it('refuses a document that changed after the plan was reviewed', async () => {
    // Changed means it is not the document that was approved, and deleting it
    // would be deleting something nobody looked at.
    const { db, store } = createInMemoryDocumentStore(
      seed('read_only', { 'students/legacy-1': { ...TOMBSTONE, mergeRunId: 'run-9' } })
    );

    const outcome = await apply(db as never, DELETE_OP);

    expect(outcome).toMatchObject({ code: 'STUDENT_RETIREMENT_SOURCE_DRIFT' });
    expect(store.has('students/legacy-1')).toBe(true);
  });

  it('refuses once the maintenance window has closed', async () => {
    // A window that closed mid-run stops the next operation rather than the
    // next run, which is what makes an interrupt survivable.
    const { db, store } = createInMemoryDocumentStore(seed('normal'));

    await expect(apply(db as never, DELETE_OP)).rejects.toThrow(
      'STUDENT_RETIREMENT_MAINTENANCE_NOT_HELD'
    );
    expect(store.has('students/legacy-1')).toBe(true);
  });

  it('refuses an actor who does not hold the window', async () => {
    const { db } = createInMemoryDocumentStore(seed());

    await expect(
      applyLegacyStudentRetirementOperation(db, {
        operation: DELETE_OP,
        runId: 'ret-1',
        actorId: 'someone-else',
        reviewedPlan: {
          planDigest: 'p',
          approvalDigest: 'a',
          auditPhase: 'final',
          approvals: { identity_technical: 'x', finance: 'y' },
          operationIds: [operationId(DELETE_OP as never)],
        },
        now: NOW,
      })
    ).rejects.toThrow('STUDENT_RETIREMENT_RUN_OR_ACTOR_MISMATCH');
  });

  it('removes the legacy fields without touching anything else', async () => {
    const profile = { name: 'A', classId: 'class-g7', teacherId: 't-1', enrollmentStatus: 'active' };
    const { db, store } = createInMemoryDocumentStore({
      ...seed(),
      'students/canonical-1': profile,
    });

    await apply(db as never, {
      kind: 'remove_legacy_profile_projection_fields',
      canonicalProfileId: 'canonical-1',
      fields: LEGACY_PROJECTION_FIELDS,
      beforeFingerprint: fingerprint(profile),
    });

    const after = store.get('students/canonical-1') || {};
    expect(after.name).toBe('A');
    for (const field of LEGACY_PROJECTION_FIELDS) {
      expect(after[field]).toBeUndefined();
    }
  });

  it('removes the linked-account field that fails silently', async () => {
    const user = { uid: 'student:canonical-1', studentId: 'canonical-1', classId: 'class-g7' };
    const { db, store } = createInMemoryDocumentStore({ ...seed(), 'users/student:canonical-1': user });

    await apply(db as never, {
      kind: 'remove_legacy_linked_user_projection_fields',
      userDocumentId: 'student:canonical-1',
      fields: LEGACY_PROJECTION_FIELDS,
      beforeFingerprint: fingerprint(user),
    });

    expect(store.get('users/student:canonical-1')?.classId).toBeUndefined();
    expect(store.get('users/student:canonical-1')?.studentId).toBe('canonical-1');
  });

  it('detects credential drift by field names, never by value', async () => {
    // The plan never carried the values, so drift is caught without a secret
    // ever leaving the database.
    const credential = { loginPasswordHash: 'x', loginPasswordSalt: 'y' };
    const { db } = createInMemoryDocumentStore({
      ...seed(),
      'student_auth_credentials/legacy-1': { ...credential, passwordVersion: 2 },
    });

    const outcome = await apply(db as never, {
      kind: 'delete_credential_tombstone',
      documentId: 'legacy-1',
      nonSecretFingerprint: fingerprint(Object.keys(credential).sort()),
    });

    expect(outcome).toMatchObject({ code: 'STUDENT_RETIREMENT_SOURCE_DRIFT' });
  });

  it('writes the irreversible boundary before deleting a credential', async () => {
    const credential = { loginPasswordHash: 'x', loginPasswordSalt: 'y', passwordVersion: 1 };
    const { db, store } = createInMemoryDocumentStore({
      ...seed(),
      'student_auth_credentials/legacy-1': credential,
    });

    const outcome = await apply(db as never, {
      kind: 'delete_credential_tombstone',
      documentId: 'legacy-1',
      nonSecretFingerprint: fingerprint(Object.keys(credential).sort()),
    });

    expect(outcome.status).toBe('applied');
    expect(store.has('student_auth_credentials/legacy-1')).toBe(false);
    expect(store.has('student_profile_retirement_irreversible_boundaries/ret-1')).toBe(true);
  });

  it('records an already-absent document without claiming a deletion', async () => {
    const { db, store } = createInMemoryDocumentStore(seed('read_only', {}));
    store.delete('students/legacy-1');

    const outcome = await apply(db as never, DELETE_OP);

    expect(outcome.status).toBe('already_applied');
    expect(
      store.get(`student_profile_merge_journal/ret-1__${operationId(DELETE_OP)}`)?.status
    ).toBe('already_absent');
  });
});

describe('applyLegacyStudentRetirementOperation binds to the reviewed plan', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  function applyWith(db: never, operation: unknown, reviewed: Record<string, unknown>) {
    return applyLegacyStudentRetirementOperation(db, {
      operation: operation as never,
      runId: 'ret-1',
      actorId: 'migration',
      reviewedPlan: reviewed as never,
      now: NOW,
    });
  }

  const REVIEWED = {
    planDigest: 'p',
    approvalDigest: 'a',
    auditPhase: 'final',
    approvals: { identity_technical: 'x', finance: 'y' },
    operationIds: [operationId(DELETE_OP as never)],
  };

  it('refuses an operation nobody reviewed', async () => {
    // Deleting real data is irreversible, so the authority to do it has to
    // come from the reviewed manifest rather than from the command line.
    const { db } = createInMemoryDocumentStore(seed());

    await expect(
      applyWith(db as never, DELETE_OP, { ...REVIEWED, operationIds: ['some-other-operation'] })
    ).rejects.toThrow('STUDENT_RETIREMENT_OPERATION_NOT_REVIEWED');
  });

  it('refuses a plan that names no reviewed operations at all', async () => {
    const { db } = createInMemoryDocumentStore(seed());

    await expect(
      applyWith(db as never, DELETE_OP, { ...REVIEWED, operationIds: [] })
    ).rejects.toThrow('STUDENT_RETIREMENT_OPERATION_NOT_REVIEWED');
  });

  it('applies an operation the manifest actually names', async () => {
    const { db } = createInMemoryDocumentStore(seed());

    const outcome = await applyWith(db as never, DELETE_OP, REVIEWED);
    expect(outcome.status).toBe('applied');
  });

  it('does not treat a journal from another reviewed plan as already applied', async () => {
    const id = operationId(DELETE_OP as never);
    const { db } = createInMemoryDocumentStore(
      seed('read_only', {
        [`student_profile_merge_journal/ret-1__${id}`]: {
          runId: 'ret-1',
          operationId: id,
          status: 'applied',
          appliedAt: '2026-09-01T00:00:00.000Z',
          actorId: 'migration',
          planDigest: 'a-different-plan',
          approvalDigest: 'a-different-approval',
        },
      })
    );

    await expect(applyWith(db as never, DELETE_OP, REVIEWED)).rejects.toThrow(
      'STUDENT_RETIREMENT_JOURNAL_PLAN_MISMATCH'
    );
  });
});
