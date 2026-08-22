import { FieldValue, type DocumentReference, type DocumentStore } from '@/server/db/documentStore.js';
import {
  COURSE_CLOSING_DOCX_MIME,
  courseClosingDownloadFilename,
  courseClosingStoragePath,
  type ClosingDocumentType,
  type CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';
import { materializeCourseClosingDocument } from '../../server/api/classes/records/courseClosingRecordMaterializer.js';
import { getObjectStore } from '../../server/api/lib/storage/objectStore.js';
import { createMaterializationRecordFingerprint } from './planner.js';
import type {
  MaterializationApplySummary,
  MaterializationItemResult,
  MaterializationPlanItem,
  MaterializationRunPlan,
} from './types.js';

export interface MaterializationApplyOptions {
  actualProjectId: string;
  actualDatabaseId: string;
  confirmProjectId: string;
  confirmDatabaseId: string;
  reviewedDigest: string;
}

export interface MaterializationApplyDeps {
  materialize?: typeof materializeCourseClosingDocument;
  fileExists?: (storagePath: string) => Promise<boolean>;
  now?: () => string;
  onProgress?: (result: MaterializationItemResult, index: number, total: number) => void;
}

function documentField(documentType: ClosingDocumentType) {
  return documentType === 'evaluation' ? 'evaluationDocument' : 'tuitionDocument';
}

function snapshotField(documentType: ClosingDocumentType) {
  return documentType === 'evaluation' ? 'evaluationSnapshot' : 'tuitionSnapshot';
}

function availabilityField(documentType: ClosingDocumentType) {
  return documentType === 'evaluation' ? 'evaluationDataAvailability' : 'tuitionDataAvailability';
}

function canonicalPath(record: CourseClosingRecord, documentType: ClosingDocumentType): string {
  return courseClosingStoragePath({
    closingMonth: record.closingMonth,
    classId: record.classId,
    courseId: record.courseId,
    studentId: record.studentId,
    documentType,
    templateVersion: 1,
  });
}

async function guardedUpdate(
  db: DocumentStore,
  ref: DocumentReference,
  item: MaterializationPlanItem,
  patch: Record<string, unknown>
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists) throw new Error('RECORD_MISSING');
    const record = current.data() as CourseClosingRecord;
    if (
      !item.recordFingerprint ||
      createMaterializationRecordFingerprint(record, item.documentType) !== item.recordFingerprint
    ) {
      throw new Error('RECORD_FINGERPRINT_CHANGED');
    }
    tx.update(ref, patch);
  });
}

async function applyOneItem(
  db: DocumentStore,
  item: MaterializationPlanItem,
  deps: Required<Pick<MaterializationApplyDeps, 'materialize' | 'fileExists' | 'now'>>
): Promise<MaterializationItemResult> {
  const base = { recordId: item.recordId, documentType: item.documentType };
  const ref = db.collection('course_closing_records').doc(item.recordId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return { ...base, outcome: 'conflicted', errorCode: 'RECORD_MISSING' };
  }

  const record = snapshot.data() as CourseClosingRecord;
  const artifact = record[documentField(item.documentType)];
  const observed = {
    observedStatus: artifact?.status,
    observedAttempts: artifact?.attempts || 0,
  };
  if (!item.action || !item.expectedStoragePath || !item.recordFingerprint || !artifact) {
    return { ...base, ...observed, outcome: 'conflicted', errorCode: 'PLAN_ITEM_INVALID' };
  }
  if (canonicalPath(record, item.documentType) !== item.expectedStoragePath) {
    return {
      ...base,
      ...observed,
      outcome: 'conflicted',
      errorCode: 'STORAGE_PATH_CHANGED',
    };
  }
  if (
    createMaterializationRecordFingerprint(record, item.documentType) !== item.recordFingerprint
  ) {
    return {
      ...base,
      ...observed,
      outcome: 'conflicted',
      errorCode: 'RECORD_FINGERPRINT_CHANGED',
    };
  }

  const exists = await deps.fileExists(item.expectedStoragePath);
  const plannedExistingObject =
    item.action === 'unchanged_ready' || item.action === 'repair_ready_status';
  if (exists !== plannedExistingObject) {
    return {
      ...base,
      ...observed,
      outcome: 'conflicted',
      errorCode: 'STORAGE_STATE_CHANGED',
    };
  }

  if (item.action === 'unchanged_ready') {
    return { ...base, ...observed, outcome: 'unchanged_ready' };
  }

  if (item.action === 'repair_ready_status') {
    const docField = documentField(item.documentType);
    const patch: Record<string, unknown> = {
      [`${docField}.status`]: 'ready',
      [`${docField}.storagePath`]: item.expectedStoragePath,
      [`${docField}.downloadFilename`]: courseClosingDownloadFilename(
        record.studentName,
        item.documentType
      ),
      [`${docField}.mimeType`]: COURSE_CLOSING_DOCX_MIME,
      [`${docField}.generatedAt`]: artifact.generatedAt || deps.now(),
      [`${docField}.lastErrorCode`]: FieldValue.delete(),
      updatedAt: deps.now(),
    };
    if (!record[snapshotField(item.documentType)] && item.unavailableReason) {
      patch[availabilityField(item.documentType)] = {
        status: 'unavailable',
        reason: item.unavailableReason,
        assessedAt: deps.now(),
      };
    }
    try {
      await guardedUpdate(db, ref, item, patch);
      return { ...base, ...observed, outcome: 'repaired_ready_status' };
    } catch (error: any) {
      return {
        ...base,
        ...observed,
        outcome: 'conflicted',
        errorCode: String(error?.message || 'RECORD_FINGERPRINT_CHANGED'),
      };
    }
  }

  if (
    item.action !== 'materialize_verified' &&
    item.action !== 'materialize_unavailable_missing' &&
    item.action !== 'materialize_unavailable_incomplete'
  ) {
    return {
      ...base,
      ...observed,
      outcome: 'conflicted',
      errorCode: item.conflictCode || 'PLAN_ACTION_NOT_APPLICABLE',
    };
  }

  const docField = documentField(item.documentType);
  const patch: Record<string, unknown> = {
    [`${docField}.status`]: 'pending',
    [`${docField}.lastErrorCode`]: FieldValue.delete(),
    updatedAt: deps.now(),
  };
  if (item.action === 'materialize_verified') {
    patch[availabilityField(item.documentType)] = { status: 'verified' };
  } else {
    patch[availabilityField(item.documentType)] = {
      status: 'unavailable',
      reason: item.unavailableReason,
      assessedAt: deps.now(),
    };
  }

  try {
    await guardedUpdate(db, ref, item, patch);
  } catch (error: any) {
    return {
      ...base,
      ...observed,
      outcome: 'conflicted',
      errorCode: String(error?.message || 'RECORD_FINGERPRINT_CHANGED'),
    };
  }

  try {
    await deps.materialize(db, {
      recordId: item.recordId,
      documentType: item.documentType,
      templateVersion: item.templateVersion,
    });
    return { ...base, ...observed, outcome: 'materialized' };
  } catch (error: any) {
    return {
      ...base,
      ...observed,
      outcome: 'failed',
      errorCode: String(error?.errorCode || error?.code || error?.message || 'MATERIALIZE_FAILED'),
    };
  }
}

export async function applyCourseClosingMaterialization(
  db: DocumentStore,
  plan: MaterializationRunPlan,
  options: MaterializationApplyOptions,
  dependencies: MaterializationApplyDeps = {}
): Promise<MaterializationApplySummary> {
  if (options.confirmProjectId !== options.actualProjectId) {
    throw new Error('MATERIALIZE_PROJECT_CONFIRMATION_MISMATCH');
  }
  if (options.confirmDatabaseId !== options.actualDatabaseId) {
    throw new Error('MATERIALIZE_DATABASE_CONFIRMATION_MISMATCH');
  }
  if (!options.reviewedDigest) {
    throw new Error('MATERIALIZE_REVIEWED_DIGEST_REQUIRED');
  }
  if (plan.blocked || plan.items.some((item) => item.action === 'conflict')) {
    throw new Error('MATERIALIZE_PLAN_BLOCKED_BY_CONFLICT');
  }

  const deps = {
    materialize: dependencies.materialize || materializeCourseClosingDocument,
    fileExists:
      dependencies.fileExists ||
      ((storagePath: string) => getObjectStore().exists(storagePath)),
    now: dependencies.now || (() => new Date().toISOString()),
  };
  const results: MaterializationItemResult[] = [];

  for (const [index, item] of plan.items.entries()) {
    const result = await applyOneItem(db, item, deps);
    results.push(result);
    dependencies.onProgress?.(result, index, plan.items.length);
  }

  return {
    materialized: results.filter((result) => result.outcome === 'materialized').length,
    unchanged_ready: results.filter((result) => result.outcome === 'unchanged_ready').length,
    repaired_ready_status: results.filter((result) => result.outcome === 'repaired_ready_status')
      .length,
    conflicted: results.filter((result) => result.outcome === 'conflicted').length,
    failed: results.filter((result) => result.outcome === 'failed').length,
    results,
  };
}
