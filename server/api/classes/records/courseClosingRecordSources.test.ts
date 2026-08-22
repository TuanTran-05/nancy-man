import { describe, expect, it, vi } from 'vitest';
import {
  loadCurrentMidtermEvaluation,
  normalizeArchiveDateOnly,
  resolveCourseClosingArchiveIdentity,
} from './courseClosingRecordSources';

describe('courseClosingRecordSources', () => {
  describe('normalizeArchiveDateOnly', () => {
    it('normalizes ISO dates and Vietnamese DD/MM/YYYY dates to YYYY-MM-DD', () => {
      expect(normalizeArchiveDateOnly('2026-07-18T10:00:00.000Z', 'courseEndDate')).toBe(
        '2026-07-18'
      );
      expect(normalizeArchiveDateOnly('18/07/2026', 'courseEndDate')).toBe('2026-07-18');
      expect(normalizeArchiveDateOnly('2026-07-18', 'courseEndDate')).toBe('2026-07-18');
    });

    it('throws custom error when date is invalid or missing', () => {
      expect(() => normalizeArchiveDateOnly('', 'courseEndDate')).toThrowError(
        expect.objectContaining({
          errorCode: 'COURSE_CLOSING_RECORD_INVALID_COURSE_END_DATE',
        })
      );
      expect(() => normalizeArchiveDateOnly('invalid', 'evaluationDate')).toThrowError(
        expect.objectContaining({
          errorCode: 'COURSE_CLOSING_RECORD_INVALID_SOURCE_DATE',
        })
      );
    });
  });

  describe('resolveCourseClosingArchiveIdentity', () => {
    it('resolves identity fields, student code, teacher name, and normalized dates', async () => {
      const mockDb: any = {
        collection: (col: string) => ({
          doc: (id: string) => ({
            get: async () => {
              if (col === 'users' && id === 'teacher-1') {
                return { exists: true, data: () => ({ displayName: 'Trần Minh' }) };
              }
              return { exists: false };
            },
          }),
        }),
      };

      const context: any = {
        courseId: 'course-1',
        classData: {
          id: 'class-1',
          name: 'IELTS 6.0',
          startDate: '2026-03-18',
          endDate: '2026-07-18',
          teacherId: 'teacher-1',
        },
        studentData: {
          id: 'student-1',
          name: 'Nguyễn Văn An',
          code: 'HV001',
        },
      };

      const actor: any = { uid: 'user-office', role: 'office', name: 'Office Admin' };

      const identity = await resolveCourseClosingArchiveIdentity(mockDb, context, actor);

      expect(identity).toEqual({
        courseId: 'course-1',
        classId: 'class-1',
        className: 'IELTS 6.0',
        courseStartDate: '2026-03-18',
        courseEndDate: '2026-07-18',
        closingMonth: '2026-07',
        studentId: 'student-1',
        studentName: 'Nguyễn Văn An',
        studentCode: 'HV001',
        teacherId: 'teacher-1',
        teacherName: 'Trần Minh',
      });
    });

    it('throws COURSE_CLOSING_RECORD_INVALID_COURSE_END_DATE when class course end date is invalid', async () => {
      const mockDb: any = {};
      const context: any = {
        courseId: 'course-1',
        classData: { id: 'class-1', name: 'Class A', startDate: '2026-03-18', endDate: 'invalid' },
        studentData: { id: 'student-1', name: 'Student' },
      };

      await expect(
        resolveCourseClosingArchiveIdentity(mockDb, context, { uid: 'user-1' } as any)
      ).rejects.toMatchObject({
        errorCode: 'COURSE_CLOSING_RECORD_INVALID_COURSE_END_DATE',
      });
    });
  });

  describe('loadCurrentMidtermEvaluation', () => {
    it('queries evaluations by classId/studentId and selects the newest current midterm', async () => {
      const mockDocs = [
        {
          id: 'eval-mid-old',
          data: () => ({
            evaluationType: 'midterm',
            date: '2026-05-15',
            updatedAt: '2026-05-15T00:00:00Z',
          }),
        },
        {
          id: 'eval-mid-new',
          data: () => ({
            evaluationType: 'midterm',
            date: '2026-06-15',
            updatedAt: '2026-06-15T10:00:00Z',
          }),
        },
        {
          id: 'eval-final',
          data: () => ({
            evaluationType: 'final',
            date: '2026-07-15',
          }),
        },
      ];

      const mockDb: any = {
        collection: (col: string) => {
          expect(col).toBe('evaluations');
          return {
            where: () => ({
              where: () => ({
                get: async () => ({
                  docs: mockDocs,
                }),
              }),
            }),
          };
        },
      };

      const context: any = {
        classData: { id: 'class-1', startDate: '2026-03-01', endDate: '2026-07-18' },
        studentData: { id: 'student-1' },
      };

      const midterm = await loadCurrentMidtermEvaluation(mockDb, context);
      expect(midterm).toBeDefined();
      expect(midterm?.evaluationId).toBe('eval-mid-new');
    });

    it('returns undefined when no midterm evaluation exists', async () => {
      const mockDb: any = {
        collection: () => ({
          where: () => ({
            where: () => ({
              get: async () => ({ docs: [] }),
            }),
          }),
        }),
      };
      const context: any = {
        classData: { id: 'class-1' },
        studentData: { id: 'student-1' },
      };
      const midterm = await loadCurrentMidtermEvaluation(mockDb, context);
      expect(midterm).toBeUndefined();
    });
  });
});
