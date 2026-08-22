import { createHash } from 'node:crypto';
import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import {
  isOpenStudentCourseEnrollmentStatus,
  type StudentCourseEnrollment,
} from '../../shared/studentCourseEnrollment.js';
import { readStoredStudentCourseEnrollment } from '../../server/api/lib/student/courseEnrollmentRepository.js';
import { loadSafeEnrollmentSources } from './documentStoreSources.js';
import {
  assertSafeEnrollmentPlan,
  canonicalJson,
  fingerprintClassSource,
  fingerprintStudentSource,
  planSafeStudentEnrollmentBackfill,
} from './planner.js';
import { createSafeEnrollmentDigest, type SafeEnrollmentReviewedFile } from './reporter.js';
import type {
  SafeEnrollmentApplyJournalEntry,
  SafeEnrollmentApplyResult,
  SafeEnrollmentPlan,
  SafeEnrollmentRollbackBlockReason,
  SafeEnrollmentRollbackPlan,
  SafeEnrollmentRollbackResult,
  SafeEnrollmentRollbackVerification,
  SafeEnrollmentVerification,
} from './types.js';

export function fingerprintEnrollmentPayload(enrollment: StudentCourseEnrollment): string {
  return createHash('sha256').update(canonicalJson(enrollment)).digest('hex');
}

function durableJournalDocumentId(digest: string, enrollmentId: string): string {
  return `${digest}_${enrollmentId}`;
}

export async function preflightSafeEnrollmentApply(input: {
  db: DocumentStore;
  reviewed: SafeEnrollmentReviewedFile;
  currentVietnamDate: string;
}): Promise<SafeEnrollmentPlan> {
  if (input.currentVietnamDate !== input.reviewed.plan.vietnamDate) {
    throw new Error('SAFE_ENROLLMENT_DATE_ROLLOVER');
  }
  const loaded = await loadSafeEnrollmentSources(input.db);
  const fresh = planSafeStudentEnrollmentBackfill({
    ...loaded.sources,
    generatedAt: input.reviewed.plan.generatedAt,
    vietnamDate: input.reviewed.plan.vietnamDate,
  });
  assertSafeEnrollmentPlan(fresh);
  const freshDigest = createSafeEnrollmentDigest({
    plan: fresh,
    target: input.reviewed.target,
  });
  if (freshDigest !== input.reviewed.digest) {
    throw new Error('SAFE_ENROLLMENT_SOURCE_DRIFT');
  }
  return fresh;
}

class SafeEnrollmentWriteConflict extends Error {
  constructor() {
    super('SAFE_ENROLLMENT_WRITE_CONFLICT');
  }
}

function sourceFromSnapshot(snapshot: AppDocumentStore.DocumentSnapshot) {
  return {
    id: snapshot.id,
    data: (snapshot.data() || {}) as Record<string, unknown>,
    ...(snapshot.updateTime ? { updateTime: snapshot.updateTime.toDate().toISOString() } : {}),
  };
}

export async function applySafeEnrollmentBackfill(input: {
  db: DocumentStore;
  reviewed: SafeEnrollmentReviewedFile;
  onCreated: (entry: SafeEnrollmentApplyJournalEntry) => Promise<void>;
}): Promise<SafeEnrollmentApplyResult> {
  assertSafeEnrollmentPlan(input.reviewed.plan);
  const items = input.reviewed.plan.items.filter(
    (item): item is typeof item & { candidate: NonNullable<typeof item.candidate> } =>
      item.decision === 'create' && Boolean(item.candidate)
  );
  const result: SafeEnrollmentApplyResult = {
    attempted: 0,
    created: 0,
    conflicted: 0,
    createdDocumentIds: [],
    journalSyncFailedDocumentIds: [],
  };
  for (const item of items) {
    result.attempted += 1;
    const candidate = item.candidate;
    try {
      await input.db.runTransaction(async (transaction) => {
        const studentRef = input.db.collection('students').doc(candidate.enrollment.studentId);
        const classRef = input.db.collection('classes').doc(candidate.enrollment.classId);
        const enrollmentRef = input.db
          .collection('student_course_enrollments')
          .doc(candidate.enrollment.id);
        const journalRef = input.db
          .collection('student_enrollment_migration_journal')
          .doc(durableJournalDocumentId(input.reviewed.digest, candidate.enrollment.id));
        const anyEnrollmentQuery = input.db
          .collection('student_course_enrollments')
          .where('studentId', '==', candidate.enrollment.studentId);
        const [
          studentSnapshot,
          classSnapshot,
          enrollmentSnapshot,
          journalSnapshot,
          anyEnrollmentSnapshot,
        ] = await Promise.all([
          transaction.get(studentRef),
          transaction.get(classRef),
          transaction.get(enrollmentRef),
          transaction.get(journalRef),
          transaction.get(anyEnrollmentQuery),
        ]);
        if (
          !studentSnapshot.exists ||
          !classSnapshot.exists ||
          enrollmentSnapshot.exists ||
          journalSnapshot.exists ||
          !anyEnrollmentSnapshot.empty ||
          fingerprintStudentSource(sourceFromSnapshot(studentSnapshot)) !==
            candidate.studentFingerprint ||
          fingerprintClassSource(sourceFromSnapshot(classSnapshot)) !== candidate.classFingerprint
        ) {
          throw new SafeEnrollmentWriteConflict();
        }
        transaction.create(enrollmentRef, {
          ...candidate.enrollment,
          serverUpdatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(journalRef, {
          migrationId: input.reviewed.plan.migrationId,
          runId: input.reviewed.digest,
          digest: input.reviewed.digest,
          target: input.reviewed.target,
          documentId: candidate.enrollment.id,
          studentId: candidate.enrollment.studentId,
          payloadFingerprint: fingerprintEnrollmentPayload(candidate.enrollment),
          createdAt: candidate.enrollment.createdAt,
          serverUpdatedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      if (error instanceof SafeEnrollmentWriteConflict) {
        result.conflicted += 1;
        break;
      }
      throw error;
    }
    result.created += 1;
    result.createdDocumentIds.push(candidate.enrollment.id);
    const journalEntry = {
      documentId: candidate.enrollment.id,
      studentId: candidate.enrollment.studentId,
      payloadFingerprint: fingerprintEnrollmentPayload(candidate.enrollment),
      createdAt: candidate.enrollment.createdAt,
    };
    try {
      await input.onCreated(journalEntry);
    } catch {
      result.journalSyncFailedDocumentIds.push(candidate.enrollment.id);
    }
  }
  return result;
}

export async function verifySafeEnrollmentApply(input: {
  db: DocumentStore;
  reviewed: SafeEnrollmentReviewedFile;
}): Promise<SafeEnrollmentVerification> {
  const candidates = input.reviewed.plan.items.flatMap((item) =>
    item.decision === 'create' && item.candidate ? [item.candidate] : []
  );
  const missingDocumentIds: string[] = [];
  const mismatchedDocumentIds: string[] = [];
  for (const candidate of candidates) {
    const snapshot = await input.db
      .collection('student_course_enrollments')
      .doc(candidate.enrollment.id)
      .get();
    if (!snapshot.exists) {
      missingDocumentIds.push(candidate.enrollment.id);
      continue;
    }
    try {
      const stored = readStoredStudentCourseEnrollment(
        snapshot as AppDocumentStore.QueryDocumentSnapshot
      );
      if (
        fingerprintEnrollmentPayload(stored) !== fingerprintEnrollmentPayload(candidate.enrollment)
      ) {
        mismatchedDocumentIds.push(candidate.enrollment.id);
      }
    } catch {
      mismatchedDocumentIds.push(candidate.enrollment.id);
    }
  }

  const loaded = await loadSafeEnrollmentSources(input.db);
  const multipleOpenStudentIds = [...loaded.sources.existingByStudent.entries()]
    .filter(
      ([, enrollments]) =>
        enrollments.filter((enrollment) => isOpenStudentCourseEnrollmentStatus(enrollment.status))
          .length > 1
    )
    .map(([studentId]) => studentId)
    .sort();
  const remaining = planSafeStudentEnrollmentBackfill({
    ...loaded.sources,
    generatedAt: input.reviewed.plan.generatedAt,
    vietnamDate: input.reviewed.plan.vietnamDate,
  });
  const remainingCandidateStudentIds = remaining.items
    .filter((item) => item.decision === 'create')
    .map((item) => item.studentId)
    .sort();
  const valid =
    missingDocumentIds.length === 0 &&
    mismatchedDocumentIds.length === 0 &&
    multipleOpenStudentIds.length === 0 &&
    remainingCandidateStudentIds.length === 0;
  return {
    valid,
    checkedCandidates: candidates.length,
    missingDocumentIds: missingDocumentIds.sort(),
    mismatchedDocumentIds: mismatchedDocumentIds.sort(),
    multipleOpenStudentIds,
    remainingCandidateStudentIds,
  };
}

export async function loadSafeEnrollmentDurableJournal(input: {
  db: DocumentStore;
  reviewed: SafeEnrollmentReviewedFile;
}): Promise<SafeEnrollmentApplyJournalEntry[]> {
  const snapshot = await input.db
    .collection('student_enrollment_migration_journal')
    .where('digest', '==', input.reviewed.digest)
    .get();
  const entries: SafeEnrollmentApplyJournalEntry[] = [];
  for (const document of snapshot.docs) {
    const data = document.data() as Record<string, unknown>;
    const target = data.target as Record<string, unknown> | undefined;
    if (
      data.migrationId !== input.reviewed.plan.migrationId ||
      data.runId !== input.reviewed.digest ||
      target?.projectId !== input.reviewed.target.projectId ||
      target?.databaseId !== input.reviewed.target.databaseId ||
      typeof data.documentId !== 'string' ||
      document.id !== durableJournalDocumentId(input.reviewed.digest, data.documentId) ||
      typeof data.studentId !== 'string' ||
      typeof data.payloadFingerprint !== 'string' ||
      typeof data.createdAt !== 'string'
    ) {
      throw new Error('SAFE_ENROLLMENT_DURABLE_JOURNAL_INVALID');
    }
    entries.push({
      documentId: data.documentId,
      studentId: data.studentId,
      payloadFingerprint: data.payloadFingerprint,
      createdAt: data.createdAt,
    });
  }
  return entries.sort((left, right) => left.documentId.localeCompare(right.documentId));
}

function reviewedCandidates(reviewed: SafeEnrollmentReviewedFile) {
  return new Map(
    reviewed.plan.items.flatMap((item) =>
      item.decision === 'create' && item.candidate
        ? [[item.candidate.enrollment.id, item.candidate] as const]
        : []
    )
  );
}

function rollbackBlockReason(input: {
  snapshot: AppDocumentStore.DocumentSnapshot;
  expected: StudentCourseEnrollment;
  journal: SafeEnrollmentApplyJournalEntry;
}): SafeEnrollmentRollbackBlockReason | null {
  if (!input.snapshot.exists) return 'DOCUMENT_MISSING';
  const raw = (input.snapshot.data() || {}) as Record<string, unknown>;
  const expectedKeys = new Set([...Object.keys(input.expected), 'serverUpdatedAt']);
  if (
    Object.keys(raw).some((key) => !expectedKeys.has(key)) ||
    Object.keys(input.expected).some((key) => !Object.prototype.hasOwnProperty.call(raw, key))
  ) {
    return 'DOCUMENT_CHANGED';
  }
  let stored: StudentCourseEnrollment;
  try {
    stored = readStoredStudentCourseEnrollment(
      input.snapshot as AppDocumentStore.QueryDocumentSnapshot
    );
  } catch {
    return 'DOCUMENT_CHANGED';
  }
  if (
    stored.confidence === 'confirmed' ||
    stored.confirmedAt !== null ||
    stored.confirmedBy !== null
  ) {
    return 'DOCUMENT_CONFIRMED';
  }
  const expectedFingerprint = fingerprintEnrollmentPayload(input.expected);
  if (input.journal.payloadFingerprint !== expectedFingerprint) return 'JOURNAL_MISMATCH';
  if (fingerprintEnrollmentPayload(stored) !== expectedFingerprint) return 'DOCUMENT_CHANGED';
  return null;
}

export async function planSafeEnrollmentRollback(input: {
  db: DocumentStore;
  reviewed: SafeEnrollmentReviewedFile;
  journal: SafeEnrollmentApplyJournalEntry[];
}): Promise<SafeEnrollmentRollbackPlan> {
  const candidates = reviewedCandidates(input.reviewed);
  const safeToDelete: string[] = [];
  const blocked: SafeEnrollmentRollbackPlan['blocked'] = [];
  for (const journal of [...input.journal].sort((left, right) =>
    left.documentId.localeCompare(right.documentId)
  )) {
    const candidate = candidates.get(journal.documentId);
    if (!candidate) {
      blocked.push({
        documentId: journal.documentId,
        reason: 'NOT_IN_REVIEWED_MANIFEST',
      });
      continue;
    }
    const snapshot = await input.db
      .collection('student_course_enrollments')
      .doc(journal.documentId)
      .get();
    const reason = rollbackBlockReason({
      snapshot,
      expected: candidate.enrollment,
      journal,
    });
    if (reason) blocked.push({ documentId: journal.documentId, reason });
    else safeToDelete.push(journal.documentId);
  }
  return { safeToDelete, blocked };
}

export async function applySafeEnrollmentRollback(input: {
  db: DocumentStore;
  reviewed: SafeEnrollmentReviewedFile;
  journal: SafeEnrollmentApplyJournalEntry[];
  rollbackPlan: SafeEnrollmentRollbackPlan;
}): Promise<SafeEnrollmentRollbackResult> {
  if (input.rollbackPlan.blocked.length > 0) {
    throw new Error('SAFE_ENROLLMENT_ROLLBACK_BLOCKED');
  }
  const candidates = reviewedCandidates(input.reviewed);
  const journalById = new Map(input.journal.map((entry) => [entry.documentId, entry]));
  const result: SafeEnrollmentRollbackResult = {
    deleted: 0,
    conflicted: 0,
    deletedDocumentIds: [],
  };
  for (const documentId of input.rollbackPlan.safeToDelete) {
    const candidate = candidates.get(documentId);
    const journal = journalById.get(documentId);
    if (!candidate || !journal) {
      result.conflicted += 1;
      break;
    }
    let deleted = false;
    await input.db.runTransaction(async (transaction) => {
      const ref = input.db.collection('student_course_enrollments').doc(documentId);
      const snapshot = await transaction.get(ref);
      const reason = rollbackBlockReason({
        snapshot,
        expected: candidate.enrollment,
        journal,
      });
      if (reason) return;
      transaction.delete(ref);
      deleted = true;
    });
    if (!deleted) {
      result.conflicted += 1;
      break;
    }
    result.deleted += 1;
    result.deletedDocumentIds.push(documentId);
  }
  return result;
}

export async function verifySafeEnrollmentRollback(input: {
  db: DocumentStore;
  journal: SafeEnrollmentApplyJournalEntry[];
}): Promise<SafeEnrollmentRollbackVerification> {
  const remainingDocumentIds: string[] = [];
  for (const entry of input.journal) {
    const snapshot = await input.db
      .collection('student_course_enrollments')
      .doc(entry.documentId)
      .get();
    if (snapshot.exists) remainingDocumentIds.push(entry.documentId);
  }
  remainingDocumentIds.sort();
  return {
    valid: remainingDocumentIds.length === 0,
    checked: input.journal.length,
    remainingDocumentIds,
  };
}
