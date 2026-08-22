import { describe, expect, it } from 'vitest';
import { buildFrozenPayload, type DocumentStoreRow } from './create-office-academic-zalo-snapshot';

function fixture() {
  const classData: DocumentStoreRow = {
    id: 'MbEjkY4bZPvUt9ykRpPu',
    name: 'G3 - Huynh Le T4-T6',
    startDate: '2026-05-13',
    endDate: '2026-07-31',
    tuitionFee: 1_200_000,
    grade: 3,
    daysOfWeek: [3, 5],
    holidays: [],
  };
  const students: DocumentStoreRow[] = Array.from({ length: 15 }, (_, index) => ({
    id: `student-${index + 1}`,
    name: `Student ${index + 1}`,
    studentId: `HS${String(index + 1).padStart(6, '0')}`,
    contact: `09${String(index + 1).padStart(8, '0')}`,
    classId: classData.id,
    enrollmentStatus: index >= 13 ? 'on_leave' : 'active',
  }));
  const evaluations: DocumentStoreRow[] = students.slice(0, 13).map((student, index) => ({
    id: `evaluation-${index + 1}`,
    studentId: student.id,
    classId: classData.id,
    termId: 'current',
    evaluationType: 'final',
    date: '2026-07-31',
    finalScore: 8 + index / 10,
    positivePoints: [`Good ${index + 1}`],
    improvementPoints: index === 0 ? [] : [`Improve ${index + 1}`],
    rank: index === 0 ? 'first' : index === 1 ? 'second' : 'none',
  }));
  return { classData, students, evaluations };
}

describe('buildFrozenPayload', () => {
  it('freezes the 13 eligible recipients and all rendered message fields', () => {
    const payload = buildFrozenPayload({
      ...fixture(),
      createdAt: '2026-08-04T05:00:00.000Z',
      resendBy: 'scheduled-resend-g3-huynh-le-2026-08-05',
    });
    expect(payload.recipients).toHaveLength(13);
    expect(payload.recipients.filter((recipient) => recipient.rank)).toHaveLength(2);
    expect(payload.expectedCounts).toEqual({ evaluation: 13, rank: 2, tuition: 13 });
    expect(payload.tuitionAmount).toBe(1_200_000);
    expect(payload.recipients[0].phone).toMatch(/^84\d{9}$/);
    expect(payload.recipients[0].evaluation.templateData).toMatchObject({
      course_end_date: '31/07/2026',
      final_grade: '8',
      good: 'Good 1',
      bad: 'Khong co',
    });
    expect(payload.recipients[0].tuition.templateData).toMatchObject({
      previous_end_date: '31/07/2026',
      amount: 1_200_000,
    });
    expect(payload.recipients[0].tuition.templateData.start_date).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(payload.recipients[0].tuition.templateData.end_date).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(payload.recipients[0].tuition.templateData.due_date).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it('rejects an eligible student with an invalid phone', () => {
    const data = fixture();
    data.students[0].contact = '123';
    expect(() =>
      buildFrozenPayload({
        ...data,
        createdAt: '2026-08-04T05:00:00.000Z',
        resendBy: 'test',
      })
    ).toThrow('Invalid normalized VN phone for HS000001');
  });

  it('rejects an active student without a final evaluation', () => {
    const data = fixture();
    data.evaluations = data.evaluations.filter((evaluation) => evaluation.studentId !== 'student-3');
    expect(() =>
      buildFrozenPayload({
        ...data,
        createdAt: '2026-08-04T05:00:00.000Z',
        resendBy: 'test',
      })
    ).toThrow('Active student HS000003 has no final evaluation');
  });
});
