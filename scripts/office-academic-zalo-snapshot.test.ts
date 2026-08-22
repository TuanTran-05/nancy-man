import { describe, expect, it } from 'vitest';
import {
  buildSnapshotSendPlan,
  createSnapshot,
  verifySnapshot,
  type OfficeAcademicZaloSnapshotPayload,
  type SnapshotExpectations,
} from './office-academic-zalo-snapshot';

const expectations: SnapshotExpectations = {
  classId: 'MbEjkY4bZPvUt9ykRpPu',
  tuitionAmount: 1_200_000,
  evaluationCount: 13,
  rankCount: 2,
  tuitionCount: 13,
};

function validPayload(): OfficeAcademicZaloSnapshotPayload {
  return {
    schemaVersion: 1,
    createdAt: '2026-08-04T04:00:00.000Z',
    classId: expectations.classId,
    className: 'G3 - Huynh Le T4-T6',
    courseStartDate: '2026-05-13',
    courseEndDate: '2026-07-31',
    tuitionAmount: expectations.tuitionAmount,
    resendBy: 'scheduled-resend-g3-huynh-le-2026-08-05',
    expectedCounts: { evaluation: 13, rank: 2, tuition: 13 },
    recipients: Array.from({ length: 13 }, (_, index) => ({
      studentDocId: `student-${index + 1}`,
      studentCode: `HS${String(index + 1).padStart(6, '0')}`,
      studentName: `Student ${index + 1}`,
      phone: `849${String(index + 1).padStart(8, '0')}`,
      evaluation: {
        templateData: {
          student_name: `Student ${index + 1}`,
          student_code: `HS${String(index + 1).padStart(6, '0')}`,
          course_end_date: '31/07/2026',
          final_grade: '9',
          good: 'Good',
          bad: 'None',
        },
      },
      rank:
        index < 2
          ? {
              templateData: {
                student_name: `Student ${index + 1}`,
                student_code: `HS${String(index + 1).padStart(6, '0')}`,
                rank: index === 0 ? 'Hạng nhất' : 'Hạng nhì',
                discount: index === 0 ? 20 : 10,
              },
            }
          : null,
      tuition: {
        templateData: {
          student_name: `Student ${index + 1}`,
          student_code: `HS${String(index + 1).padStart(6, '0')}`,
          previous_end_date: '31/07/2026',
          start_date: '01/08/2026',
          end_date: '31/10/2026',
          amount: 1_200_000,
          due_date: '08/08/2026',
        },
      },
    })),
  };
}

describe('office academic Zalo snapshot', () => {
  it('creates and verifies the exact frozen campaign', () => {
    const snapshot = createSnapshot(validPayload());
    expect(verifySnapshot(snapshot, expectations)).toEqual({
      evaluationCount: 13,
      rankCount: 2,
      tuitionCount: 13,
    });
    expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects payload tampering', () => {
    const snapshot = createSnapshot(validPayload());
    const tampered = structuredClone(snapshot);
    tampered.payload.recipients[0].phone = '84999999999';
    expect(() => verifySnapshot(tampered, expectations)).toThrow('Snapshot checksum mismatch');
  });

  it.each([
    ['duplicate student IDs', (payload: OfficeAcademicZaloSnapshotPayload) => {
      payload.recipients[1].studentDocId = payload.recipients[0].studentDocId;
    }, 'Duplicate student document ID'],
    ['duplicate student codes', (payload: OfficeAcademicZaloSnapshotPayload) => {
      payload.recipients[1].studentCode = payload.recipients[0].studentCode;
    }, 'Duplicate student code'],
    ['invalid phones', (payload: OfficeAcademicZaloSnapshotPayload) => {
      payload.recipients[0].phone = '123';
    }, 'Invalid normalized VN phone'],
    ['missing evaluation fields', (payload: OfficeAcademicZaloSnapshotPayload) => {
      delete payload.recipients[0].evaluation.templateData.student_name;
    }, 'Missing evaluation template field student_name'],
  ])('rejects %s', (_name, mutate, message) => {
    const payload = validPayload();
    mutate(payload);
    expect(() => verifySnapshot(createSnapshot(payload), expectations)).toThrow(message);
  });

  it('rejects mismatched amount and message counts', () => {
    expect(() =>
      verifySnapshot(createSnapshot(validPayload()), { ...expectations, tuitionAmount: 1_100_000 })
    ).toThrow('Expected tuition 1100000, received 1200000');
    expect(() =>
      verifySnapshot(createSnapshot(validPayload()), { ...expectations, rankCount: 3 })
    ).toThrow('Expected rank count 3, received 2');
  });

  it('builds evaluation, optional rank, then tuition per recipient', () => {
    const snapshot = createSnapshot(validPayload());
    const plan = buildSnapshotSendPlan(snapshot);
    expect(plan).toHaveLength(28);
    expect(plan.slice(0, 3).map((row) => row.type)).toEqual([
      'evaluation_notice',
      'rank_achievement',
      'tuition_notice',
    ]);
    expect(plan.slice(3, 6).map((row) => row.type)).toEqual([
      'evaluation_notice',
      'rank_achievement',
      'tuition_notice',
    ]);
    expect(plan.slice(6, 8).map((row) => row.type)).toEqual([
      'evaluation_notice',
      'tuition_notice',
    ]);
  });
});
