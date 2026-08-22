import { describe, expect, it } from 'vitest';
import {
  classifyCourseResult,
  closingMonthFromCourseEnd,
  courseClosingDownloadFilename,
  courseClosingRecordId,
  courseClosingStoragePath,
  deriveCourseClosingRecordStatus,
  deriveTuitionArchiveStatus,
} from './courseClosingRecords';

describe('course closing record helpers', () => {
  it.each([
    [0, 'failing'],
    [55, 'failing'],
    [56, 'average'],
    [69, 'average'],
    [70, 'fair'],
    [79, 'fair'],
    [80, 'good'],
    [89, 'good'],
    [90, 'excellent'],
    [100, 'excellent'],
  ] as const)('classifies %s as %s', (score, expected) => {
    expect(classifyCourseResult(score)).toBe(expected);
  });

  it('derives month, id, path, and safe download filename deterministically', () => {
    expect(closingMonthFromCourseEnd('2026-07-18')).toBe('2026-07');
    expect(courseClosingRecordId('course-1', 'student-1')).toBe('course-1__student-1');
    expect(
      courseClosingStoragePath({
        closingMonth: '2026-07',
        classId: 'class-1',
        courseId: 'course-1',
        studentId: 'student-1',
        documentType: 'evaluation',
        templateVersion: 1,
      })
    ).toBe('course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx');
    expect(courseClosingDownloadFilename('Nguyễn Văn An', 'evaluation')).toBe(
      'Nguyen_Van_An_Nhan_xet_ket_khoa.docx'
    );
  });

  it('shows retry before partial and complete states', () => {
    const record = {
      evaluationDocument: { status: 'ready' },
      tuitionDocument: { status: 'retrying' },
    } as any;
    expect(deriveCourseClosingRecordStatus(record)).toBe('retrying');
  });

  it.each([
    ['retrying', 'not_requested', 'retrying'],
    ['not_requested', 'retrying', 'retrying'],
    ['retrying', 'failed', 'retrying'],
    ['failed', 'pending', 'failed'],
    ['not_requested', 'failed', 'failed'],
    ['ready', 'ready', 'complete'],
    ['ready', 'pending', 'missing_tuition'],
    ['ready', 'not_requested', 'missing_tuition'],
    ['pending', 'ready', 'missing_evaluation'],
    ['not_requested', 'ready', 'missing_evaluation'],
    ['pending', 'pending', 'pending'],
    ['pending', 'not_requested', 'pending'],
    ['not_requested', 'pending', 'pending'],
    ['not_requested', 'not_requested', 'not_requested'],
  ] as const)('derives %s + %s as %s', (evaluationStatus, tuitionStatus, expected) => {
    expect(
      deriveCourseClosingRecordStatus({
        evaluationDocument: { status: evaluationStatus },
        tuitionDocument: { status: tuitionStatus },
      } as any)
    ).toBe(expected);
  });

  it('never reports retrying for records that were never attempted', () => {
    const neverAttempted = ['not_requested', 'pending'] as const;
    for (const evaluationStatus of neverAttempted) {
      for (const tuitionStatus of neverAttempted) {
        expect(
          deriveCourseClosingRecordStatus({
            evaluationDocument: { status: evaluationStatus },
            tuitionDocument: { status: tuitionStatus },
          } as any)
        ).not.toBe('retrying');
      }
    }
  });

  it('derives an accounting-safe status from tuition alone', () => {
    expect(deriveTuitionArchiveStatus({ status: 'ready' } as any)).toBe('ready');
    expect(deriveTuitionArchiveStatus({ status: 'retrying' } as any)).toBe('retrying');
  });

  it('derives deterministic DOCX and HTML preview paths for the same artifact', () => {
    const input = {
      closingMonth: '2026-07',
      classId: 'class-1',
      courseId: 'course-1',
      studentId: 'student-1',
      documentType: 'evaluation' as const,
      templateVersion: 1,
    };

    expect(courseClosingStoragePath(input)).toBe(
      'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx'
    );
  });
});
