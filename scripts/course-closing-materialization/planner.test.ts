import { describe, expect, it } from 'vitest';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';
import { planCourseClosingMaterialization } from './planner.js';

const generatedAt = '2026-07-27T00:00:00.000Z';

function storedDocument(type: 'evaluation' | 'tuition', status = 'not_requested') {
  return {
    type,
    status,
    templateVersion: 1,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 0,
  };
}

function record(id: string, overrides: Partial<CourseClosingRecord> = {}): CourseClosingRecord {
  return {
    id,
    recordVersion: 1,
    closingMonth: '2026-07',
    courseId: `course-${id}`,
    classId: 'class-1',
    className: 'Lớp kiểm thử',
    classNameNormalized: 'lop kiem thu',
    courseStartDate: '2026-03-01',
    courseEndDate: '2026-07-01',
    studentId: `student-${id}`,
    studentName: 'Nguyễn Văn An',
    studentNameNormalized: 'nguyen van an',
    studentCode: 'HS001',
    teacherId: 'teacher-1',
    teacherName: 'Giáo viên',
    evaluationDocument: storedDocument('evaluation') as any,
    tuitionDocument: storedDocument('tuition') as any,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

function sources(
  records: CourseClosingRecord[],
  notifications: Array<{ id: string; data: Record<string, unknown> }> = [],
  ledgers: Array<{ id: string; data: Record<string, unknown> }> = []
) {
  return { records, notifications, ledgers };
}

function storage(records: CourseClosingRecord[], exists: Partial<Record<string, boolean>> = {}) {
  return records.flatMap((entry) =>
    (['evaluation', 'tuition'] as const).map((documentType) => ({
      recordId: entry.id,
      documentType,
      expectedStoragePath: `course_closing_records/${entry.closingMonth}/${entry.classId}/${entry.courseId}/${entry.studentId}/${documentType}-v1.docx`,
      exists: exists[`${entry.id}:${documentType}`] || false,
    }))
  );
}

const evaluationSnapshot = {
  evaluationId: 'evaluation-1',
  evaluationVersion: 'v1',
  evaluationDate: '2026-07-01',
  scores: {
    attendance: 80,
    effort: 80,
    pronunciation: 80,
    homework: 80,
    behavior: 80,
  },
  finalExamScore: 80,
  totalScore: 80,
  classification: 'good' as const,
  positivePoints: [],
  improvementPoints: '',
};

describe('planCourseClosingMaterialization', () => {
  it('plans every document and classifies ready, stale, verified, and unavailable data', () => {
    const ready = record('ready', {
      evaluationSnapshot,
      evaluationDocument: {
        ...storedDocument('evaluation', 'ready'),
        storagePath:
          'course_closing_records/2026-07/class-1/course-ready/student-ready/evaluation-v1.docx',
        generatedAt: '2026-07-25T00:00:00.000Z',
      } as any,
    });
    const staleMetadata = record('metadata', {
      evaluationSnapshot,
      evaluationDocument: {
        ...storedDocument('evaluation', 'ready'),
        storagePath:
          'course_closing_records/2026-07/class-1/course-metadata/student-metadata/evaluation-v1.docx',
      } as any,
    });
    const stale = record('stale', {
      tuitionSnapshot: {
        noticeDate: '2026-07-01',
        amount: 1_200_000,
        paymentWindowStart: '2026-07-01',
        paymentDueDate: '2026-07-15',
        previousCourseStartDate: '2026-03-01',
        previousCourseEndDate: '2026-07-01',
        finalExamDate: '2026-07-01',
        finalExamScore: 80,
        nextCourseStartDate: '2026-07-15',
        nextCourseEndDate: '2026-11-15',
      },
      tuitionDocument: storedDocument('tuition', 'retrying') as any,
    });
    const verifiedMissingFile = record('verified', { evaluationSnapshot });
    const unavailable = record('unavailable');
    const records = [ready, staleMetadata, stale, verifiedMissingFile, unavailable];
    const plan = planCourseClosingMaterialization(
      sources(records),
      storage(records, {
        'ready:evaluation': true,
        'metadata:evaluation': true,
        'stale:tuition': true,
      }),
      generatedAt
    );

    const action = (recordId: string, documentType: 'evaluation' | 'tuition') =>
      plan.items.find((item) => item.recordId === recordId && item.documentType === documentType)
        ?.action;

    expect(action('ready', 'evaluation')).toBe('unchanged_ready');
    expect(action('metadata', 'evaluation')).toBe('repair_ready_status');
    expect(action('stale', 'tuition')).toBe('repair_ready_status');
    expect(action('verified', 'evaluation')).toBe('materialize_verified');
    expect(action('unavailable', 'evaluation')).toBe('materialize_unavailable_missing');
    expect(plan.items).toHaveLength(10);
    expect(plan.summary.total).toBe(10);
    expect(plan.blocked).toBe(false);
  });

  it('classifies matching but incomplete tuition evidence separately', () => {
    const entry = record('incomplete');
    const plan = planCourseClosingMaterialization(
      sources(
        [entry],
        [
          {
            id: 'notification-1',
            data: {
              status: 'sent',
              type: 'tuition_notice',
              courseId: entry.courseId,
              studentId: entry.studentId,
              amount: 1_200_000,
              paymentDueDate: '',
            },
          },
        ]
      ),
      storage([entry]),
      generatedAt
    );

    const item = plan.items.find((candidate) => candidate.documentType === 'tuition');
    expect(item).toMatchObject({
      action: 'materialize_unavailable_incomplete',
      unavailableReason: 'historical_source_incomplete',
    });
  });

  it('blocks the plan when required record identity is incomplete', () => {
    const invalid = record('invalid', { courseId: '' });
    const plan = planCourseClosingMaterialization(
      sources([invalid]),
      storage([invalid]),
      generatedAt
    );

    expect(plan.blocked).toBe(true);
    expect(plan.summary.conflict).toBe(2);
    expect(plan.items.every((item) => item.action === 'conflict')).toBe(true);
  });

  it('produces stable ordering and fingerprints regardless of source order', () => {
    const first = record('a');
    const second = record('b');
    const forward = planCourseClosingMaterialization(
      sources([second, first]),
      storage([second, first]),
      generatedAt
    );
    const reversed = planCourseClosingMaterialization(
      sources([first, second]),
      storage([first, second]).reverse(),
      generatedAt
    );

    expect(forward).toEqual(reversed);
    expect(forward.items[0]).toMatchObject({
      recordId: 'a',
      documentType: 'evaluation',
    });
    expect(forward.items[0].recordFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(forward.items[0].evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps personal and financial data out of the plan', () => {
    const entry = record('private');
    const plan = planCourseClosingMaterialization(
      sources(
        [entry],
        [
          {
            id: 'notification-private',
            data: {
              status: 'sent',
              type: 'tuition_notice',
              courseId: entry.courseId,
              studentId: entry.studentId,
              amount: 9_999_999,
            },
          },
        ]
      ),
      storage([entry]),
      generatedAt
    );
    const serialized = JSON.stringify(plan);

    expect(serialized).not.toContain('Nguyễn Văn An');
    expect(serialized).not.toContain('Lớp kiểm thử');
    expect(serialized).not.toContain('9999999');
  });
});
