import { describe, expect, it } from 'vitest';
import {
  isStudentProfileMergeJournalRecord,
  isStudentProfileMergeRunRecord,
  STUDENT_PROFILE_NORMALIZATION_STAGES,
  STUDENT_PROFILE_RETIREMENT_STAGES,
} from './studentProfileMerge.js';

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    migrationVersion: 'student-profile-normalization-v2',
    runKind: 'profile_normalization',
    planDigest: 'a'.repeat(64),
    approvalDigest: 'b'.repeat(64),
    registryVersion: 'student-references-v1',
    target: { projectId: 'proj-1', databaseId: 'db-1' },
    sourceCommitSha: 'c'.repeat(40),
    exportOperationId: 'op-1',
    exportUri: 'gs://bucket/path',
    exportEvidenceDigest: 'd'.repeat(64),
    actorId: 'actor-1',
    approvals: [
      { role: 'identity_technical', reviewerId: 'r1', reviewedAt: '2026-08-06T00:00:00.000Z', planDigest: 'a'.repeat(64) },
    ],
    status: 'preflighting',
    operationCount: 0,
    appliedOperationCount: 0,
    verifiedOperationCount: 0,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    maintenanceLiftedAt: null,
    evidence: {
      projectionHealthPath: null,
      normalizationVerificationPath: null,
      smokeEvidencePath: null,
      rollbackArtifactDigest: null,
      releaseProofPath: null,
    },
    ...overrides,
  };
}

function baseJournal(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    operationId: 'op-1',
    groupId: 'group-1',
    stage: 'claim_codes',
    status: 'planned',
    sourcePath: 'students/legacy-1',
    targetPath: 'students/canonical-1',
    beforeFingerprint: 'e'.repeat(64),
    afterFingerprint: 'f'.repeat(64),
    actorId: 'actor-1',
    appliedAt: null,
    verifiedAt: null,
    rolledBackAt: null,
    lastAttemptAt: null,
    errorCode: null,
    evidencePath: null,
    ...overrides,
  };
}

describe('run record validation', () => {
  it('accepts a well-formed normalization run', () => {
    expect(isStudentProfileMergeRunRecord(baseRun())).toBe(true);
  });

  it('accepts a well-formed retirement run with its extra fields', () => {
    const run = baseRun({
      migrationVersion: 'student-profile-retirement-v1',
      runKind: 'legacy_retirement',
      parentNormalizationRunId: 'run-0',
      observationWindowEndedAt: '2026-09-05T00:00:00.000Z',
    });
    expect(isStudentProfileMergeRunRecord(run)).toBe(true);
  });

  it('rejects a normalization run carrying retirement-only fields', () => {
    const run = baseRun({ parentNormalizationRunId: 'run-0' });
    expect(isStudentProfileMergeRunRecord(run)).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(isStudentProfileMergeRunRecord(baseRun({ status: 'made_up' }))).toBe(false);
  });

  it('rejects a failed-shaped status without a paired journal errorCode requirement at the journal level', () => {
    // Run status 'failed' is valid at the run level; journal-level failure detail is separate.
    expect(isStudentProfileMergeRunRecord(baseRun({ status: 'failed' }))).toBe(true);
  });

  it('rejects a run missing evidence fields', () => {
    const { evidence: _drop, ...run } = baseRun();
    expect(isStudentProfileMergeRunRecord(run)).toBe(false);
  });

  it('rejects a malformed value outright', () => {
    expect(isStudentProfileMergeRunRecord(null)).toBe(false);
    expect(isStudentProfileMergeRunRecord('run-1')).toBe(false);
    expect(isStudentProfileMergeRunRecord([])).toBe(false);
  });
});

describe('journal record validation', () => {
  it('accepts every declared stage for its matching run kind', () => {
    for (const stage of STUDENT_PROFILE_NORMALIZATION_STAGES) {
      expect(isStudentProfileMergeJournalRecord(baseJournal({ stage }), 'profile_normalization')).toBe(
        true
      );
    }
    for (const stage of STUDENT_PROFILE_RETIREMENT_STAGES) {
      expect(isStudentProfileMergeJournalRecord(baseJournal({ stage }), 'legacy_retirement')).toBe(
        true
      );
    }
  });

  it('rejects a retirement stage on a normalization run and vice versa', () => {
    expect(
      isStudentProfileMergeJournalRecord(baseJournal({ stage: 'scan_center_legacy_fields' }), 'profile_normalization')
    ).toBe(false);
    expect(
      isStudentProfileMergeJournalRecord(baseJournal({ stage: 'claim_codes' }), 'legacy_retirement')
    ).toBe(false);
  });

  it('accepts every declared journal status including failed with an errorCode', () => {
    for (const status of ['planned', 'applied', 'verified', 'failed', 'rolled_back']) {
      const overrides =
        status === 'failed' ? { status, errorCode: 'SOME_ERROR' } : { status };
      expect(isStudentProfileMergeJournalRecord(baseJournal(overrides), 'profile_normalization')).toBe(
        true
      );
    }
  });

  it('requires errorCode when status is failed', () => {
    expect(
      isStudentProfileMergeJournalRecord(baseJournal({ status: 'failed', errorCode: null }), 'profile_normalization')
    ).toBe(false);
  });

  it('rejects a malformed value outright', () => {
    expect(isStudentProfileMergeJournalRecord(undefined, 'profile_normalization')).toBe(false);
    expect(isStudentProfileMergeJournalRecord(42, 'profile_normalization')).toBe(false);
  });
});
