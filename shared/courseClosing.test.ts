import { describe, expect, it } from 'vitest';
import {
  deriveCourseClosingSnapshot,
  type CourseClosingApproval,
  type CourseClosingExemption,
  type CourseClosingSendEvidence,
  type DeriveCourseClosingSnapshotInput,
} from './courseClosing.js';

const approval = (status: CourseClosingApproval['status'] = 'approved'): CourseClosingApproval => ({
  status,
  source: 'teacher',
  approvedAt: '2026-07-18T08:00:00.000Z',
  approvedBy: 'teacher-1',
  approvedByRole: 'teacher',
  rosterFingerprint: 'roster-v1',
  evaluationFingerprint: 'evaluations-v1',
  ...(status === 'invalidated'
    ? {
        invalidatedAt: '2026-07-18T09:00:00.000Z',
        invalidatedBy: 'office-1',
        invalidatedReason: 'COURSE_DATES_CHANGED' as const,
      }
    : {}),
});

const evidence = (
  studentId: string,
  overrides: Partial<CourseClosingSendEvidence> = {},
): CourseClosingSendEvidence => ({
  studentId,
  evaluationSent: false,
  rankRequired: false,
  rankSent: false,
  tuitionSent: false,
  ...overrides,
});

const input = (
  overrides: Partial<DeriveCourseClosingSnapshotInput> = {},
): DeriveCourseClosingSnapshotInput => ({
  courseId: 'course-1',
  requiredStudentIds: ['student-1'],
  completedEvaluationStudentIds: ['student-1'],
  approval: undefined,
  fingerprintsMatch: false,
  evidence: [],
  exemptions: [],
  ...overrides,
});

describe('deriveCourseClosingSnapshot status precedence', () => {
  it.each([
    {
      name: 'has no required students',
      value: input({ requiredStudentIds: [], completedEvaluationStudentIds: [] }),
      status: 'no_required_students',
    },
    {
      name: 'has a missing final evaluation',
      value: input({
        requiredStudentIds: ['student-2', 'student-1'],
        completedEvaluationStudentIds: ['student-1'],
      }),
      status: 'missing_evaluations',
    },
    {
      name: 'is ready for approval',
      value: input(),
      status: 'ready_for_approval',
    },
    {
      name: 'is stale when an approval is invalidated',
      value: input({ approval: approval('invalidated'), fingerprintsMatch: true }),
      status: 'stale',
    },
    {
      name: 'is stale when approved fingerprints no longer match',
      value: input({ approval: approval(), fingerprintsMatch: false }),
      status: 'stale',
    },
    {
      name: 'is approved before any required send',
      value: input({ approval: approval(), fingerprintsMatch: true }),
      status: 'approved',
    },
    {
      name: 'is sending after partial evidence',
      value: input({
        requiredStudentIds: ['student-1', 'student-2'],
        completedEvaluationStudentIds: ['student-1', 'student-2'],
        approval: approval(),
        fingerprintsMatch: true,
        evidence: [evidence('student-1', { evaluationSent: true })],
      }),
      status: 'sending',
    },
    {
      name: 'is completed after every requirement is sent',
      value: input({
        approval: approval(),
        fingerprintsMatch: true,
        evidence: [
          evidence('student-1', {
            evaluationSent: true,
            rankRequired: true,
            rankSent: true,
            tuitionSent: true,
            evaluationId: 'evaluation-1',
            evaluationVersion: '2026-07-18T07:00:00.000Z',
          }),
        ],
      }),
      status: 'completed',
    },
  ])('$name', ({ value, status }) => {
    expect(deriveCourseClosingSnapshot(value).status).toBe(status);
  });

  it('does not let a stale approval outrank missing evaluations', () => {
    expect(
      deriveCourseClosingSnapshot(
        input({
          completedEvaluationStudentIds: [],
          approval: approval('invalidated'),
          fingerprintsMatch: false,
        }),
      ).status,
    ).toBe('missing_evaluations');
  });
});

describe('deriveCourseClosingSnapshot canonical output', () => {
  it('deduplicates and sorts roster-derived arrays and counts only required students', () => {
    const snapshot = deriveCourseClosingSnapshot(
      input({
        requiredStudentIds: ['student-2', 'student-1', 'student-2'],
        completedEvaluationStudentIds: ['other', 'student-2', 'student-2'],
      }),
    );

    expect(snapshot.requiredStudentCount).toBe(2);
    expect(snapshot.finalEvaluationCount).toBe(1);
    expect(snapshot.missingEvaluationStudentIds).toEqual(['student-1']);
    expect(snapshot.pendingEvaluationStudentIds).toEqual(['student-1', 'student-2']);
    expect(snapshot.pendingTuitionStudentIds).toEqual(['student-1', 'student-2']);
  });

  it('uses one audited exemption for every remaining channel of that student only', () => {
    const exemptions: CourseClosingExemption[] = [
      {
        studentId: 'student-1',
        reason: 'Không còn kênh liên hệ hợp lệ',
        createdBy: 'admin-1',
        createdAt: '2026-07-18T10:00:00.000Z',
      },
    ];
    const snapshot = deriveCourseClosingSnapshot(
      input({
        requiredStudentIds: ['student-1', 'student-2'],
        completedEvaluationStudentIds: ['student-1', 'student-2'],
        approval: approval(),
        fingerprintsMatch: true,
        evidence: [
          evidence('student-1', { rankRequired: true }),
          evidence('student-2', { rankRequired: true }),
        ],
        exemptions,
      }),
    );

    expect(snapshot.exemptStudentCount).toBe(1);
    expect(snapshot.pendingEvaluationStudentIds).toEqual(['student-2']);
    expect(snapshot.pendingRankStudentIds).toEqual(['student-2']);
    expect(snapshot.pendingTuitionStudentIds).toEqual(['student-2']);
    expect(snapshot.exemptions).toEqual(exemptions);
  });

  it('keeps sent counts for exempt students and deduplicates locked evaluation IDs', () => {
    const snapshot = deriveCourseClosingSnapshot(
      input({
        approval: approval(),
        fingerprintsMatch: true,
        evidence: [
          evidence('student-1', {
            evaluationSent: true,
            rankRequired: true,
            rankSent: true,
            tuitionSent: true,
            evaluationId: 'evaluation-1',
          }),
          evidence('student-1', {
            evaluationSent: true,
            evaluationId: 'evaluation-1',
          }),
          evidence('other', {
            evaluationSent: true,
            evaluationId: 'evaluation-other',
          }),
        ],
        exemptions: [
          {
            studentId: 'student-1',
            reason: 'Đã xác minh không thể liên hệ',
            createdBy: 'admin-1',
            createdAt: '2026-07-18T10:00:00.000Z',
          },
        ],
      }),
    );

    expect(snapshot.evaluationSentCount).toBe(1);
    expect(snapshot.rankRequiredCount).toBe(1);
    expect(snapshot.rankSentCount).toBe(1);
    expect(snapshot.tuitionSentCount).toBe(1);
    expect(snapshot.lockedEvaluationIds).toEqual(['evaluation-1']);
  });

  it('copies approval metadata and reports the stored or fallback stale reason', () => {
    const invalidated = deriveCourseClosingSnapshot(
      input({ approval: approval('invalidated'), fingerprintsMatch: false }),
    );
    expect(invalidated).toMatchObject({
      status: 'stale',
      approvalValid: false,
      approvedAt: '2026-07-18T08:00:00.000Z',
      approvedBy: 'teacher-1',
      approvedByRole: 'teacher',
      staleReason: 'COURSE_DATES_CHANGED',
    });

    const mismatch = deriveCourseClosingSnapshot(
      input({ approval: approval(), fingerprintsMatch: false }),
    );
    expect(mismatch.staleReason).toBe('APPROVAL_FINGERPRINT_MISMATCH');
  });
});
