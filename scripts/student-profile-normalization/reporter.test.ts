import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createReviewedStudentProfileNormalizationPlan,
  createStudentProfileMergeApprovalDigest,
  createStudentProfileMergePlanDigest,
  escapeCsvCell,
  reserveStudentProfileNormalizationReportDir,
  writeStudentProfileNormalizationReports,
  type StudentProfileMergeApproval,
  type StudentProfileMergePlan,
} from './reporter.js';

function plan(overrides: Partial<StudentProfileMergePlan> = {}): StudentProfileMergePlan {
  return {
    schemaVersion: 1,
    auditPhase: 'final',
    runId: 'run-2026-08-07-01',
    sourceCommit: 'abc1234',
    registryVersion: 'student-references-v2',
    target: { projectId: 'edutrack-prod', databaseId: 'edutrack' },
    exportEvidence: {
      operationName: 'projects/edutrack-prod/databases/edutrack/operations/op-1',
      outputUriPrefix: 'gs://edutrack-backups/x',
      snapshotTime: '2026-08-07T01:00:00.000Z',
      evidenceDigest: 'e'.repeat(64),
    },
    rollbackArtifact: { fileName: 'student-profile-rollback-before-images.enc', digest: 'r'.repeat(64), entryCount: 2 },
    groups: [
      {
        groupId: 'g-1',
        canonicalProfileId: 'canonical-1',
        legacyProfileIds: ['legacy-1'],
        candidateKind: 'exact_code',
        evidenceFingerprint: 'f'.repeat(64),
        operations: [
          { operationId: 'op-a', stage: 'move_finance_keys', sourcePath: 'course_fee_ledgers/l-1', targetPath: 'course_fee_ledgers/l-2' },
        ],
        documentEffects: [
          {
            path: 'students/legacy-1',
            beforeFingerprint: 'b'.repeat(64),
            afterFingerprint: 'a'.repeat(64),
            restoreStrategy: 'restore_before_image',
            rollbackArtifactEntryId: 'e-1',
          },
        ],
        decisions: { fieldSources: {}, credential: { action: 'none' } },
        money: { before: { ledgerAmounts: 1_000_000 }, expectedAfter: { ledgerAmounts: 1_000_000 } },
        blockers: [],
      },
    ],
    money: { before: { ledgerAmounts: 1_000_000 }, expectedAfter: { ledgerAmounts: 1_000_000 } },
    blockers: [],
    ...overrides,
  };
}

function approval(
  role: StudentProfileMergeApproval['role'],
  reviewerId: string,
  planDigest: string
): StudentProfileMergeApproval {
  return { role, reviewerId, reviewedAt: '2026-08-07T02:00:00.000Z', planDigest };
}

describe('plan digest binding', () => {
  it('is stable for identical input and independent of key order', () => {
    const a = createStudentProfileMergePlanDigest(plan());
    const b = createStudentProfileMergePlanDigest({ ...plan() });

    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it.each([
    ['target project', { target: { projectId: 'edutrack-staging', databaseId: 'edutrack' } }],
    ['target database', { target: { projectId: 'edutrack-prod', databaseId: 'other' } }],
    ['run id', { runId: 'run-other' }],
    ['source commit', { sourceCommit: 'deadbee' }],
    ['registry version', { registryVersion: 'student-references-v3' }],
  ])('changes when the %s changes', (_label, override) => {
    expect(createStudentProfileMergePlanDigest(plan(override as Partial<StudentProfileMergePlan>))).not.toBe(
      createStudentProfileMergePlanDigest(plan())
    );
  });

  it('changes when the export evidence changes', () => {
    const mutated = plan();
    mutated.exportEvidence.evidenceDigest = 'f'.repeat(64);

    expect(createStudentProfileMergePlanDigest(mutated)).not.toBe(
      createStudentProfileMergePlanDigest(plan())
    );
  });

  it('changes when the rollback artifact digest changes', () => {
    const mutated = plan();
    mutated.rollbackArtifact.digest = 's'.repeat(64);

    expect(createStudentProfileMergePlanDigest(mutated)).not.toBe(
      createStudentProfileMergePlanDigest(plan())
    );
  });

  it('changes when a money total changes', () => {
    const mutated = plan();
    mutated.money.expectedAfter.ledgerAmounts = 999;

    expect(createStudentProfileMergePlanDigest(mutated)).not.toBe(
      createStudentProfileMergePlanDigest(plan())
    );
  });

  it('changes when a document effect fingerprint changes', () => {
    const mutated = plan();
    mutated.groups[0].documentEffects[0].afterFingerprint = 'c'.repeat(64);

    expect(createStudentProfileMergePlanDigest(mutated)).not.toBe(
      createStudentProfileMergePlanDigest(plan())
    );
  });

  it('changes when operations are reordered', () => {
    // Order is part of the plan: the executor runs them in sequence, so two
    // orderings are two different plans even with identical members.
    const mutated = plan();
    mutated.groups[0].operations.push({
      operationId: 'op-b',
      stage: 'rewrite_references',
      sourcePath: 'receipts/r-1',
      targetPath: 'receipts/r-1',
    });
    const reordered = plan();
    reordered.groups[0].operations = [...mutated.groups[0].operations].reverse();

    expect(createStudentProfileMergePlanDigest(mutated)).not.toBe(
      createStudentProfileMergePlanDigest(reordered)
    );
  });
});

describe('approval digest', () => {
  const digest = createStudentProfileMergePlanDigest(plan());

  it('is independent of the order approvals were collected in', () => {
    const forward = createStudentProfileMergeApprovalDigest({
      planDigest: digest,
      approvals: [approval('identity_technical', 'r1', digest), approval('finance', 'r2', digest)],
    });
    const backward = createStudentProfileMergeApprovalDigest({
      planDigest: digest,
      approvals: [approval('finance', 'r2', digest), approval('identity_technical', 'r1', digest)],
    });

    expect(forward).toBe(backward);
  });

  it.each([
    ['reviewer', [approval('identity_technical', 'other', digest), approval('finance', 'r2', digest)]],
    [
      'review time',
      [
        { ...approval('identity_technical', 'r1', digest), reviewedAt: '2026-08-07T03:00:00.000Z' },
        approval('finance', 'r2', digest),
      ],
    ],
  ])('changes when the %s changes', (_label, approvals) => {
    expect(
      createStudentProfileMergeApprovalDigest({ planDigest: digest, approvals })
    ).not.toBe(
      createStudentProfileMergeApprovalDigest({
        planDigest: digest,
        approvals: [approval('identity_technical', 'r1', digest), approval('finance', 'r2', digest)],
      })
    );
  });

  it('changes when the plan digest changes even with identical signatures', () => {
    const approvals = [approval('identity_technical', 'r1', digest), approval('finance', 'r2', digest)];

    expect(createStudentProfileMergeApprovalDigest({ planDigest: 'z'.repeat(64), approvals })).not.toBe(
      createStudentProfileMergeApprovalDigest({ planDigest: digest, approvals })
    );
  });
});

describe('approval gate', () => {
  const digest = createStudentProfileMergePlanDigest(plan());
  const base = {
    plan: plan(),
    planDigest: digest,
    authorizedReviewers: { identity_technical: ['r1'], finance: ['r2'], auth_security: ['r3'] },
  };

  it('accepts two distinct authorized reviewers when no credential work is planned', () => {
    const reviewed = createReviewedStudentProfileNormalizationPlan({
      ...base,
      approvals: [approval('identity_technical', 'r1', digest), approval('finance', 'r2', digest)],
    });

    expect(reviewed).toMatchObject({ approved: true, applyable: true, planDigest: digest });
    expect(reviewed.approvalDigest).toHaveLength(64);
  });

  it('refuses a plan whose digest does not match its contents', () => {
    // Catches a hand-edited manifest: the reviewer signed one thing, the file
    // now says another.
    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        planDigest: 'z'.repeat(64),
        approvals: [approval('identity_technical', 'r1', 'z'.repeat(64)), approval('finance', 'r2', 'z'.repeat(64))],
      })
    ).toThrow('STUDENT_PROFILE_PLAN_DIGEST_MISMATCH');
  });

  it('refuses a preliminary plan no matter how many signatures it carries', () => {
    const preliminary = plan({ auditPhase: 'preliminary' });
    const preliminaryDigest = createStudentProfileMergePlanDigest(preliminary);

    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        plan: preliminary,
        planDigest: preliminaryDigest,
        approvals: [
          approval('identity_technical', 'r1', preliminaryDigest),
          approval('finance', 'r2', preliminaryDigest),
        ],
      })
    ).toThrow('STUDENT_PROFILE_PLAN_NOT_FINAL');
  });

  it('refuses a plan that still carries blockers', () => {
    const blocked = plan({ blockers: [{ code: 'CREDENTIAL_AMBIGUOUS', candidateId: 'c', detail: 'd' }] });
    const blockedDigest = createStudentProfileMergePlanDigest(blocked);

    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        plan: blocked,
        planDigest: blockedDigest,
        approvals: [
          approval('identity_technical', 'r1', blockedDigest),
          approval('finance', 'r2', blockedDigest),
        ],
      })
    ).toThrow('STUDENT_PROFILE_PLAN_HAS_BLOCKERS');
  });

  it('refuses a missing required role', () => {
    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        approvals: [approval('identity_technical', 'r1', digest)],
      })
    ).toThrow('STUDENT_PROFILE_APPROVAL_ROLE_MISSING');
  });

  it('refuses one person signing for two roles', () => {
    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        authorizedReviewers: { identity_technical: ['r1'], finance: ['r1'], auth_security: ['r3'] },
        approvals: [approval('identity_technical', 'r1', digest), approval('finance', 'r1', digest)],
      })
    ).toThrow('STUDENT_PROFILE_APPROVAL_NOT_DISTINCT');
  });

  it('refuses a reviewer who is not authorized for the role they signed', () => {
    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        approvals: [approval('identity_technical', 'stranger', digest), approval('finance', 'r2', digest)],
      })
    ).toThrow('STUDENT_PROFILE_APPROVAL_UNAUTHORIZED');
  });

  it('refuses a duplicate signature for one role', () => {
    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        authorizedReviewers: { identity_technical: ['r1', 'r4'], finance: ['r2'], auth_security: ['r3'] },
        approvals: [
          approval('identity_technical', 'r1', digest),
          approval('identity_technical', 'r4', digest),
          approval('finance', 'r2', digest),
        ],
      })
    ).toThrow('STUDENT_PROFILE_APPROVAL_DUPLICATE_ROLE');
  });

  it('refuses a signature bound to a different plan digest', () => {
    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        approvals: [approval('identity_technical', 'r1', 'z'.repeat(64)), approval('finance', 'r2', digest)],
      })
    ).toThrow('STUDENT_PROFILE_APPROVAL_STALE');
  });

  it('additionally requires auth_security when credential work is planned', () => {
    const withCredential = plan();
    withCredential.groups[0].operations.push({
      operationId: 'op-c',
      stage: 'select_credentials',
      sourcePath: 'student_auth_credentials/legacy-1',
      targetPath: 'student_auth_credentials/canonical-1',
    });
    const credentialDigest = createStudentProfileMergePlanDigest(withCredential);

    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        ...base,
        plan: withCredential,
        planDigest: credentialDigest,
        approvals: [
          approval('identity_technical', 'r1', credentialDigest),
          approval('finance', 'r2', credentialDigest),
        ],
      })
    ).toThrow('STUDENT_PROFILE_APPROVAL_ROLE_MISSING');

    const reviewed = createReviewedStudentProfileNormalizationPlan({
      ...base,
      plan: withCredential,
      planDigest: credentialDigest,
      approvals: [
        approval('identity_technical', 'r1', credentialDigest),
        approval('finance', 'r2', credentialDigest),
        approval('auth_security', 'r3', credentialDigest),
      ],
    });
    expect(reviewed.approved).toBe(true);
  });
});

describe('csv escaping', () => {
  it.each(['=cmd|calc', '+1', '-1', '@SUM(A1)'])('neutralizes the formula %s', (value) => {
    expect(escapeCsvCell(value).startsWith("'")).toBe(true);
  });

  it('quotes separators and newlines without breaking the row', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });

  it('leaves an ordinary value alone', () => {
    expect(escapeCsvCell('HS260167')).toBe('HS260167');
  });
});

describe('report writing', () => {
  function freshDir() {
    return path.join(mkdtempSync(path.join(tmpdir(), 'spn-')), 'run-1');
  }

  it('writes the preliminary set and marks it non-applyable', async () => {
    const dir = freshDir();
    const paths = await writeStudentProfileNormalizationReports({
      outputDir: dir,
      plan: plan({ auditPhase: 'preliminary' }),
      inventory: { collections: [], matches: [], unknown: [] },
    });

    const planFile = JSON.parse(readFileSync(paths.planPath, 'utf8'));
    expect(planFile).toMatchObject({ approved: false, applyable: false, planDigest: null });
    expect(readFileSync(paths.reviewDecisionsTemplatePath, 'utf8')).toContain('canonical-1');
    expect(readFileSync(paths.csvPath, 'utf8')).toContain('canonical-1');
  });

  it('writes a final plan with a digest and applyable true', async () => {
    const dir = freshDir();
    const paths = await writeStudentProfileNormalizationReports({
      outputDir: dir,
      plan: plan(),
      inventory: { collections: [], matches: [], unknown: [] },
    });

    const planFile = JSON.parse(readFileSync(paths.planPath, 'utf8'));
    expect(planFile.applyable).toBe(true);
    expect(planFile.planDigest).toBe(createStudentProfileMergePlanDigest(plan()));
  });

  it('refuses to write into a directory that already exists', async () => {
    const dir = freshDir();
    await writeStudentProfileNormalizationReports({
      outputDir: dir,
      plan: plan(),
      inventory: { collections: [], matches: [], unknown: [] },
    });

    // Exclusive create: a rerun must never overwrite the evidence a reviewer
    // may already have signed against.
    await expect(
      writeStudentProfileNormalizationReports({
        outputDir: dir,
        plan: plan(),
        inventory: { collections: [], matches: [], unknown: [] },
      })
    ).rejects.toThrow('STUDENT_PROFILE_REPORT_DIR_EXISTS');
  });
});

/**
 * Reserving the output directory before the reads, not after them.
 *
 * A preliminary audit against production reads every collection the registry
 * knows and then writes its report. When the directory could not be created,
 * that failure arrived *after* the whole scan — the most expensive read in the
 * program, paid for and thrown away, with nothing to show for it.
 */
describe('reserveStudentProfileNormalizationReportDir', () => {
  it('creates the directory and its parents', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const nodePath = await import('node:path');
    const base = await mkdtemp(nodePath.join(tmpdir(), 'reserve-'));
    const target = nodePath.join(base, 'run-1', 'preliminary');

    await reserveStudentProfileNormalizationReportDir(target);

    const { stat } = await import('node:fs/promises');
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it('refuses a directory that already exists', async () => {
    // A rerun must not overwrite evidence a reviewer may already have signed
    // against, so a colliding directory is an error rather than a fresh start.
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const nodePath = await import('node:path');
    const base = await mkdtemp(nodePath.join(tmpdir(), 'reserve-'));
    const target = nodePath.join(base, 'preliminary');

    await reserveStudentProfileNormalizationReportDir(target);

    await expect(reserveStudentProfileNormalizationReportDir(target)).rejects.toThrow(
      'STUDENT_PROFILE_REPORT_DIR_EXISTS'
    );
  });
});
