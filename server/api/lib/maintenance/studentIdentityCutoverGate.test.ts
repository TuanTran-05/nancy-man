import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertStudentIdentityCutoverCanExit,
  recordStudentIdentityDrainEvidence,
  transitionStudentIdentityMaintenance,
} from './studentIdentityCutoverGate.js';
import { resetStudentIdentityMaintenanceCacheForTests } from './studentIdentityMaintenance.js';
import { resetCanonicalStudentReadControlCacheForTests } from '../student/canonicalStudentReadControl.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

const NOW = new Date('2026-08-09T10:00:00.000Z');
const PLAN = 'p'.repeat(64);
const APPROVAL = 'q'.repeat(64);
const HEALTH_DIGEST = 'h'.repeat(64);

type Seed = Record<string, Record<string, unknown>>;

function maintenance(mode: 'normal' | 'read_only', runId = 'run-1'): Seed {
  return {
    '_maintenance/student_identity': {
      mode,
      activeRunId: mode === 'read_only' ? runId : null,
      migrationActorId: mode === 'read_only' ? 'migration' : null,
      updatedAt: '2026-08-09T09:00:00.000Z',
      updatedBy: 'operator',
    },
  };
}

function run(overrides: Record<string, unknown> = {}): Seed {
  return {
    'student_profile_merge_runs/run-1': {
      runId: 'run-1',
      status: 'applied',
      planDigest: PLAN,
      approvalDigest: APPROVAL,
      sourceCommitSha: 'abc1234',
      exportOperationId: 'export-1',
      appliedOperationCount: 12,
      pendingOperationCount: 0,
      failedOperationCount: 0,
      plannedOperationCount: 12,
      verifiedOperationCount: 12,
      ...overrides,
    },
  };
}

function health(overrides: Record<string, unknown> = {}): Seed {
  return {
    'student_identity_health_runs/audit-1': {
      auditId: 'audit-1',
      runId: 'run-1',
      status: 'green',
      digest: HEALTH_DIGEST,
      canonicalReadMode: 'canonical_required',
      startedAt: '2026-08-09T09:30:00.000Z',
      counts: { legacyProjectionFieldsRemaining: 0 },
      // A green audit carries the invariants that made it green. The gate
      // re-reads them rather than trusting the verdict, so the fixture has to
      // be as complete as a real report.
      invariants: {
        aliasesOneHopAndAcyclic: true,
        monetaryTotalsMatchReviewedPlan: true,
        projectionRebuildComplete: true,
        authenticationPathsCanonical: true,
      },
      blockers: [],
      ...overrides,
    },
  };
}

function smoke(overrides: Record<string, unknown> = {}): Seed {
  return {
    'student_identity_smoke_runs/smoke-1': {
      smokeId: 'smoke-1',
      runId: 'run-1',
      status: 'green',
      startedAt: '2026-08-09T09:45:00.000Z',
      passedSurfacesCount: 10,
      mutationProbesBlocked: true,
      bindings: {
        runId: 'run-1',
        planDigest: PLAN,
        approvalDigest: APPROVAL,
        sourceCommitSha: 'abc1234',
        exportOperationId: 'export-1',
        projectionRebuildEvidenceId: 'rebuild-1',
      },
      ...overrides,
    },
  };
}

function drain(overrides: Record<string, unknown> = {}): Seed {
  return {
    'student_identity_drain_evidence/run-1': {
      runId: 'run-1',
      observedAt: '2026-08-09T09:20:00.000Z',
      recordedBy: 'migration',
      queueCounts: {
        outboxJobs: 0,
        accountingFinanceOutbox: 0,
        receiptNotificationOutbox: 0,
        zaloBulkJobs: 0,
        payosProcessors: 0,
        passwordResetWork: 0,
      },
      activeLeases: 0,
      staleLeases: 0,
      planDigest: PLAN,
      approvalDigest: APPROVAL,
      ...overrides,
    },
  };
}

function cutoverSeed(overrides: Seed = {}): Seed {
  return {
    ...maintenance('read_only'),
    ...run(),
    ...health(),
    ...smoke(),
    ...drain(),
    '_maintenance/student_identity_read_model': {
      schemaVersion: 1,
      mode: 'canonical_required',
      generation: 1,
    },
    'student_identity_projection_rebuilds/rebuild-1': {
      status: 'valid',
      missingCount: 0,
      staleCount: 0,
    },
    ...overrides,
  };
}

const CUTOVER_EXIT = {
  action: 'exit' as const,
  runId: 'run-1',
  actorId: 'migration',
  reason: 'verified_cutover' as const,
  expectedGeneration: 0,
  healthAuditId: 'audit-1',
  healthDigest: HEALTH_DIGEST,
  smokeEvidenceId: 'smoke-1',
  projectionRebuildEvidenceId: 'rebuild-1',
};

describe('entering the maintenance window', () => {
  beforeEach(() => {
    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('holds the window against the run whose artifacts were named', async () => {
    const { db, store } = createInMemoryDocumentStore({ ...maintenance('normal'), ...run() });

    const state = await transitionStudentIdentityMaintenance(
      db,
      {
        action: 'enter',
        runId: 'run-1',
        actorId: 'migration',
        expectedMode: 'normal',
        expectedGeneration: 0,
        planDigest: PLAN,
        approvalDigest: APPROVAL,
        sourceCommitSha: 'abc1234',
        exportOperationId: 'export-1',
      },
      NOW
    );

    expect(state.mode).toBe('read_only');
    expect(store.get('_maintenance/student_identity')?.activeRunId).toBe('run-1');
  });

  it('refuses when the window is not in the mode the operator believed', async () => {
    // Compare-and-set. Two operators entering at once must not both believe
    // they own the window.
    const { db } = createInMemoryDocumentStore({ ...maintenance('read_only'), ...run() });

    await expect(
      transitionStudentIdentityMaintenance(db, {
        action: 'enter',
        runId: 'run-1',
        actorId: 'migration',
        expectedMode: 'normal',
        expectedGeneration: 0,
        planDigest: PLAN,
        approvalDigest: APPROVAL,
        sourceCommitSha: 'abc1234',
        exportOperationId: 'export-1',
      })
    ).rejects.toThrow('STUDENT_IDENTITY_UNEXPECTED_MODE');
  });

  it('refuses a plan, approval, commit, or export the run does not carry', async () => {
    const { db } = createInMemoryDocumentStore({ ...maintenance('normal'), ...run() });
    const base = {
      action: 'enter' as const,
      runId: 'run-1',
      actorId: 'migration',
      expectedMode: 'normal' as const,
      expectedGeneration: 0,
      planDigest: PLAN,
      approvalDigest: APPROVAL,
      sourceCommitSha: 'abc1234',
      exportOperationId: 'export-1',
    };

    await expect(
      transitionStudentIdentityMaintenance(db, { ...base, planDigest: 'z'.repeat(64) })
    ).rejects.toThrow('STUDENT_IDENTITY_PLAN_DIGEST_MISMATCH');
    await expect(
      transitionStudentIdentityMaintenance(db, { ...base, approvalDigest: 'z'.repeat(64) })
    ).rejects.toThrow('STUDENT_IDENTITY_APPROVAL_DIGEST_MISMATCH');
    await expect(
      transitionStudentIdentityMaintenance(db, { ...base, sourceCommitSha: 'deadbee' })
    ).rejects.toThrow('STUDENT_IDENTITY_SOURCE_COMMIT_MISMATCH');
    // Without an export completed immediately before, rollback has nothing to
    // restore from.
    await expect(
      transitionStudentIdentityMaintenance(db, { ...base, exportOperationId: 'other' })
    ).rejects.toThrow('STUDENT_IDENTITY_EXPORT_MISMATCH');
  });

  it('waits for outstanding leases rather than entering over them', async () => {
    const { db } = createInMemoryDocumentStore({
      ...maintenance('normal'),
      ...run(),
      '_maintenance/student_identity/active_mutations/live': {
        leaseId: 'live',
        operation: 'zalo_bulk_job',
        actorId: 'job:zalo',
        state: 'active',
        createdAt: '2026-08-09T09:59:00.000Z',
        heartbeatAt: '2026-08-09T09:59:00.000Z',
        expiresAt: '2026-08-09T10:30:00.000Z',
      },
    });

    await expect(
      transitionStudentIdentityMaintenance(db, {
        action: 'enter',
        runId: 'run-1',
        actorId: 'migration',
        expectedMode: 'normal',
        expectedGeneration: 0,
        planDigest: PLAN,
        approvalDigest: APPROVAL,
        sourceCommitSha: 'abc1234',
        exportOperationId: 'export-1',
      })
    ).rejects.toThrow('STUDENT_IDENTITY_LEASE_ACTIVE');
  });
});

describe('leaving after a verified cutover', () => {
  beforeEach(() => {
    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('lifts the window and writes the release proof in one commit', async () => {
    // Splitting them would leave an interval in which writes are open while
    // the rollback window is still notionally available.
    const { db, store } = createInMemoryDocumentStore(cutoverSeed());

    const state = await transitionStudentIdentityMaintenance(db, CUTOVER_EXIT, NOW);

    expect(state.mode).toBe('normal');
    expect(store.get('student_identity_release_proofs/run-1')?.reason).toBe('verified_cutover');
    expect(store.get('student_profile_merge_runs/run-1')?.maintenanceLiftedAt).toBe(
      NOW.toISOString()
    );
  });

  it('refuses to overwrite an existing release proof', async () => {
    const { db } = createInMemoryDocumentStore(
      cutoverSeed({
        'student_identity_release_proofs/run-1': {
          runId: 'run-1',
          reason: 'verified_cutover',
        },
      })
    );

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT, NOW)).rejects.toThrow(
      'STUDENT_IDENTITY_HEALTH_EVIDENCE_IMMUTABLE'
    );
  });

  it('refuses while any named queue still holds work', async () => {
    const { db } = createInMemoryDocumentStore(
      cutoverSeed(
        drain({
          queueCounts: {
            outboxJobs: 3,
            accountingFinanceOutbox: 0,
            receiptNotificationOutbox: 0,
            zaloBulkJobs: 0,
            payosProcessors: 0,
            passwordResetWork: 0,
          },
        })
      )
    );

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_QUEUE_NOT_DRAINED'
    );
  });

  it('refuses drain evidence that names no queues at all', async () => {
    // An empty map satisfies "every named queue is zero" without naming any
    // queue, which is the difference between measuring nothing and measuring
    // zero.
    const { db } = createInMemoryDocumentStore(cutoverSeed(drain({ queueCounts: {} })));

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_DRAIN_EVIDENCE_INCOMPLETE'
    );
  });

  it('refuses drain evidence that omits a required queue', async () => {
    const { db } = createInMemoryDocumentStore(
      cutoverSeed(drain({ queueCounts: { outboxJobs: 0, zaloBulkJobs: 0 } }))
    );

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_DRAIN_EVIDENCE_INCOMPLETE'
    );
  });

  it('refuses drain evidence bound to a different reviewed plan', async () => {
    const { db } = createInMemoryDocumentStore(
      cutoverSeed(drain({ planDigest: 'f'.repeat(64) }))
    );

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_DRAIN_EVIDENCE_BINDING_MISMATCH'
    );
  });

  it('refuses a stored green health whose own invariants say otherwise', async () => {
    // The gate must not take `status: green` on trust; an older writer or a
    // hand-edited document can carry a verdict its own evidence contradicts.
    const seed = cutoverSeed();
    const healthPath = Object.keys(seed).find((key) =>
      key.startsWith('student_identity_health_runs/')
    ) as string;
    seed[healthPath] = {
      ...seed[healthPath],
      invariants: {
        ...(seed[healthPath].invariants as Record<string, unknown>),
        monetaryTotalsMatchReviewedPlan: false,
      },
    };
    const { db } = createInMemoryDocumentStore(seed);

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_HEALTH_INVARIANTS_NOT_MET'
    );
  });

  it('refuses without drain evidence at all', async () => {
    const seed = cutoverSeed();
    delete seed['student_identity_drain_evidence/run-1'];
    const { db } = createInMemoryDocumentStore(seed);

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_DRAIN_EVIDENCE_MISSING'
    );
  });

  it('refuses while the run still has pending or failed operations', async () => {
    const pending = createInMemoryDocumentStore(cutoverSeed(run({ pendingOperationCount: 2 })));
    await expect(transitionStudentIdentityMaintenance(pending.db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_OPERATIONS_PENDING'
    );

    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
    const failed = createInMemoryDocumentStore(cutoverSeed(run({ failedOperationCount: 1 })));
    await expect(transitionStudentIdentityMaintenance(failed.db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_OPERATIONS_FAILED'
    );
  });

  it('refuses a health audit that is red, mismatched, or from another run', async () => {
    const red = createInMemoryDocumentStore(cutoverSeed(health({ status: 'red' })));
    await expect(transitionStudentIdentityMaintenance(red.db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_HEALTH_NOT_GREEN'
    );

    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
    const wrongDigest = createInMemoryDocumentStore(cutoverSeed(health({ digest: 'z'.repeat(64) })));
    await expect(
      transitionStudentIdentityMaintenance(wrongDigest.db, CUTOVER_EXIT)
    ).rejects.toThrow('STUDENT_IDENTITY_HEALTH_DIGEST_MISMATCH');

    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
    const otherRun = createInMemoryDocumentStore(cutoverSeed(health({ runId: 'run-2' })));
    await expect(transitionStudentIdentityMaintenance(otherRun.db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_HEALTH_RUN_MISMATCH'
    );
  });

  it('refuses unless reads are already serving canonical_required', async () => {
    const { db } = createInMemoryDocumentStore(
      cutoverSeed({
        '_maintenance/student_identity_read_model': {
          schemaVersion: 1,
          mode: 'canonical_preferred',
          generation: 1,
        },
      })
    );

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_READ_MODE_NOT_REQUIRED'
    );
  });

  it('refuses smoke probes that ran before the audit they are meant to confirm', async () => {
    // Probes that ran before the read switch and the rebuild tested the old
    // system, and passing is not evidence about the new one.
    const { db } = createInMemoryDocumentStore(
      cutoverSeed(smoke({ startedAt: '2026-08-09T09:00:00.000Z' }))
    );

    await expect(transitionStudentIdentityMaintenance(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_SMOKE_BEFORE_HEALTH'
    );
  });

  it('refuses an exit from an actor who did not enter the window', async () => {
    const { db } = createInMemoryDocumentStore(cutoverSeed());

    await expect(
      transitionStudentIdentityMaintenance(db, { ...CUTOVER_EXIT, actorId: 'someone-else' })
    ).rejects.toThrow('STUDENT_IDENTITY_ACTOR_MISMATCH');
  });

  it('reports the same refusal from the check as from the transition', async () => {
    // The CLI uses the check to tell an operator why the window will not lift
    // before they attempt it; a second copy of the policy would drift.
    const { db } = createInMemoryDocumentStore(cutoverSeed(health({ status: 'red' })));

    await expect(assertStudentIdentityCutoverCanExit(db, CUTOVER_EXIT)).rejects.toThrow(
      'STUDENT_IDENTITY_HEALTH_NOT_GREEN'
    );
  });
});

describe('aborting before anything was applied', () => {
  beforeEach(() => {
    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
  });

  const ABORT = {
    action: 'exit' as const,
    runId: 'run-1',
    actorId: 'migration',
    expectedGeneration: 0,
    reason: 'aborted_before_apply' as const,
  };

  it('lifts the window when the run really wrote nothing', async () => {
    const { db } = createInMemoryDocumentStore({
      ...maintenance('read_only'),
      ...run({ status: 'aborted', appliedOperationCount: 0 }),
    });

    const state = await transitionStudentIdentityMaintenance(db, ABORT, NOW);

    expect(state.mode).toBe('normal');
  });

  it('refuses to call it an abort once operations were applied', async () => {
    // An abort that quietly lifts the window over half-applied work is worse
    // than having no abort path at all.
    const { db } = createInMemoryDocumentStore({
      ...maintenance('read_only'),
      ...run({ status: 'aborted', appliedOperationCount: 4 }),
    });

    await expect(transitionStudentIdentityMaintenance(db, ABORT)).rejects.toThrow(
      'STUDENT_IDENTITY_ABORT_AFTER_APPLY'
    );
  });

  it('refuses when the run was never marked aborted', async () => {
    const { db } = createInMemoryDocumentStore({
      ...maintenance('read_only'),
      ...run({ appliedOperationCount: 0 }),
    });

    await expect(transitionStudentIdentityMaintenance(db, ABORT)).rejects.toThrow(
      'STUDENT_IDENTITY_RUN_NOT_ABORTED'
    );
  });
});

describe('rolling back before release', () => {
  beforeEach(() => {
    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
  });

  const ROLLBACK = {
    action: 'exit' as const,
    runId: 'run-1',
    actorId: 'migration',
    expectedGeneration: 0,
    reason: 'verified_rollback' as const,
    rollbackVerificationId: 'rb-1',
  };

  function verification(overrides: Record<string, unknown> = {}): Seed {
    return {
      'student_profile_rollback_verifications/rb-1': {
        runId: 'run-1',
        restoredOperationCount: 12,
        beforeStateMatches: true,
        monetaryTotalsMatch: true,
        ...overrides,
      },
    };
  }

  it('lifts the window once the before-state is restored', async () => {
    const { db } = createInMemoryDocumentStore({
      ...maintenance('read_only'),
      ...run(),
      ...verification(),
    });

    const state = await transitionStudentIdentityMaintenance(db, ROLLBACK, NOW);

    expect(state.mode).toBe('normal');
  });

  it('refuses once maintenance was already lifted for this run', async () => {
    // The world has seen the new data: receipts printed, messages sent, a
    // parent told a balance. Recovery from here is forward repair under a new
    // reviewed run, not a restore.
    const { db } = createInMemoryDocumentStore({
      ...maintenance('read_only'),
      ...run({ maintenanceLiftedAt: '2026-08-09T09:50:00.000Z' }),
      ...verification(),
    });

    await expect(transitionStudentIdentityMaintenance(db, ROLLBACK)).rejects.toThrow(
      'STUDENT_IDENTITY_ROLLBACK_AFTER_RELEASE_FORBIDDEN'
    );
  });

  it('refuses a partial restore', async () => {
    const { db } = createInMemoryDocumentStore({
      ...maintenance('read_only'),
      ...run(),
      ...verification({ restoredOperationCount: 9 }),
    });

    await expect(transitionStudentIdentityMaintenance(db, ROLLBACK)).rejects.toThrow(
      'STUDENT_IDENTITY_ROLLBACK_INCOMPLETE'
    );
  });

  it('refuses when the before-state or the money did not match', async () => {
    const { db } = createInMemoryDocumentStore({
      ...maintenance('read_only'),
      ...run(),
      ...verification({ monetaryTotalsMatch: false }),
    });

    await expect(transitionStudentIdentityMaintenance(db, ROLLBACK)).rejects.toThrow(
      'STUDENT_IDENTITY_ROLLBACK_STATE_MISMATCH'
    );
  });
});

describe('leaving after a verified retirement', () => {
  beforeEach(() => {
    resetStudentIdentityMaintenanceCacheForTests();
    resetCanonicalStudentReadControlCacheForTests();
  });

  const RETIREMENT = {
    action: 'exit' as const,
    runId: 'run-1',
    actorId: 'migration',
    expectedGeneration: 0,
    reason: 'verified_retirement' as const,
    retirementVerificationId: 'ret-1',
    healthAuditId: 'audit-1',
    healthDigest: HEALTH_DIGEST,
    smokeEvidenceId: 'smoke-1',
  };

  const VERIFIED: Seed = {
    'student_profile_retirement_verifications/ret-1': { runId: 'run-1', status: 'verified' },
  };

  it('lifts the window once the legacy fields are gone', async () => {
    const { db, store } = createInMemoryDocumentStore(cutoverSeed(VERIFIED));

    const state = await transitionStudentIdentityMaintenance(db, RETIREMENT, NOW);

    expect(state.mode).toBe('normal');
    expect(store.get('student_identity_release_proofs/run-1')?.reason).toBe('verified_retirement');
  });

  it('refuses while any legacy projection field is still written', async () => {
    const { db } = createInMemoryDocumentStore(
      cutoverSeed({ ...VERIFIED, ...health({ counts: { legacyProjectionFieldsRemaining: 4 } }) })
    );

    await expect(transitionStudentIdentityMaintenance(db, RETIREMENT)).rejects.toThrow(
      'STUDENT_IDENTITY_LEGACY_PROJECTION_FIELDS_REMAIN'
    );
  });

  it('refuses without a verified retirement record', async () => {
    const { db } = createInMemoryDocumentStore(cutoverSeed());

    await expect(transitionStudentIdentityMaintenance(db, RETIREMENT)).rejects.toThrow(
      'STUDENT_IDENTITY_RETIREMENT_VERIFICATION_NOT_FOUND'
    );
  });
});

describe('recordStudentIdentityDrainEvidence', () => {
  it('stores the observed counts under the run they belong to', async () => {
    // Recorded once and re-read rather than re-measured: apply preflight and
    // exit happen minutes apart, and a number true at one and not the other is
    // exactly the drift the window exists to prevent.
    const { db, store } = createInMemoryDocumentStore({});

    await recordStudentIdentityDrainEvidence(db, {
      runId: 'run-1',
      observedAt: NOW.toISOString(),
      recordedBy: 'migration',
      queueCounts: { outboxJobs: 0 },
      activeLeases: 0,
      staleLeases: 0,
      planDigest: PLAN,
      approvalDigest: APPROVAL,
    });

    expect(store.get('student_identity_drain_evidence/run-1')?.recordedBy).toBe('migration');
  });

  it('refuses to overwrite existing drain evidence', async () => {
    const { db } = createInMemoryDocumentStore(drain());

    await expect(
      recordStudentIdentityDrainEvidence(db, {
        runId: 'run-1',
        observedAt: NOW.toISOString(),
        recordedBy: 'migration',
        queueCounts: {},
        activeLeases: 0,
        staleLeases: 0,
        planDigest: PLAN,
        approvalDigest: APPROVAL,
      })
    ).rejects.toThrow('STUDENT_IDENTITY_HEALTH_EVIDENCE_IMMUTABLE');
  });
});
