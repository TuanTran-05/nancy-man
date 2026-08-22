import { describe, expect, it } from 'vitest';
import {
  assertNoForbiddenHealthFields,
  collectStudentIdentityHealth,
} from './studentIdentityHealthService.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';
import {
  normalizeAdmissionContact,
  normalizeAdmissionName,
} from '../../../../scripts/student-profile-normalization/admissionSearchBackfill.js';

type Seed = Record<string, Record<string, unknown>>;

const NOW = new Date('2026-08-09T10:00:00.000Z');

function base(overrides: Seed = {}): Seed {
  return {
    '_maintenance/student_identity': {
      mode: 'normal',
      activeRunId: null,
      migrationActorId: null,
      updatedAt: '2026-08-09T09:00:00.000Z',
      updatedBy: 'operator',
    },
    '_maintenance/student_identity_read_model': {
      mode: 'legacy_compare',
      generation: 1,
      updatedAt: '2026-08-09T09:00:00.000Z',
      updatedBy: 'operator',
      planDigest: null,
      approvalDigest: null,
    },
    ...overrides,
  };
}

function profile(id: string, overrides: Record<string, unknown> = {}): Seed {
  return {
    [`students/${id}`]: {
      name: `Học Sinh ${id}`,
      dob: '2013-05-02',
      contact: '0384072314',
      studentId: `HS-${id}`,
      // Computed with the real normalizers rather than guessed, so a complete
      // profile reads as complete instead of silently drifted.
      admissionSearchName: normalizeAdmissionName(`Học Sinh ${id}`),
      admissionSearchDob: '2013-05-02',
      admissionSearchContact: normalizeAdmissionContact('0384072314'),
      studentLifecycle: 'enrolled',
      ...overrides,
    },
  };
}

function alias(legacyId: string, canonicalId: string): Seed {
  return {
    [`student_profile_aliases/${legacyId}`]: {
      legacyProfileId: legacyId,
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: '2026-08-01T00:00:00.000Z',
      createdBy: 'merge',
    },
  };
}

function tombstone(id: string, canonicalId: string): Seed {
  return {
    [`students/${id}`]: {
      studentProfileState: 'merged_tombstone',
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      mergedAt: '2026-08-01T00:00:00.000Z',
      identityWriteDisabled: true,
      authDisabled: true,
      walletOwnership: 'canonicalized',
      tombstoneSourceFingerprint: 'b'.repeat(64),
    },
  };
}

function enrollment(profileId: string, classId: string, status: string): Seed {
  const id = makeStudentCourseEnrollmentId(profileId, classId, '2026-07-01');
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart: '2026-07-01',
      termEnd: '2026-12-31',
      status,
      joinedAt: '2026-07-01',
      endedAt: null,
    },
  };
}

import { collectStudentIdentityHealthSources } from './studentIdentityHealthSources.js';

async function collect(seed: Seed, overrides: Record<string, unknown> = {}) {
  const { db } = createInMemoryDocumentStore(seed);
  // The sources are gathered for a run, because the merge-engine verification
  // this report stands on is filed under one.
  const sources = await collectStudentIdentityHealthSources({
    db,
    now: NOW,
    runId: overrides.runId as string | undefined,
  });
  return collectStudentIdentityHealth({
    sources,
    projectId: 'edutrack',
    databaseId: '(default)',
    mode: 'daily',
    sourceCommitSha: 'abc1234',
    now: NOW,
    ...overrides,
  } as never);
}

describe('collectStudentIdentityHealth counts', () => {
  it('separates physical documents from canonical profiles, aliases, and tombstones', async () => {
    const report = await collect(
      base({
        ...profile('canonical-1'),
        ...tombstone('legacy-1', 'canonical-1'),
        ...alias('legacy-1', 'canonical-1'),
      })
    );

    expect(report.counts.physicalProfiles).toBe(2);
    expect(report.counts.canonicalProfiles).toBe(1);
    expect(report.counts.tombstones).toBe(1);
    expect(report.counts.aliases).toBe(1);
  });

  it('counts a legacy soft merge with no alias, which is non-zero from day one', async () => {
    // Fifty-eight production records carry `mergedIntoStudentId` and no alias.
    // Only Workstream C clears them, so this blocks cutover rather than the
    // daily audit.
    const report = await collect(
      base({
        ...profile('canonical-1'),
        ...profile('legacy-1', { mergedIntoStudentId: 'canonical-1' }),
      })
    );

    expect(report.counts.unnormalizedLegacySoftMergeProfiles).toBe(1);
  });

  it('counts a profile carrying two open enrollments', async () => {
    const report = await collect(
      base({
        ...profile('p-1'),
        ...enrollment('p-1', 'class-g6', 'active'),
        ...enrollment('p-1', 'class-g7', 'active'),
        ...profile('p-2'),
        ...enrollment('p-2', 'class-g7', 'active'),
      })
    );

    expect(report.counts.profilesWithMultipleOpenEnrollments).toBe(1);
    expect(report.counts.requiredModeBlockerCount).toBeGreaterThan(0);
  });

  it('counts a code carried by two unmerged profiles', async () => {
    const report = await collect(
      base({
        ...profile('a', { studentId: 'HS0001' }),
        ...profile('b', { studentId: 'HS0001' }),
      })
    );

    expect(report.counts.unresolvedExactCodeGroups).toBe(1);
  });

  it('does not count a duplicated code once the two are merged', async () => {
    const report = await collect(
      base({
        ...profile('canonical-1', { studentId: 'HS0001' }),
        ...tombstone('legacy-1', 'canonical-1'),
        ...alias('legacy-1', 'canonical-1'),
      })
    );

    expect(report.counts.unresolvedExactCodeGroups).toBe(0);
  });

  it('counts an alias whose chain is longer than one hop', async () => {
    const report = await collect(
      base({
        ...profile('a'),
        ...profile('b'),
        ...profile('c'),
        ...alias('a', 'b'),
        ...alias('b', 'c'),
      })
    );

    expect(report.invariants.aliasesOneHopAndAcyclic).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      'STUDENT_IDENTITY_ALIAS_NOT_ONE_HOP'
    );
  });

  it('counts an alias pointing at a document that does not exist', async () => {
    const report = await collect(base({ ...profile('a'), ...alias('a', 'ghost') }));

    expect(report.invariants.aliasesOneHopAndAcyclic).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      'STUDENT_IDENTITY_ALIAS_TARGET_MISSING'
    );
  });

  it('counts a live credential still sitting on a retired profile', async () => {
    // Credentials belong to the profile that survives. One left behind is a
    // way into a record the merge already retired.
    const report = await collect(
      base({
        ...profile('canonical-1'),
        ...tombstone('legacy-1', 'canonical-1'),
        ...alias('legacy-1', 'canonical-1'),
        'student_auth_credentials/legacy-1': {
          loginPasswordHash: 'x'.repeat(64),
          loginPasswordSalt: 'y'.repeat(32),
          passwordVersion: 2,
        },
      })
    );

    expect(report.counts.activeCredentialsOnAliases).toBe(1);
    expect(report.invariants.authenticationPathsCanonical).toBe(false);
  });

  it('counts a linked account still naming a retired profile', async () => {
    const report = await collect(
      base({
        ...profile('canonical-1'),
        ...tombstone('legacy-1', 'canonical-1'),
        ...alias('legacy-1', 'canonical-1'),
        'users/parent:legacy-1': { uid: 'parent:legacy-1', role: 'parent', studentId: 'legacy-1' },
      })
    );

    expect(report.counts.linkedUserMismatches).toBe(1);
  });

  it('counts a registry code whose owner is not canonical', async () => {
    const report = await collect(
      base({
        ...profile('canonical-1'),
        ...tombstone('legacy-1', 'canonical-1'),
        ...alias('legacy-1', 'canonical-1'),
        'student_code_registry/HS0001': {
          normalizedCode: 'HS0001',
          canonicalProfileId: 'legacy-1',
          isPrimary: true,
          status: 'active',
          createdAt: 't',
          updatedAt: 't',
          createdBy: 'x',
          updatedBy: 'x',
        },
      })
    );

    expect(report.counts.registryProfileMismatches).toBe(1);
  });

  it('counts a finance summary written against a retired profile', async () => {
    const report = await collect(
      base({
        ...profile('canonical-1'),
        ...tombstone('legacy-1', 'canonical-1'),
        ...alias('legacy-1', 'canonical-1'),
        'accounting_student_summaries/legacy-1': { studentId: 'legacy-1', sourceVersion: 3 },
      })
    );

    expect(report.counts.summariesForAliasesOrTombstones).toBe(1);
    expect(report.counts.missingCanonicalSummaries).toBe(1);
  });

  it('counts a summary for a profile that no longer exists', async () => {
    const report = await collect(
      base({
        ...profile('canonical-1'),
        'accounting_student_summaries/canonical-1': {
          studentId: 'canonical-1',
          sourceVersion: 3,
        },
        'accounting_student_summaries/ghost': { studentId: 'ghost', sourceVersion: 3 },
      })
    );

    expect(report.counts.orphanCanonicalSummaries).toBe(1);
    expect(report.counts.missingCanonicalSummaries).toBe(0);
  });

  it('counts a duplicated wallet row for one human', async () => {
    const report = await collect(
      base({
        ...profile('canonical-1', { walletBalance: 500_000 }),
        ...profile('legacy-1', { mergedIntoStudentId: 'canonical-1', walletBalance: 200_000 }),
      })
    );

    expect(report.counts.duplicateWalletRows).toBe(1);
  });

  it('counts the legacy projection fields still written on profiles', async () => {
    // Retirement is not finished while these remain, and the count is what
    // proves it rather than an operator's recollection.
    const report = await collect(
      base({
        ...profile('a', { classId: 'class-g7', teacherId: 'teacher-1' }),
        ...profile('b', { enrollmentStatus: 'active' }),
      })
    );

    expect(report.counts.legacyProjectionFieldsRemaining).toBe(3);
  });

  it('counts pending work in every queue that can write a student record', async () => {
    const report = await collect(
      base({
        ...profile('a'),
        'outbox_jobs/j1': { status: 'pending' },
        'outbox_jobs/j2': { status: 'done' },
        'accounting_finance_outbox/f1': { status: 'pending' },
        'zalo_bulk_jobs/z1': { status: 'processing' },
        'passwordResetRequests/p1': { status: 'pending' },
      })
    );

    expect(report.pendingJobs).toMatchObject({
      outboxJobs: 1,
      accountingFinanceOutbox: 1,
      zaloBulkJobs: 1,
      passwordResetWork: 1,
    });
  });

  it('counts active and stale mutation leases separately', async () => {
    // A stale lease means the heartbeat stopped, not that the work did, so it
    // is reported apart from a healthy one rather than folded in.
    const report = await collect(
      base({
        ...profile('a'),
        '_maintenance/student_identity/active_mutations/live': {
          leaseId: 'live',
          operation: 'zalo_bulk_job',
          actorId: 'job:zalo',
          state: 'active',
          createdAt: '2026-08-09T09:59:00.000Z',
          heartbeatAt: '2026-08-09T09:59:00.000Z',
          expiresAt: '2026-08-09T10:04:00.000Z',
        },
        '_maintenance/student_identity/active_mutations/dead': {
          leaseId: 'dead',
          operation: 'payos_reconcile',
          actorId: 'job:payos',
          state: 'active',
          createdAt: '2026-08-09T08:00:00.000Z',
          heartbeatAt: '2026-08-09T08:00:00.000Z',
          expiresAt: '2026-08-09T08:05:00.000Z',
        },
      })
    );

    expect(report.counts.activeMutationLeases).toBe(1);
    expect(report.counts.staleMutationLeases).toBe(1);
  });

  it('counts failed and pending journal operations', async () => {
    const report = await collect(
      base({
        ...profile('a'),
        'student_profile_merge_journal/j1': { runId: 'run-1', stage: 'apply', status: 'failed' },
        'student_profile_merge_journal/j2': { runId: 'run-1', stage: 'apply', status: 'pending' },
        'student_profile_merge_journal/j3': { runId: 'run-1', stage: 'apply', status: 'verified' },
      })
    );

    expect(report.counts.failedJournalOperations).toBe(1);
    expect(report.counts.pendingMigrationOperations).toBe(1);
    expect(report.operationCounts.verified).toBe(1);
  });

  it('separates a profile that can be backfilled from one nobody can repair', async () => {
    const report = await collect(
      base({
        // Denormalized fields absent, but name/dob/contact are all present.
        ...profile('fixable', {
          admissionSearchName: undefined,
          admissionSearchDob: undefined,
          admissionSearchContact: undefined,
        }),
        // No contact at all: no backfill can produce the field.
        ...profile('unfixable', {
          contact: '',
          admissionSearchName: undefined,
          admissionSearchDob: undefined,
          admissionSearchContact: undefined,
        }),
      })
    );

    expect(report.counts.studentsWithUnusableAdmissionSearchFields).toBe(1);
    expect(report.counts.studentsWithUnderivableAdmissionSearchFields).toBe(1);
  });

  it('excludes retired documents from the backfill blocker', async () => {
    // Counting them would hold the blocker non-zero until retirement deletes
    // them, which happens after the gate it would be blocking.
    const report = await collect(
      base({
        ...profile('canonical-1'),
        ...alias('legacy-1', 'canonical-1'),
        'students/legacy-1': {
          studentProfileState: 'merged_tombstone',
          canonicalProfileId: 'canonical-1',
          mergeRunId: 'run-1',
          mergedAt: 't',
          identityWriteDisabled: true,
          authDisabled: true,
          walletOwnership: 'canonicalized',
          tombstoneSourceFingerprint: 'b'.repeat(64),
        },
      })
    );

    expect(report.counts.studentsWithUnusableAdmissionSearchFields).toBe(0);
  });
});

describe('collectStudentIdentityHealth status', () => {
  it('is green on a clean center', async () => {
    const report = await collect(
      base({
        ...profile('a'),
        ...enrollment('a', 'class-g7', 'active'),
        // A canonical profile without its accounting summary is an
        // incomplete projection, so a genuinely clean center has one.
        'accounting_student_summaries/a': { studentId: 'a', sourceVersion: 3 },
      })
    );

    expect(report.status).toBe('green');
    expect(report.blockers).toEqual([]);
  });

  it('is red when any identity invariant is broken', async () => {
    const report = await collect(base({ ...profile('a'), ...alias('a', 'ghost') }));

    expect(report.status).toBe('red');
  });

  it('reports money as null in daily mode', async () => {
    // Money is compared against a reviewed plan. Without a run there is no
    // plan, and reporting `true` would claim an assurance nobody produced.
    const report = await collect(base(profile('a')));

    expect(report.invariants.monetaryTotalsMatchReviewedPlan).toBeNull();
  });

  it('refuses to call a cutover green without run, plan, approval, and export evidence', async () => {
    const report = await collect(base(profile('a')), { mode: 'cutover' });

    expect(report.status).toBe('red');
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        'STUDENT_IDENTITY_CUTOVER_RUN_MISSING',
        'STUDENT_IDENTITY_CUTOVER_PLAN_DIGEST_MISSING',
        'STUDENT_IDENTITY_CUTOVER_APPROVAL_DIGEST_MISSING',
        'STUDENT_IDENTITY_CUTOVER_EXPORT_MISSING',
      ])
    );
  });

  it('refuses a cutover that is not serving canonical_required', async () => {
    const report = await collect(base(profile('a')), {
      mode: 'cutover',
      runId: 'run-1',
      planDigest: 'p'.repeat(64),
      approvalDigest: 'q'.repeat(64),
      exportOperationId: 'export-1',
    });

    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      'STUDENT_IDENTITY_CUTOVER_READ_MODE'
    );
  });

  it('requires the legacy projection fields to be gone before retirement is green', async () => {
    const report = await collect(base(profile('a', { classId: 'class-g7' })), {
      mode: 'retirement',
    });

    expect(report.status).toBe('red');
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      'STUDENT_IDENTITY_LEGACY_PROJECTION_FIELDS_REMAIN'
    );
  });

  it('keeps a quarantined hold inside the blocker count', async () => {
    // Quarantine is operational bookkeeping. It does not change serving, and
    // treating it as resolved would let a cutover proceed past a case a human
    // explicitly could not decide.
    const report = await collect(
      base({
        ...profile('a'),
        'student_profile_merge_holds/h1': {
          candidateId: 'cand-1',
          state: 'quarantined',
          reasonCode: 'manual_review',
        },
        'student_profile_merge_holds/h2': {
          candidateId: 'cand-2',
          state: 'unresolved',
          reasonCode: 'manual_review',
        },
      })
    );

    expect(report.counts.quarantinedManualHoldGroups).toBe(1);
    expect(report.counts.unresolvedManualHoldGroups).toBe(1);
    expect(report.counts.requiredModeBlockerCount).toBeGreaterThanOrEqual(2);
  });
});

describe('health report redaction', () => {
  it('carries no name, contact, date of birth, or credential material', async () => {
    const report = await collect(
      base({ ...profile('a'), ...enrollment('a', 'class-g7', 'active') })
    );

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('Học Sinh');
    expect(serialized).not.toContain('0384072314');
    expect(serialized).not.toContain('2013-05-02');
    expect(() => assertNoForbiddenHealthFields(report)).not.toThrow();
  });

  it('rejects a blocker that smuggles a private field in', async () => {
    expect(() =>
      assertNoForbiddenHealthFields({
        blockers: [{ code: 'X', detail: 'x', contact: '0384072314' }],
      })
    ).toThrow('STUDENT_IDENTITY_HEALTH_FIELD_FORBIDDEN');
  });

  it('digests the same data to the same value regardless of blocker order', async () => {
    // The digest is what an approval binds to, so it cannot depend on the
    // order DocumentStore happened to return documents in.
    const seed = base({ ...profile('a'), ...alias('a', 'ghost'), ...alias('b', 'ghost2') });
    const first = await collect(seed);
    const second = await collect(seed);

    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('collectStudentIdentityHealth fails closed', () => {
  it('turns an unreadable required collection into a blocker instead of an empty one', async () => {
    const { db } = createInMemoryDocumentStore(base({ ...profile('a') }));
    const mutable = db as never as { collection: (name: string) => unknown };
    const readable = mutable.collection.bind(mutable);
    mutable.collection = (name: string) => {
      if (name === 'student_profile_aliases') throw new Error('unavailable');
      return readable(name) as never;
    };
    const sources = await collectStudentIdentityHealthSources({ db, now: NOW });

    const report = await collectStudentIdentityHealth({
      sources,
      projectId: 'edutrack',
      databaseId: '(default)',
      mode: 'daily',
      sourceCommitSha: 'abc1234',
      now: NOW,
    } as never);

    expect(report.status).toBe('red');
    expect(report.blockers).toContainEqual(
      expect.objectContaining({ code: 'STUDENT_IDENTITY_HEALTH_SOURCE_UNAVAILABLE' })
    );
  });

  it('refuses to call a cutover green while money is unverified', async () => {
    // No reviewed plan was supplied, so nothing has checked the money.
    const report = await collect(base({ ...profile('a') }), {
      mode: 'cutover',
      runId: 'run-1',
      planDigest: 'p'.repeat(64),
      approvalDigest: 'a'.repeat(64),
      exportOperationId: 'export-1',
    });

    expect(report.invariants.monetaryTotalsMatchReviewedPlan).not.toBe(true);
    expect(report.status).toBe('red');
    expect(report.blockers).toContainEqual(
      expect.objectContaining({ code: 'STUDENT_IDENTITY_MONEY_NOT_VERIFIED' })
    );
  });

  it('refuses to call a run green while projections are incomplete', async () => {
    // A canonical profile with no accounting summary is an incomplete
    // projection, and it must reach status rather than only the counters.
    const report = await collect(base({ ...profile('a') }));

    expect(report.projectionHealth.complete).toBe(false);
    expect(report.status).toBe('red');
    expect(report.blockers).toContainEqual(
      expect.objectContaining({ code: 'STUDENT_IDENTITY_PROJECTION_NOT_CURRENT' })
    );
  });
});

describe('collectStudentIdentityHealth reads the merge engine verification', () => {
  it('turns a stored verification into the money invariant the gate reads', async () => {
    // The link that was missing: the engine measured the money and nothing
    // carried that answer across to the health report.
    const report = await collect(
      base({
        ...profile('a'),
        'accounting_student_summaries/a': { studentId: 'a', sourceVersion: 3 },
        'student_profile_normalization_verifications/run-1': {
          runId: 'run-1',
          moneyMatches: true,
          valid: true,
          blockers: [],
        },
      }),
      { runId: 'run-1' }
    );

    expect(report.invariants.monetaryTotalsMatchReviewedPlan).toBe(true);
  });

  it('stays unverified when the run has no stored verification', async () => {
    const report = await collect(
      base({
        ...profile('a'),
        'accounting_student_summaries/a': { studentId: 'a', sourceVersion: 3 },
      }),
      { runId: 'run-1' }
    );

    expect(report.invariants.monetaryTotalsMatchReviewedPlan).toBeNull();
  });
});
