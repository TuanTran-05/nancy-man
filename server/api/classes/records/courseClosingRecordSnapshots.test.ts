import { describe, expect, it } from 'vitest';
import {
  buildEvaluationArchiveSnapshot,
  buildTuitionArchiveSnapshot,
} from './courseClosingRecordSnapshots';

function makeValidTuitionSnapshotInput() {
  return {
    noticeDate: '2026-07-18',
    tuitionAmount: 2_400_000,
    paymentDueDate: '2026-08-01',
    courseStartDate: '2026-03-18',
    courseEndDate: '2026-07-18',
    finalExamDate: '2026-07-18',
    finalExamScore: 88,
    classData: {
      id: 'class-1',
      startDate: '2026-03-18',
      endDate: '2026-07-18',
    },
  };
}

describe('courseClosingRecordSnapshots', () => {
  describe('buildEvaluationArchiveSnapshot', () => {
    it('uses finalScore and captures current midterm without unrelated fields', () => {
      const snapshot = buildEvaluationArchiveSnapshot({
        finalEvaluation: {
          id: 'eval-final',
          date: '2026-07-18',
          finalScore: 88,
          totalScore: 84,
          scores: {
            attendance: 95,
            effort: 80,
            pronunciation: 82,
            homework: 78,
            behavior: 90,
          },
          positivePoints: ['Phát âm tốt'],
          improvementPoints: 'Cần tăng tốc độ phản xạ',
        },
        evaluationVersion: '2026-07-18T10:00:00.000Z',
        midtermEvaluation: {
          evaluationId: 'eval-mid',
          evaluationVersion: 'version-mid',
          data: { date: '2026-06-18', finalScore: 76 },
        },
      });

      expect(snapshot.finalExamScore).toBe(88);
      expect(snapshot.classification).toBe('good');
      expect(snapshot.midterm).toEqual({
        evaluationId: 'eval-mid',
        evaluationDate: '2026-06-18',
        examScore: 76,
      });
      expect(snapshot).not.toHaveProperty('phone');
    });

    it('falls back to totalScore and leaves midterm undefined', () => {
      const snapshot = buildEvaluationArchiveSnapshot({
        finalEvaluation: {
          id: 'eval-final',
          date: '2026-07-18',
          totalScore: 91,
          scores: {
            attendance: 100,
            effort: 90,
            pronunciation: 90,
            homework: 85,
            behavior: 90,
          },
          positivePoints: [],
          improvementPoints: '',
        },
        evaluationVersion: 'version-1',
      });
      expect(snapshot.finalExamScore).toBe(91);
      expect(snapshot.midterm).toBeUndefined();
      expect(snapshot).not.toHaveProperty('midterm');
    });

    it.each([null, ''])(
      'rejects an empty required score instead of converting %p to zero',
      (value) => {
        expect(() =>
          buildEvaluationArchiveSnapshot({
            finalEvaluation: {
              id: 'eval-final',
              date: '2026-07-18',
              totalScore: value,
              scores: {
                attendance: 100,
                effort: 90,
                pronunciation: 90,
                homework: 85,
                behavior: 90,
              },
            },
            evaluationVersion: 'version-1',
          })
        ).toThrow();
      }
    );

    it('omits an invalid midterm instead of inventing a zero score', () => {
      const snapshot = buildEvaluationArchiveSnapshot({
        finalEvaluation: {
          id: 'eval-final',
          date: '2026-07-18',
          totalScore: 91,
          scores: {
            attendance: 100,
            effort: 90,
            pronunciation: 90,
            homework: 85,
            behavior: 90,
          },
        },
        evaluationVersion: 'version-1',
        midtermEvaluation: {
          evaluationId: 'eval-mid',
          evaluationVersion: 'version-mid',
          data: { date: '2026-06-18', finalScore: '' },
        },
      });

      expect(snapshot.midterm).toBeUndefined();
    });
  });

  describe('buildTuitionArchiveSnapshot', () => {
    it('normalizes every Zalo-formatted tuition date before persistence', () => {
      const snapshot = buildTuitionArchiveSnapshot({
        ...makeValidTuitionSnapshotInput(),
        tuitionAmount: 2_400_000,
        paymentDueDate: '01/08/2026',
        schedule: {
          previousEndDate: '18/07/2026',
          startDate: '20/07/2026',
          endDate: '18/11/2026',
          dueDate: '03/08/2026',
        },
      });
      expect(snapshot.paymentDueDate).toBe('2026-08-01');
      expect(snapshot.previousCourseEndDate).toBe('2026-07-18');
      expect(snapshot.nextCourseStartDate).toBe('2026-07-20');
      expect(snapshot.nextCourseEndDate).toBe('2026-11-18');
      expect(snapshot).not.toHaveProperty('ledgerId');
    });
  });
});
