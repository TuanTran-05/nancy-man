import { describe, expect, it } from 'vitest';
import {
  assertPreservesRetirementEvidence,
  buildLegacyStudentRetirementReport,
  digestLegacyStudentRetirementPlan,
  assertLegacyStudentRetirementApproved,
} from './reporter.js';
import type { LegacyStudentRetirementPlan } from './types.js';

function plan(overrides: Partial<LegacyStudentRetirementPlan> = {}): LegacyStudentRetirementPlan {
  return {
    schemaVersion: 1,
    migrationId: 'legacy-student-profile-retirement-v1',
    runId: 'ret-1',
    generatedAt: '2026-09-15T10:00:00.000Z',
    target: { projectId: 'edutrack', databaseId: '(default)' },
    sourceCommitSha: 'abc1234',
    exportOperationId: 'export-1',
    latestHealthAuditId: 'audit-1',
    dailyGreenAuditIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    approved: false,
    candidates: [
      {
        legacyProfileId: 'legacy-1',
        canonicalProfileId: 'canonical-1',
        mergeRunId: 'run-0',
        mergedAt: '2026-08-01T00:00:00.000Z',
        ageInDays: 45,
        eligible: true,
        blockers: [],
      },
    ],
    blockers: [],
    operations: [
      {
        kind: 'delete_profile_tombstone',
        documentId: 'legacy-1',
        beforeFingerprint: 'f'.repeat(64),
      },
    ],
    ...overrides,
  };
}

describe('buildLegacyStudentRetirementReport', () => {
  it('summarises candidates and operations for a human to read', () => {
    const report = buildLegacyStudentRetirementReport(plan());

    expect(report.summary).toMatchObject({
      runId: 'ret-1',
      candidates: 1,
      eligible: 1,
      blocked: 0,
      operations: { delete_profile_tombstone: 1 },
    });
  });

  it('lists every blocker rather than counting them', () => {
    // The count tells an operator to stop; only the list tells them what to
    // fix.
    const report = buildLegacyStudentRetirementReport(
      plan({
        operations: [],
        blockers: [{ code: 'DAILY_AUDIT_GAP', detail: 'no daily audit for 2026-09-12' }],
        candidates: [
          {
            legacyProfileId: 'legacy-1',
            canonicalProfileId: 'canonical-1',
            mergeRunId: 'run-0',
            mergedAt: '2026-09-10T00:00:00.000Z',
            ageInDays: 5,
            eligible: false,
            blockers: [
              { code: 'AGE_LT_30_CALENDAR_DAYS', documentId: 'legacy-1', detail: '5 day(s)' },
            ],
          },
        ],
      })
    );

    expect(report.lines.join('\n')).toContain('no daily audit for 2026-09-12');
    expect(report.lines.join('\n')).toContain('AGE_LT_30_CALENDAR_DAYS (legacy-1)');
    expect(report.summary.blocked).toBe(1);
  });

  it('digests the same plan to the same value regardless of key order', () => {
    // The review is the expensive part. Making an operator re-read an
    // identical plan because a key order shifted teaches them to stop reading.
    const forward = plan();
    const reordered = Object.fromEntries(
      Object.entries(forward).reverse()
    ) as LegacyStudentRetirementPlan;

    expect(digestLegacyStudentRetirementPlan(forward)).toBe(
      digestLegacyStudentRetirementPlan(reordered)
    );
  });

  it('digests differently when an operation changes', () => {
    const changed = plan({
      operations: [
        { kind: 'delete_profile_tombstone', documentId: 'legacy-2', beforeFingerprint: 'f'.repeat(64) },
      ],
    });

    expect(digestLegacyStudentRetirementPlan(plan())).not.toBe(
      digestLegacyStudentRetirementPlan(changed)
    );
  });
});

describe('assertPreservesRetirementEvidence', () => {
  it('accepts a plan that touches only profiles, credentials, and linked users', () => {
    expect(() => assertPreservesRetirementEvidence(plan())).not.toThrow();
  });

  it('refuses a plan that would touch an alias or the code registry', () => {
    // Aliases are how an old receipt still resolves to the right child years
    // later; the report is what a human approves, so a forbidden operation
    // must not be printed as if it were normal.
    expect(() =>
      assertPreservesRetirementEvidence(
        plan({
          operations: [
            {
              kind: 'delete_profile_tombstone',
              documentId: 'student_profile_aliases/legacy-1',
              beforeFingerprint: 'f'.repeat(64),
            },
          ],
        })
      )
    ).toThrow('STUDENT_RETIREMENT_PRESERVED_COLLECTION_TOUCHED');
  });

  it('refuses a plan that would touch the merge journal', () => {
    expect(() =>
      assertPreservesRetirementEvidence(
        plan({
          operations: [
            {
              kind: 'delete_profile_tombstone',
              documentId: 'student_profile_merge_journal/j1',
              beforeFingerprint: 'f'.repeat(64),
            },
          ],
        })
      )
    ).toThrow('student_profile_merge_journal');
  });
});

describe('assertLegacyStudentRetirementApproved', () => {
  const basePlan = plan({
    operations: [
      {
        kind: 'delete_profile_tombstone',
        documentId: 'legacy-1',
        beforeFingerprint: 'f'.repeat(64),
      },
    ],
  });
  
  const baseApproval = {
    planDigest: 'will-be-replaced',
    approvalDigest: 'a'.repeat(64),
    auditPhase: 'audit-final',
    approvals: {
      identity_technical: 'r1',
      finance: 'r2',
    },
  };

  it('accepts a valid approval', () => {
    const validApproval = { ...baseApproval, planDigest: digestLegacyStudentRetirementPlan(basePlan) };
    expect(() => assertLegacyStudentRetirementApproved(basePlan, validApproval as any)).not.toThrow();
  });

  it('refuses if the plan digest does not match', () => {
    const invalidApproval = { ...baseApproval, planDigest: 'wrong-digest' };
    expect(() => assertLegacyStudentRetirementApproved(basePlan, invalidApproval as any)).toThrow('APPROVAL_DIGEST_MISMATCH');
  });

  it('refuses if identity_technical or finance is missing', () => {
    const validDigest = digestLegacyStudentRetirementPlan(basePlan);
    expect(() => assertLegacyStudentRetirementApproved(basePlan, { ...baseApproval, planDigest: validDigest, approvals: { finance: 'r2' } } as any)).toThrow('MISSING_APPROVAL: identity_technical');
    expect(() => assertLegacyStudentRetirementApproved(basePlan, { ...baseApproval, planDigest: validDigest, approvals: { identity_technical: 'r1' } } as any)).toThrow('MISSING_APPROVAL: finance');
  });

  it('refuses if reviewers are not distinct', () => {
    const validDigest = digestLegacyStudentRetirementPlan(basePlan);
    const nonDistinctApproval = { ...baseApproval, planDigest: validDigest, approvals: { identity_technical: 'r1', finance: 'r1' } };
    expect(() => assertLegacyStudentRetirementApproved(basePlan, nonDistinctApproval as any)).toThrow('APPROVALS_NOT_DISTINCT');
  });

  it('requires auth_security if credential deletion exists', () => {
    const credPlan = plan({
      operations: [
        {
          kind: 'delete_credential_tombstone',
          documentId: 'legacy-1',
          nonSecretFingerprint: 'f'.repeat(64),
        },
      ],
    });
    const validDigest = digestLegacyStudentRetirementPlan(credPlan);
    
    // Missing auth_security
    expect(() => assertLegacyStudentRetirementApproved(credPlan, { ...baseApproval, planDigest: validDigest } as any)).toThrow('MISSING_APPROVAL: auth_security');
    
    // Has auth_security but not distinct
    expect(() => assertLegacyStudentRetirementApproved(credPlan, { ...baseApproval, planDigest: validDigest, approvals: { identity_technical: 'r1', finance: 'r2', auth_security: 'r1' } } as any)).toThrow('APPROVALS_NOT_DISTINCT');
    
    // Valid
    expect(() => assertLegacyStudentRetirementApproved(credPlan, { ...baseApproval, planDigest: validDigest, approvals: { identity_technical: 'r1', finance: 'r2', auth_security: 'r3' } } as any)).not.toThrow();
  });
});
