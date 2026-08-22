import { describe, expect, it } from 'vitest';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';
import { inspectCourseClosingStorage } from './storageSources.js';

const record: CourseClosingRecord = {
  id: 'course-1__student-1',
  recordVersion: 1,
  closingMonth: '2026-07',
  courseId: 'course-1',
  classId: 'class-1',
  className: 'Class 1',
  classNameNormalized: 'class 1',
  courseStartDate: '2026-03-01',
  courseEndDate: '2026-07-01',
  studentId: 'student-1',
  studentName: 'Student 1',
  studentNameNormalized: 'student 1',
  studentCode: 'HS001',
  teacherId: 'teacher-1',
  teacherName: 'Teacher 1',
  evaluationDocument: {
    type: 'evaluation',
    status: 'not_requested',
    templateVersion: 1,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 0,
  },
  tuitionDocument: {
    type: 'tuition',
    status: 'not_requested',
    templateVersion: 1,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 0,
  },
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
};

describe('inspectCourseClosingStorage', () => {
  it('checks both canonical document paths in stable order', async () => {
    const checked: string[] = [];
    const result = await inspectCourseClosingStorage([record], async (storagePath) => {
      checked.push(storagePath);
      return storagePath.endsWith('/evaluation-v1.docx');
    });

    expect(checked).toEqual([
      'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
      'course_closing_records/2026-07/class-1/course-1/student-1/tuition-v1.docx',
    ]);
    expect(result).toEqual([
      {
        recordId: record.id,
        documentType: 'evaluation',
        expectedStoragePath: checked[0],
        exists: true,
      },
      {
        recordId: record.id,
        documentType: 'tuition',
        expectedStoragePath: checked[1],
        exists: false,
      },
    ]);
  });
});
