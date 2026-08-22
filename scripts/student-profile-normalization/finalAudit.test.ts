import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprintDocumentProjection } from './canonicalJson.js';
import { finalizeStudentProfileNormalizationPlan } from './finalAudit.js';
import {
  createStudentProfileMergePlanDigest,
  type StudentProfileMergePlan,
  type StudentProfileMergePlanOperation,
} from './reporter.js';
import { decryptRollbackBeforeImages } from './rollbackArtifact.js';

const KEY = randomBytes(32).toString('base64');
const NOW = new Date('2026-08-09T10:00:00.000Z');
const TARGET = { projectId: 'edutrack', databaseId: '(default)' };
const EXPORT = {
  name: 'projects/edutrack/databases/(default)/operations/op-1',
  done: true,
  metadata: {
    operationState: 'SUCCESSFUL',
    outputUriPrefix: 'gs://backups/run-1',
    startTime: '2026-08-09T08:58:00.000Z',
    endTime: '2026-08-09T09:01:00.000Z',
    snapshotTime: '2026-08-09T09:00:00.000Z',
  },
};

function operation(
  stage: string,
  targetPath: string,
  write: NonNullable<StudentProfileMergePlanOperation['write']>,
  sourcePath: string | null = null
): StudentProfileMergePlanOperation {
  return {
    operationId: `logical-${stage}`,
    stage,
    sourcePath,
    targetPath,
    registryEntryId: `${stage}.registry`,
    kind: 'test',
    write,
  };
}

function plan(): StudentProfileMergePlan {
  return {
    schemaVersion: 1,
    auditPhase: 'final',
    runId: 'run-1',
    sourceCommit: 'a'.repeat(40),
    registryVersion: 'student-references-v2',
    target: TARGET,
    exportEvidence: null,
    rollbackArtifact: null,
    groups: [
      {
        groupId: 'group-1',
        canonicalProfileId: 'canonical-1',
        legacyProfileIds: ['legacy-1'],
        candidateKind: 'legacy_soft_merge',
        evidenceFingerprint: 'e'.repeat(64),
        operations: [
          operation('create_aliases', 'student_profile_aliases/legacy-1', {
            mode: 'set',
            payload: { canonicalProfileId: 'canonical-1' },
          }),
          operation('rewrite_nested', 'students/canonical-1', {
            mode: 'patch',
            payload: {
              'metadata.owner.studentId': 'canonical-1',
              'courseJoins.0.studentId': 'canonical-1',
              'newParent.child': 'canonical-1',
            },
          }),
          operation(
            'move_finance_keys',
            'course_fee_ledgers/canonical-1_c-1',
            { mode: 'copy_source' },
            'course_fee_ledgers/legacy-1_c-1'
          ),
          operation('rebuild_projections', 'accounting_student_summaries/legacy-1', {
            mode: 'delete',
          }),
        ],
        documentEffects: [],
        decisions: {},
        money: { before: { ledgerAmounts: 1000 }, expectedAfter: { ledgerAmounts: 1000 } },
        blockers: [],
      },
    ],
    money: { before: { ledgerAmounts: 1000 }, expectedAfter: { ledgerAmounts: 1000 } },
    blockers: [],
  };
}

const canonicalBefore = {
  name: 'Student',
  searchTokens: ['student'],
  loginPasswordHash: 'must-never-enter-the-artifact',
  metadata: { owner: { studentId: 'legacy-1', keep: true } },
  courseJoins: [{ studentId: 'legacy-1', classId: 'c-1' }],
};

function documents(latest = '2026-08-09T08:59:00.000Z') {
  return [
    { path: 'student_profile_aliases/legacy-1', data: null, updateTime: null },
    { path: 'students/canonical-1', data: canonicalBefore, updateTime: latest },
    {
      path: 'course_fee_ledgers/legacy-1_c-1',
      data: { studentId: 'legacy-1', amount: 1000 },
      updateTime: latest,
    },
    { path: 'course_fee_ledgers/canonical-1_c-1', data: null, updateTime: null },
    {
      path: 'accounting_student_summaries/legacy-1',
      data: { studentId: 'legacy-1', total: 1000, searchTokens: ['student', 'hs260'] },
      updateTime: latest,
    },
  ];
}

describe('final audit materialization', () => {
  it('binds whole-document fingerprints, move effects, and encrypted before-images', () => {
    const result = finalizeStudentProfileNormalizationPlan({
      plan: plan(),
      documents: documents(),
      exportOperation: EXPORT,
      expectedExportUri: 'gs://backups/run-1',
      now: NOW,
      rollbackKeyBase64: KEY,
    });

    const operations = result.plan.groups[0].operations;
    const patch = operations[1];
    const expectedPatched = {
      name: 'Student',
      searchTokens: ['student'],
      loginPasswordHash: 'must-never-enter-the-artifact',
      metadata: { owner: { studentId: 'canonical-1', keep: true } },
      courseJoins: [{ studentId: 'canonical-1', classId: 'c-1' }],
      newParent: { child: 'canonical-1' },
    };
    expect(patch.targetBeforeFingerprint).toBe(fingerprintDocumentProjection(canonicalBefore));
    expect(patch.expectedAfterFingerprint).toBe(fingerprintDocumentProjection(expectedPatched));
    expect(operations[3].expectedAfterFingerprint).toBeNull();
    expect(operations.slice(1).map((entry) => entry.dependsOn)).toEqual([
      [operations[0].operationId],
      [operations[1].operationId],
      [operations[2].operationId],
    ]);

    const effects = result.plan.groups[0].documentEffects;
    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'course_fee_ledgers/legacy-1_c-1',
          afterFingerprint: null,
        }),
        expect.objectContaining({
          path: 'course_fee_ledgers/canonical-1_c-1',
          beforeFingerprint: null,
        }),
        expect.objectContaining({
          path: 'accounting_student_summaries/legacy-1',
          afterFingerprint: null,
        }),
      ])
    );

    const planPreimageDigest = createStudentProfileMergePlanDigest({
      ...result.plan,
      rollbackArtifact: null,
    });
    const restored = decryptRollbackBeforeImages({
      artifact: result.artifact,
      aad: { ...TARGET, runId: 'run-1', planPreimageDigest },
      keyBase64: KEY,
    });
    expect(restored.map((entry) => entry.path).sort()).toEqual([
      'accounting_student_summaries/legacy-1',
      'course_fee_ledgers/legacy-1_c-1',
      'students/canonical-1',
    ]);
    const studentImage = restored.find((entry) => entry.path === 'students/canonical-1');
    expect(studentImage).toEqual({
      entryId: expect.any(String),
      path: 'students/canonical-1',
      restoreMode: 'patch',
      before: {
        'courseJoins.0.studentId': 'legacy-1',
        'metadata.owner.studentId': 'legacy-1',
      },
      absentFieldPaths: ['newParent'],
    });
    expect(JSON.stringify(restored)).not.toContain('must-never-enter-the-artifact');
    expect(JSON.stringify(studentImage)).not.toContain('searchTokens');
    expect(
      restored.find((entry) => entry.path === 'accounting_student_summaries/legacy-1')?.before
    ).toMatchObject({ searchTokens: ['student', 'hs260'] });
    expect(result.plan.rollbackArtifact?.digest).toBe(result.artifact.digest);
  });

  it('preserves a boolean password-change policy flag on a linked-user re-key', () => {
    const source = plan();
    source.groups[0].operations = [
      operation(
        'rewrite_linked_users',
        'users/student:canonical-1',
        { mode: 'copy_source' },
        'users/legacy-auth-uid'
      ),
    ];
    const result = finalizeStudentProfileNormalizationPlan({
      plan: source,
      documents: [
        {
          path: 'users/legacy-auth-uid',
          data: {
            uid: 'legacy-auth-uid',
            studentId: 'legacy-1',
            role: 'student',
            forcePasswordChange: true,
          },
          updateTime: '2026-08-09T08:59:00.000Z',
        },
        { path: 'users/student:canonical-1', data: null, updateTime: null },
      ],
      exportOperation: EXPORT,
      expectedExportUri: 'gs://backups/run-1',
      now: NOW,
      rollbackKeyBase64: KEY,
    });
    const planPreimageDigest = createStudentProfileMergePlanDigest({
      ...result.plan,
      rollbackArtifact: null,
    });
    const restored = decryptRollbackBeforeImages({
      artifact: result.artifact,
      aad: { ...TARGET, runId: 'run-1', planPreimageDigest },
      keyBase64: KEY,
    });
    expect(restored.find((entry) => entry.path === 'users/legacy-auth-uid')?.before).toMatchObject({
      forcePasswordChange: true,
    });
  });

  it('rejects an export that predates an affected document update', () => {
    expect(() =>
      finalizeStudentProfileNormalizationPlan({
        plan: plan(),
        documents: documents('2026-08-09T09:00:01.000Z'),
        exportOperation: EXPORT,
        expectedExportUri: 'gs://backups/run-1',
        now: NOW,
        rollbackKeyBase64: KEY,
      })
    ).toThrow('STUDENT_PROFILE_EXPORT_PRECEDES_SOURCE_WRITE');
  });

  it('rejects a copy whose source and target are the same document', () => {
    const source = plan();
    source.groups[0].operations = [
      operation(
        'bad_move',
        'course_fee_ledgers/legacy-1_c-1',
        { mode: 'copy_source' },
        'course_fee_ledgers/legacy-1_c-1'
      ),
    ];
    expect(() =>
      finalizeStudentProfileNormalizationPlan({
        plan: source,
        documents: documents(),
        exportOperation: EXPORT,
        expectedExportUri: 'gs://backups/run-1',
        now: NOW,
        rollbackKeyBase64: KEY,
      })
    ).toThrow('STUDENT_PROFILE_FINAL_AUDIT_COPY_SOURCE_EQUALS_TARGET');
  });
});
