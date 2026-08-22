import { describe, expect, it } from 'vitest';
import { planLegacyStudentRetirement, type PlanLegacyRetirementInput } from './planner.js';

const NOW = new Date('2026-09-15T10:00:00.000Z');

function tombstone(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      studentProfileState: 'merged_tombstone',
      canonicalProfileId: 'canonical-1',
      mergeRunId: 'run-0',
      mergedAt: '2026-08-01T00:00:00.000Z',
      identityWriteDisabled: true,
      authDisabled: true,
      walletOwnership: 'canonicalized',
      tombstoneSourceFingerprint: 'b'.repeat(64),
      ...overrides,
    },
  };
}

function alias(legacyId: string, canonicalId = 'canonical-1') {
  return {
    id: legacyId,
    data: {
      legacyProfileId: legacyId,
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-0',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: 't',
      createdBy: 'merge',
    },
  };
}

const GREEN_WEEK = [
  'a-2026-09-09',
  'a-2026-09-10',
  'a-2026-09-11',
  'a-2026-09-12',
  'a-2026-09-13',
  'a-2026-09-14',
  'a-2026-09-15',
];

function input(overrides: Partial<PlanLegacyRetirementInput> = {}): PlanLegacyRetirementInput {
  return {
    runId: 'ret-1',
    generatedAt: NOW.toISOString(),
    target: { projectId: 'edutrack', databaseId: '(default)' },
    sourceCommitSha: 'abc1234',
    exportOperationId: 'export-1',
    latestHealthAuditId: 'audit-1',
    dailyGreenAuditIds: GREEN_WEEK,
    dailyAuditMissingDates: [],
    students: [tombstone('legacy-1'), { id: 'canonical-1', data: { name: 'A' } }],
    aliases: [alias('legacy-1')],
    credentials: [],
    linkedUsers: [],
    remainingReferences: new Map(),
    unknownReferenceCount: 0,
    journalPendingCount: 0,
    journalFailedCount: 0,
    openRollbackInvestigations: 0,
    maintenanceMode: 'read_only',
    maintenanceRunId: 'ret-1',
    maintenanceActorId: 'migration',
    actorId: 'migration',
    canonicalReadMode: 'canonical_required',
    unconvertedLegacyFieldReaders: [],
    now: NOW,
    ...overrides,
  };
}

function codes(plan: ReturnType<typeof planLegacyStudentRetirement>) {
  return [...plan.blockers.map((b) => b.code), ...plan.candidates.flatMap((c) => c.blockers.map((b) => b.code))];
}

describe('planLegacyStudentRetirement eligibility', () => {
  it('plans the deletion once every gate is satisfied', () => {
    const plan = planLegacyStudentRetirement(input());

    expect(plan.blockers).toEqual([]);
    expect(plan.candidates[0].eligible).toBe(true);
    expect(plan.operations.map((op) => op.kind)).toContain('delete_profile_tombstone');
  });

  it('never marks its own plan approved', () => {
    // Approval is a separate artifact from a different command and a different
    // person; a plan that could approve itself makes the review a formality.
    expect(planLegacyStudentRetirement(input()).approved).toBe(false);
  });

  it('refuses a tombstone younger than thirty calendar days', () => {
    const plan = planLegacyStudentRetirement(
      input({ students: [tombstone('legacy-1', { mergedAt: '2026-09-01T00:00:00.000Z' })] })
    );

    expect(codes(plan)).toContain('AGE_LT_30_CALENDAR_DAYS');
    expect(plan.operations).toEqual([]);
  });

  it('refuses without seven green daily audits', () => {
    const plan = planLegacyStudentRetirement(input({ dailyGreenAuditIds: GREEN_WEEK.slice(0, 6) }));

    expect(codes(plan)).toContain('GREEN_DAILY_AUDIT_STREAK_LT_7');
  });

  it('refuses when a day in the streak is missing', () => {
    // A missing day is a day nobody checked, which is not evidence that
    // anything was healthy.
    const plan = planLegacyStudentRetirement(
      input({ dailyAuditMissingDates: ['2026-09-12'] })
    );

    expect(codes(plan)).toContain('DAILY_AUDIT_GAP');
  });

  it('refuses a tombstone with no alias to keep old links resolving', () => {
    const plan = planLegacyStudentRetirement(input({ aliases: [] }));

    expect(codes(plan)).toContain('ALIAS_MISSING');
  });

  it('refuses an alias that points somewhere else than the tombstone claims', () => {
    const plan = planLegacyStudentRetirement(
      input({ aliases: [alias('legacy-1', 'somebody-else')] })
    );

    expect(codes(plan)).toContain('ALIAS_INVALID');
  });

  it('refuses while any mutable reference still names the id', () => {
    const plan = planLegacyStudentRetirement(
      input({ remainingReferences: new Map([['legacy-1', 3]]) })
    );

    expect(codes(plan)).toContain('REFERENCE_REMAINS');
  });

  it('refuses while an account is still linked', () => {
    const linked = planLegacyStudentRetirement(
      input({ linkedUsers: [{ id: 'parent:legacy-1', data: { studentId: 'legacy-1' } }] })
    );
    expect(codes(linked)).toContain('ACTIVE_LINKED_USER');
  });

  describe('credential tombstone eligibility', () => {
    it('accepts a credential that qualifies for tombstone deletion', () => {
      const plan = planLegacyStudentRetirement(
        input({
          credentials: [
            {
              id: 'legacy-1',
              data: {
                credentialState: 'retired_tombstone',
                active: false,
                canonicalProfileId: 'canonical-1',
                mergeRunId: 'run-0',
                disabledAt: '2026-08-01T00:00:00.000Z',
              },
            },
          ],
        })
      );
      expect(plan.blockers).toEqual([]);
      expect(plan.operations.map((op) => op.kind)).toContain('delete_credential_tombstone');
    });

    it('refuses if credentialState is not retired_tombstone', () => {
      const credential = planLegacyStudentRetirement(
        input({
          credentials: [
            {
              id: 'legacy-1',
              data: {
                credentialState: 'active',
                active: false,
                canonicalProfileId: 'canonical-1',
                mergeRunId: 'run-0',
                disabledAt: '2026-08-01T00:00:00.000Z',
              },
            },
          ],
        })
      );
      expect(codes(credential)).toContain('ACTIVE_CREDENTIAL');
    });

    it('refuses if the credential is still active', () => {
      const credential = planLegacyStudentRetirement(
        input({
          credentials: [
            {
              id: 'legacy-1',
              data: {
                credentialState: 'retired_tombstone',
                active: true,
                canonicalProfileId: 'canonical-1',
                mergeRunId: 'run-0',
                disabledAt: '2026-08-01T00:00:00.000Z',
              },
            },
          ],
        })
      );
      expect(codes(credential)).toContain('ACTIVE_CREDENTIAL');
    });

    it('refuses if the canonical metadata does not match the profile', () => {
      const credential = planLegacyStudentRetirement(
        input({
          credentials: [
            {
              id: 'legacy-1',
              data: {
                credentialState: 'retired_tombstone',
                active: false,
                canonicalProfileId: 'canonical-2',
                mergeRunId: 'run-0',
                disabledAt: '2026-08-01T00:00:00.000Z',
              },
            },
          ],
        })
      );
      expect(codes(credential)).toContain('ACTIVE_CREDENTIAL');
    });

    it('refuses if 30 calendar days have not elapsed since disabledAt', () => {
      const credential = planLegacyStudentRetirement(
        input({
          credentials: [
            {
              id: 'legacy-1',
              data: {
                credentialState: 'retired_tombstone',
                active: false,
                canonicalProfileId: 'canonical-1',
                mergeRunId: 'run-0',
                disabledAt: '2026-09-01T00:00:00.000Z',
              },
            },
          ],
        })
      );
      expect(codes(credential)).toContain('ACTIVE_CREDENTIAL');
    });

    it('refuses if a linked user names the legacy ID as its login path', () => {
      const credential = planLegacyStudentRetirement(
        input({
          credentials: [
            {
              id: 'legacy-1',
              data: {
                credentialState: 'retired_tombstone',
                active: false,
                canonicalProfileId: 'canonical-1',
                mergeRunId: 'run-0',
                disabledAt: '2026-08-01T00:00:00.000Z',
              },
            },
          ],
          linkedUsers: [{ id: 'parent:legacy-1', data: { studentId: 'someone-else', loginPath: 'legacy-1' } }],
        })
      );
      expect(codes(credential)).toContain('ACTIVE_CREDENTIAL');
    });
  });

  it('refuses while money is still attributed to the document', () => {
    const withBalance = planLegacyStudentRetirement(
      input({ students: [tombstone('legacy-1', { walletBalance: 250_000 })] })
    );
    expect(codes(withBalance)).toContain('NONZERO_WALLET_OWNERSHIP');

    const notCanonicalized = planLegacyStudentRetirement(
      input({ students: [tombstone('legacy-1', { walletOwnership: 'pending' })] })
    );
    expect(codes(notCanonicalized)).toContain('NONZERO_WALLET_OWNERSHIP');
  });

  it('refuses outside a read-only window bound to this run and actor', () => {
    expect(codes(planLegacyStudentRetirement(input({ maintenanceMode: 'normal' })))).toContain(
      'MAINTENANCE_NOT_READ_ONLY'
    );
    expect(
      codes(planLegacyStudentRetirement(input({ maintenanceActorId: 'someone-else' })))
    ).toContain('RUN_OR_ACTOR_MISMATCH');
  });

  it('refuses unless reads already serve canonical_required', () => {
    expect(
      codes(planLegacyStudentRetirement(input({ canonicalReadMode: 'canonical_preferred' })))
    ).toContain('READ_MODE_NOT_CANONICAL_REQUIRED');
  });

  it('refuses while a legacy soft merge has never been normalized', () => {
    // Deleting those records would stop their old links resolving.
    const plan = planLegacyStudentRetirement(
      input({
        students: [
          tombstone('legacy-1'),
          { id: 'soft-1', data: { mergedIntoStudentId: 'canonical-1' } },
        ],
      })
    );

    expect(codes(plan)).toContain('UNNORMALIZED_LEGACY_SOFT_MERGE');
  });

  it('refuses while a production query still reads a field this run removes', () => {
    // `users.classId` is the dangerous one: its readers fail silently, so a
    // missed conversion produces no error at all.
    const plan = planLegacyStudentRetirement(
      input({ unconvertedLegacyFieldReaders: ['deltaRecipients.ts reads users.classId'] })
    );

    expect(codes(plan)).toContain('LEGACY_FIELD_READER_NOT_CONVERTED');
    expect(plan.operations).toEqual([]);
  });

  it('refuses while any journal operation is pending or failed', () => {
    expect(codes(planLegacyStudentRetirement(input({ journalFailedCount: 1 })))).toContain(
      'PENDING_OR_FAILED_JOURNAL'
    );
  });

  it('refuses while a rollback investigation is open', () => {
    expect(codes(planLegacyStudentRetirement(input({ openRollbackInvestigations: 1 })))).toContain(
      'ROLLBACK_INVESTIGATION_OPEN'
    );
  });

  it('refuses while the registry cannot describe every reference', () => {
    expect(codes(planLegacyStudentRetirement(input({ unknownReferenceCount: 2 })))).toContain(
      'UNKNOWN_REFERENCE'
    );
  });
});

describe('planLegacyStudentRetirement field sweep', () => {
  it('removes the legacy fields from every profile, not only merged ones', () => {
    // The fields are a center-wide compatibility layer. Leaving them on the
    // untouched majority would mean retirement never actually finished.
    const plan = planLegacyStudentRetirement(
      input({
        students: [
          tombstone('legacy-1'),
          { id: 'canonical-1', data: { name: 'A', classId: 'class-g7' } },
          { id: 'never-merged', data: { name: 'B', teacherId: 'teacher-1' } },
        ],
      })
    );

    const swept = plan.operations
      .filter((op) => op.kind === 'remove_legacy_profile_projection_fields')
      .map((op) => (op as { canonicalProfileId: string }).canonicalProfileId);
    expect(swept).toEqual(['canonical-1', 'never-merged']);
  });

  it('sweeps linked accounts too, because that is the field that fails silently', () => {
    const plan = planLegacyStudentRetirement(
      input({
        linkedUsers: [
          { id: 'student:canonical-1', data: { studentId: 'canonical-1', classId: 'class-g7' } },
          { id: 'parent:canonical-1', data: { studentId: 'canonical-1' } },
        ],
      })
    );

    const swept = plan.operations
      .filter((op) => op.kind === 'remove_legacy_linked_user_projection_fields')
      .map((op) => (op as { userDocumentId: string }).userDocumentId);
    expect(swept).toEqual(['student:canonical-1']);
  });

  it('plans nothing at all while a center-wide blocker stands', () => {
    const plan = planLegacyStudentRetirement(
      input({
        canonicalReadMode: 'legacy_compare',
        students: [tombstone('legacy-1'), { id: 'canonical-1', data: { classId: 'class-g7' } }],
      })
    );

    expect(plan.operations).toEqual([]);
  });

  it('orders operations deterministically so two runs plan the same thing', () => {
    const forward = planLegacyStudentRetirement(
      input({
        students: [
          tombstone('legacy-1'),
          { id: 'b', data: { classId: 'x' } },
          { id: 'a', data: { classId: 'x' } },
        ],
      })
    );
    const reversed = planLegacyStudentRetirement(
      input({
        students: [
          { id: 'a', data: { classId: 'x' } },
          { id: 'b', data: { classId: 'x' } },
          tombstone('legacy-1'),
        ],
      })
    );

    expect(JSON.stringify(forward.operations)).toBe(JSON.stringify(reversed.operations));
  });
});

describe('planLegacyStudentRetirement preservation', () => {
  it('never plans an operation against an alias, a code reservation, or a journal', () => {
    // Aliases are how an old receipt still resolves years later; runs and
    // journals are the record that any of this was reviewed at all.
    const plan = planLegacyStudentRetirement(input());
    const serialized = JSON.stringify(plan.operations);

    expect(serialized).not.toContain('student_profile_aliases');
    expect(serialized).not.toContain('student_code_registry');
    expect(serialized).not.toContain('student_profile_merge_journal');
  });

  it('fingerprints a credential by its field names, never its values', () => {
    // The plan is written to disk and read by a person; a hash or a salt in it
    // is a secret in a file that outlives the window.
    const plan = planLegacyStudentRetirement(
      input({
        students: [tombstone('legacy-1')],
        credentials: [{ id: 'legacy-1', data: {} }],
      })
    );

    const op = plan.operations.find((entry) => entry.kind === 'delete_credential_tombstone');
    expect(op).toBeDefined();
    expect(JSON.stringify(op)).not.toContain('loginPasswordHash');
  });
});
