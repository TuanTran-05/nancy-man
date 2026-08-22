import { describe, expect, it, vi } from 'vitest';
import {
  COURSE_CLOSING_DOCX_MIME,
  type ClosingDocumentType,
  type CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';
import { createMaterializationRecordFingerprint } from './planner.js';
import { applyCourseClosingMaterialization } from './runner.js';
import type { MaterializationAction, MaterializationRunPlan } from './types.js';

const now = '2026-07-27T00:00:00.000Z';
const target = {
  actualProjectId: 'proj',
  actualDatabaseId: 'db',
  confirmProjectId: 'proj',
  confirmDatabaseId: 'db',
  reviewedDigest: 'digest',
};

function record(overrides: Partial<CourseClosingRecord> = {}): CourseClosingRecord {
  return {
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
    ...overrides,
  };
}

function setNested(target: Record<string, any>, dottedPath: string, value: unknown) {
  const parts = dottedPath.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ||= {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)!] = value;
}

function dbWith(initial: CourseClosingRecord[]) {
  const documents = Object.fromEntries(
    initial.map((entry) => [entry.id, structuredClone(entry)])
  ) as Record<string, CourseClosingRecord>;
  const update = (id: string, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      setNested(documents[id] as any, key, value);
    }
  };
  const ref = (id: string) => ({
    id,
    get: async () => ({
      exists: Boolean(documents[id]),
      data: () => structuredClone(documents[id]),
    }),
    update: async (patch: Record<string, unknown>) => update(id, patch),
  });
  const db = {
    collection: () => ({ doc: ref }),
    runTransaction: async (callback: any) =>
      callback({
        get: async (documentRef: ReturnType<typeof ref>) => documentRef.get(),
        update: (documentRef: ReturnType<typeof ref>, patch: Record<string, unknown>) =>
          update(documentRef.id, patch),
      }),
  } as any;
  return { db, documents };
}

function planItem(
  entry: CourseClosingRecord,
  documentType: ClosingDocumentType,
  action: MaterializationAction,
  extra: Record<string, unknown> = {}
) {
  return {
    recordId: entry.id,
    documentType,
    templateVersion: 1 as const,
    action,
    expectedStoragePath: `course_closing_records/${entry.closingMonth}/${entry.classId}/${entry.courseId}/${entry.studentId}/${documentType}-v1.docx`,
    recordFingerprint: createMaterializationRecordFingerprint(entry, documentType),
    evidenceFingerprint: 'a'.repeat(64),
    ...extra,
  };
}

function plan(items: ReturnType<typeof planItem>[], blocked = false): MaterializationRunPlan {
  return {
    generatedAt: now,
    blocked,
    items,
    summary: {
      total: items.length,
      evaluation: items.filter((item) => item.documentType === 'evaluation').length,
      tuition: items.filter((item) => item.documentType === 'tuition').length,
      unchanged_ready: 0,
      repair_ready_status: 0,
      materialize_verified: 0,
      materialize_unavailable_missing: 0,
      materialize_unavailable_incomplete: 0,
      conflict: blocked ? 1 : 0,
    },
  };
}

describe('applyCourseClosingMaterialization', () => {
  it('blocks every write when the reviewed plan contains a conflict', async () => {
    const entry = record();
    const materialize = vi.fn();

    await expect(
      applyCourseClosingMaterialization(
        dbWith([entry]).db,
        plan([planItem(entry, 'evaluation', 'conflict')], true),
        target,
        {
          materialize,
          fileExists: async () => false,
          now: () => now,
        }
      )
    ).rejects.toThrow('MATERIALIZE_PLAN_BLOCKED_BY_CONFLICT');
    expect(materialize).not.toHaveBeenCalled();
  });

  it('repairs stale DocumentStore status without overwriting an existing object', async () => {
    const entry = record({
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
      tuitionDocument: {
        type: 'tuition',
        status: 'retrying',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 2,
      },
    });
    const state = dbWith([entry]);
    const materialize = vi.fn();
    const result = await applyCourseClosingMaterialization(
      state.db,
      plan([planItem(entry, 'tuition', 'repair_ready_status')]),
      target,
      {
        materialize,
        fileExists: async () => true,
        now: () => now,
      }
    );

    expect(result.repaired_ready_status).toBe(1);
    expect(state.documents[entry.id].tuitionDocument).toMatchObject({
      status: 'ready',
      storagePath: 'course_closing_records/2026-07/class-1/course-1/student-1/tuition-v1.docx',
    });
    expect(materialize).not.toHaveBeenCalled();
  });

  it('marks incomplete historical data unavailable before materializing', async () => {
    const entry = record();
    const state = dbWith([entry]);
    const materialize = vi.fn(async () => {
      expect(state.documents[entry.id].tuitionDataAvailability).toEqual({
        status: 'unavailable',
        reason: 'historical_source_incomplete',
        assessedAt: now,
      });
      expect(state.documents[entry.id].tuitionDocument.status).toBe('pending');
    });
    const result = await applyCourseClosingMaterialization(
      state.db,
      plan([
        planItem(entry, 'tuition', 'materialize_unavailable_incomplete', {
          unavailableReason: 'historical_source_incomplete',
        }),
      ]),
      target,
      {
        materialize: materialize as any,
        fileExists: async () => false,
        now: () => now,
      }
    );

    expect(result.materialized).toBe(1);
    expect(materialize).toHaveBeenCalledOnce();
  });

  it('rejects a record that changed after the reviewed plan', async () => {
    const planned = record();
    const drifted = record({ studentName: 'Changed Student' });
    const materialize = vi.fn();
    const result = await applyCourseClosingMaterialization(
      dbWith([drifted]).db,
      plan([planItem(planned, 'evaluation', 'materialize_unavailable_missing')]),
      target,
      {
        materialize,
        fileExists: async () => false,
        now: () => now,
      }
    );

    expect(result.results[0]).toMatchObject({
      outcome: 'conflicted',
      errorCode: 'RECORD_FINGERPRINT_CHANGED',
    });
    expect(materialize).not.toHaveBeenCalled();
  });

  it('leaves a reviewed ready artifact unchanged', async () => {
    const entry = record({
      evaluationDocument: {
        type: 'evaluation',
        status: 'ready',
        templateVersion: 1,
        mimeType: COURSE_CLOSING_DOCX_MIME,
        attempts: 1,
        storagePath: 'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
      },
    });
    const state = dbWith([entry]);
    const before = structuredClone(state.documents[entry.id]);
    const result = await applyCourseClosingMaterialization(
      state.db,
      plan([planItem(entry, 'evaluation', 'unchanged_ready')]),
      target,
      {
        materialize: vi.fn(),
        fileExists: async () => true,
        now: () => now,
      }
    );

    expect(result.unchanged_ready).toBe(1);
    expect(state.documents[entry.id]).toEqual(before);
  });
});
