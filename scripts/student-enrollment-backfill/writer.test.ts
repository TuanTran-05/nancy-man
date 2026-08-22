import { describe, expect, it, vi } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  makeStudentCourseEnrollmentId,
  type StudentCourseEnrollment,
} from '../../shared/studentCourseEnrollment.js';
import { createSafeEnrollmentDigest, type SafeEnrollmentReviewedFile } from './reporter.js';
import { planSafeStudentEnrollmentBackfill } from './planner.js';
import type { SafeEnrollmentPlan, SourceDoc } from './types.js';
import {
  applySafeEnrollmentRollback,
  applySafeEnrollmentBackfill,
  fingerprintEnrollmentPayload,
  loadSafeEnrollmentDurableJournal,
  planSafeEnrollmentRollback,
  preflightSafeEnrollmentApply,
  verifySafeEnrollmentApply,
  verifySafeEnrollmentRollback,
} from './writer.js';
import type { SafeEnrollmentApplyJournalEntry } from './types.js';

type StoredDoc = { data: Record<string, unknown>; updateTime: string };

class FakeDocumentReference {
  readonly kind = 'doc';
  constructor(
    readonly db: FakeDocumentStore,
    readonly collectionName: string,
    readonly id: string
  ) {}
  get path() {
    return `${this.collectionName}/${this.id}`;
  }
  async get() {
    return this.db.snapshot(this);
  }
}

class FakeQuery {
  readonly kind = 'query';
  constructor(
    readonly db: FakeDocumentStore,
    readonly collectionName: string,
    readonly field: string,
    readonly value: unknown
  ) {}
  async get() {
    return this.db.querySnapshot(this);
  }
}

class FakeDocumentStore {
  readonly docs = new Map<string, StoredDoc>();
  transactionCount = 0;

  seed(collectionName: string, id: string, data: object, updateTime: string) {
    this.docs.set(`${collectionName}/${id}`, {
      data: structuredClone(data) as Record<string, unknown>,
      updateTime,
    });
  }

  collection(collectionName: string) {
    return {
      doc: (id: string) => new FakeDocumentReference(this, collectionName, id),
      where: (field: string, operator: string, value: unknown) => {
        if (operator !== '==') throw new Error('unsupported operator');
        return new FakeQuery(this, collectionName, field, value);
      },
      get: async () => this.collectionSnapshot(collectionName),
    };
  }

  snapshot(ref: FakeDocumentReference) {
    const stored = this.docs.get(ref.path);
    return {
      id: ref.id,
      exists: Boolean(stored),
      data: () => structuredClone(stored?.data || {}),
      updateTime: stored ? { toDate: () => new Date(stored.updateTime) } : undefined,
      ref,
    };
  }

  collectionSnapshot(collectionName: string) {
    const docs = [...this.docs.entries()]
      .filter(([key]) => key.startsWith(`${collectionName}/`))
      .map(([key]) =>
        this.snapshot(
          new FakeDocumentReference(this, collectionName, key.slice(collectionName.length + 1))
        )
      );
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  querySnapshot(query: FakeQuery) {
    const docs = this.collectionSnapshot(query.collectionName).docs.filter(
      (doc) => (doc.data() as Record<string, unknown>)[query.field] === query.value
    );
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  async runTransaction<T>(
    callback: (transaction: {
      get: (
        target: FakeDocumentReference | FakeQuery
      ) => Promise<
        ReturnType<FakeDocumentStore['snapshot']> | ReturnType<FakeDocumentStore['querySnapshot']>
      >;
      create: (ref: FakeDocumentReference, data: Record<string, unknown>) => void;
      delete: (ref: FakeDocumentReference) => void;
    }) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;
    const creates: Array<{ ref: FakeDocumentReference; data: Record<string, unknown> }> = [];
    const deletes: FakeDocumentReference[] = [];
    const result = await callback({
      get: async (target) =>
        target.kind === 'doc' ? this.snapshot(target) : this.querySnapshot(target),
      create: (ref, data) => {
        if (this.docs.has(ref.path) || creates.some((entry) => entry.ref.path === ref.path)) {
          throw new Error('already exists');
        }
        creates.push({ ref, data: structuredClone(data) });
      },
      delete: (ref) => deletes.push(ref),
    });
    for (const entry of creates) {
      this.seed(entry.ref.collectionName, entry.ref.id, entry.data, '2026-08-01T02:05:00.000Z');
    }
    for (const ref of deletes) this.docs.delete(ref.path);
    return result;
  }
}

const generatedAt = '2026-08-01T02:00:00.000Z';
const vietnamDate = '2026-08-01';
const target = { projectId: 'project-safe', databaseId: 'database-safe' };

function sources(): { students: SourceDoc[]; classes: SourceDoc[] } {
  return {
    students: [
      {
        id: 'student-1',
        data: { classId: 'class-1', enrollmentStatus: 'active' },
        updateTime: '2026-08-01T01:00:00.000Z',
      },
    ],
    classes: [
      {
        id: 'class-1',
        data: { startDate: '2026-08-01', endDate: '2026-08-31' },
        updateTime: '2026-08-01T01:00:00.000Z',
      },
    ],
  };
}

function plan(): SafeEnrollmentPlan {
  const value = sources();
  return planSafeStudentEnrollmentBackfill({
    ...value,
    existingByStudent: new Map(),
    generatedAt,
    vietnamDate,
  });
}

function reviewed(value = plan()): SafeEnrollmentReviewedFile {
  return {
    approved: false,
    target,
    plan: value,
    digest: createSafeEnrollmentDigest({ plan: value, target }),
  };
}

function database(): FakeDocumentStore {
  const db = new FakeDocumentStore();
  const value = sources();
  for (const student of value.students)
    db.seed('students', student.id, student.data, student.updateTime!);
  for (const classDoc of value.classes)
    db.seed('classes', classDoc.id, classDoc.data, classDoc.updateTime!);
  return db;
}

function otherOpenEnrollment(): StudentCourseEnrollment {
  const timestamp = '2026-08-01T00:00:00.000Z';
  return {
    id: makeStudentCourseEnrollmentId('student-1', 'class-other', '2026-08-01'),
    studentId: 'student-1',
    classId: 'class-other',
    termStart: '2026-08-01',
    termEnd: '2026-08-31',
    status: 'active',
    joinedAt: '2026-08-01',
    endedAt: null,
    statusReason: null,
    source: 'manual',
    confidence: 'confirmed',
    statusChangedAt: timestamp,
    statusChangedBy: 'office-user',
    confirmedAt: timestamp,
    confirmedBy: 'office-user',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('safe enrollment apply preflight', () => {
  it('accepts an unchanged reviewed plan', async () => {
    const db = database();
    const result = await preflightSafeEnrollmentApply({
      db: db as unknown as DocumentStore,
      reviewed: reviewed(),
      currentVietnamDate: vietnamDate,
    });
    expect(result.summary.create).toBe(1);
    expect(db.transactionCount).toBe(0);
  });

  it('rejects student source drift before any write transaction', async () => {
    const db = database();
    db.seed(
      'students',
      'student-1',
      { classId: 'class-1', enrollmentStatus: 'on_leave' },
      '2026-08-01T01:30:00.000Z'
    );
    await expect(
      preflightSafeEnrollmentApply({
        db: db as unknown as DocumentStore,
        reviewed: reviewed(),
        currentVietnamDate: vietnamDate,
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_SOURCE_DRIFT');
    expect(db.transactionCount).toBe(0);
  });

  it('rejects when an enrollment appeared after review', async () => {
    const db = database();
    const existing = otherOpenEnrollment();
    db.seed('student_course_enrollments', existing.id, existing, '2026-08-01T01:30:00.000Z');
    await expect(
      preflightSafeEnrollmentApply({
        db: db as unknown as DocumentStore,
        reviewed: reviewed(),
        currentVietnamDate: vietnamDate,
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_SOURCE_DRIFT');
    expect(db.transactionCount).toBe(0);
  });
});

describe('safe enrollment create-only apply', () => {
  it('creates the approved document and journals only after transaction commit', async () => {
    const db = database();
    const reviewedPlan = reviewed();
    const candidate = reviewedPlan.plan.items[0].candidate!;
    const onCreated = vi.fn(async (entry) => {
      expect(db.docs.has(`student_course_enrollments/${entry.documentId}`)).toBe(true);
    });

    const result = await applySafeEnrollmentBackfill({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      onCreated,
    });

    expect(result).toEqual({
      attempted: 1,
      created: 1,
      conflicted: 0,
      createdDocumentIds: [candidate.enrollment.id],
      journalSyncFailedDocumentIds: [],
    });
    expect(
      db.docs.get(`student_course_enrollments/${candidate.enrollment.id}`)?.data
    ).toMatchObject({
      studentId: 'student-1',
      classId: 'class-1',
      source: 'backfill',
      confidence: 'inferred',
    });
    expect(onCreated).toHaveBeenCalledWith({
      documentId: candidate.enrollment.id,
      studentId: 'student-1',
      payloadFingerprint: fingerprintEnrollmentPayload(candidate.enrollment),
      createdAt: generatedAt,
    });
    expect(
      db.docs.get(
        `student_enrollment_migration_journal/${reviewedPlan.digest}_${candidate.enrollment.id}`
      )?.data
    ).toMatchObject({
      migrationId: 'safe-student-course-enrollments-v2',
      runId: reviewedPlan.digest,
      digest: reviewedPlan.digest,
      target,
      documentId: candidate.enrollment.id,
      studentId: 'student-1',
    });
  });

  it('keeps a durable DocumentStore journal when local journal synchronization fails', async () => {
    const db = database();
    const reviewedPlan = reviewed();
    const candidate = reviewedPlan.plan.items[0].candidate!;

    const result = await applySafeEnrollmentBackfill({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      onCreated: async () => {
        throw new Error('disk unavailable');
      },
    });

    expect(result).toMatchObject({
      created: 1,
      conflicted: 0,
      journalSyncFailedDocumentIds: [candidate.enrollment.id],
    });
    expect(db.docs.has(`student_course_enrollments/${candidate.enrollment.id}`)).toBe(true);
    expect(
      db.docs.get(
        `student_enrollment_migration_journal/${reviewedPlan.digest}_${candidate.enrollment.id}`
      )?.data
    ).toMatchObject({ digest: reviewedPlan.digest, documentId: candidate.enrollment.id });
    await expect(
      loadSafeEnrollmentDurableJournal({
        db: db as unknown as DocumentStore,
        reviewed: reviewedPlan,
      })
    ).resolves.toEqual([
      {
        documentId: candidate.enrollment.id,
        studentId: candidate.enrollment.studentId,
        payloadFingerprint: fingerprintEnrollmentPayload(candidate.enrollment),
        createdAt: generatedAt,
      },
    ]);
  });

  it('stops without overwriting when any enrollment exists at transaction time', async () => {
    const db = database();
    const existing = otherOpenEnrollment();
    db.seed('student_course_enrollments', existing.id, existing, '2026-08-01T01:30:00.000Z');
    const onCreated = vi.fn();
    const result = await applySafeEnrollmentBackfill({
      db: db as unknown as DocumentStore,
      reviewed: reviewed(),
      onCreated,
    });
    expect(result).toMatchObject({
      attempted: 1,
      created: 0,
      conflicted: 1,
      createdDocumentIds: [],
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(db.docs.get(`student_course_enrollments/${existing.id}`)?.data).toEqual(existing);
  });
});

describe('safe enrollment verification', () => {
  it('passes after every approved candidate is created exactly', async () => {
    const db = database();
    const reviewedPlan = reviewed();
    await applySafeEnrollmentBackfill({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      onCreated: async () => undefined,
    });
    const result = await verifySafeEnrollmentApply({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
    });
    expect(result).toEqual({
      valid: true,
      checkedCandidates: 1,
      missingDocumentIds: [],
      mismatchedDocumentIds: [],
      multipleOpenStudentIds: [],
      remainingCandidateStudentIds: [],
    });
  });

  it('reports an additional open enrollment instead of hiding it', async () => {
    const db = database();
    const reviewedPlan = reviewed();
    const candidate = reviewedPlan.plan.items[0].candidate!;
    db.seed(
      'student_course_enrollments',
      candidate.enrollment.id,
      candidate.enrollment,
      '2026-08-01T02:05:00.000Z'
    );
    const other = otherOpenEnrollment();
    db.seed('student_course_enrollments', other.id, other, '2026-08-01T02:06:00.000Z');
    const result = await verifySafeEnrollmentApply({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
    });
    expect(result.valid).toBe(false);
    expect(result.multipleOpenStudentIds).toEqual(['student-1']);
  });
});

describe('safe enrollment rollback', () => {
  function preparedRollback(overrides: Partial<StudentCourseEnrollment> = {}) {
    const db = database();
    const reviewedPlan = reviewed();
    const candidate = reviewedPlan.plan.items[0].candidate!;
    const stored = { ...candidate.enrollment, ...overrides };
    db.seed(
      'student_course_enrollments',
      candidate.enrollment.id,
      stored,
      '2026-08-01T02:05:00.000Z'
    );
    const journal: SafeEnrollmentApplyJournalEntry[] = [
      {
        documentId: candidate.enrollment.id,
        studentId: candidate.enrollment.studentId,
        payloadFingerprint: fingerprintEnrollmentPayload(candidate.enrollment),
        createdAt: generatedAt,
      },
    ];
    return { db, reviewedPlan, candidate, journal };
  }

  it('plans deletion only for an unchanged unconfirmed document in the apply journal', async () => {
    const { db, reviewedPlan, candidate, journal } = preparedRollback();
    const rollback = await planSafeEnrollmentRollback({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      journal,
    });
    expect(rollback).toEqual({
      safeToDelete: [candidate.enrollment.id],
      blocked: [],
    });
  });

  it.each([
    [{ status: 'on_leave' }, 'DOCUMENT_CHANGED'],
    [{ statusChangedBy: 'office-user' }, 'DOCUMENT_CHANGED'],
    [{ manualNote: 'must preserve' }, 'DOCUMENT_CHANGED'],
    [
      { confidence: 'confirmed', confirmedAt: generatedAt, confirmedBy: 'office-user' },
      'DOCUMENT_CONFIRMED',
    ],
  ] as const)('blocks rollback when the created document changed', async (overrides, reason) => {
    const { db, reviewedPlan, candidate, journal } = preparedRollback(
      overrides as Partial<StudentCourseEnrollment>
    );
    const rollback = await planSafeEnrollmentRollback({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      journal,
    });
    expect(rollback.safeToDelete).toEqual([]);
    expect(rollback.blocked).toEqual([{ documentId: candidate.enrollment.id, reason }]);
  });

  it('blocks a journal ID that is not part of the reviewed manifest', async () => {
    const { db, reviewedPlan } = preparedRollback();
    const rollback = await planSafeEnrollmentRollback({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      journal: [
        {
          documentId: 'unknown-enrollment',
          studentId: 'student-unknown',
          payloadFingerprint: 'd'.repeat(64),
          createdAt: generatedAt,
        },
      ],
    });
    expect(rollback).toEqual({
      safeToDelete: [],
      blocked: [{ documentId: 'unknown-enrollment', reason: 'NOT_IN_REVIEWED_MANIFEST' }],
    });
  });

  it('blocks a missing document instead of treating rollback as successful', async () => {
    const { db, reviewedPlan, candidate, journal } = preparedRollback();
    db.docs.delete(`student_course_enrollments/${candidate.enrollment.id}`);
    const rollback = await planSafeEnrollmentRollback({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      journal,
    });
    expect(rollback.blocked).toEqual([
      { documentId: candidate.enrollment.id, reason: 'DOCUMENT_MISSING' },
    ]);
  });

  it('deletes only an approved exact-match document and reports the deleted ID', async () => {
    const { db, reviewedPlan, candidate, journal } = preparedRollback();
    const rollbackPlan = await planSafeEnrollmentRollback({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      journal,
    });
    const result = await applySafeEnrollmentRollback({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      journal,
      rollbackPlan,
    });
    expect(result).toEqual({
      deleted: 1,
      conflicted: 0,
      deletedDocumentIds: [candidate.enrollment.id],
    });
    expect(db.docs.has(`student_course_enrollments/${candidate.enrollment.id}`)).toBe(false);
    await expect(
      verifySafeEnrollmentRollback({ db: db as unknown as DocumentStore, journal })
    ).resolves.toEqual({ valid: true, checked: 1, remainingDocumentIds: [] });
  });

  it('refuses the entire rollback when any document is blocked', async () => {
    const { db, reviewedPlan, journal } = preparedRollback({ status: 'on_leave' });
    const rollbackPlan = await planSafeEnrollmentRollback({
      db: db as unknown as DocumentStore,
      reviewed: reviewedPlan,
      journal,
    });
    await expect(
      applySafeEnrollmentRollback({
        db: db as unknown as DocumentStore,
        reviewed: reviewedPlan,
        journal,
        rollbackPlan,
      })
    ).rejects.toThrow('SAFE_ENROLLMENT_ROLLBACK_BLOCKED');
  });
});
