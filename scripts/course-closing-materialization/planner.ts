import { createHash } from 'node:crypto';
import type {
  ClosingDocumentType,
  CourseClosingDataUnavailableReason,
  CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';
import type {
  MaterializationAction,
  MaterializationEvidenceDocument,
  MaterializationPlanItem,
  MaterializationRunPlan,
  MaterializationSourceBundle,
  MaterializationStorageState,
} from './types.js';

const DOCUMENT_FIELDS = [
  ['evaluation', 'evaluationDocument', 'evaluationSnapshot', 'evaluationDataAvailability'],
  ['tuition', 'tuitionDocument', 'tuitionSnapshot', 'tuitionDataAvailability'],
] as const;

const NOTIFICATION_TYPES: Record<ClosingDocumentType, Set<string>> = {
  evaluation: new Set(['evaluation_notice', 'evaluation']),
  tuition: new Set(['tuition_notice', 'next_course_tuition']),
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function createMaterializationRecordFingerprint(
  record: CourseClosingRecord,
  documentType: ClosingDocumentType
): string {
  const artifact =
    documentType === 'evaluation' ? record.evaluationDocument : record.tuitionDocument;
  const snapshot =
    documentType === 'evaluation' ? record.evaluationSnapshot : record.tuitionSnapshot;
  const availability =
    documentType === 'evaluation'
      ? record.evaluationDataAvailability
      : record.tuitionDataAvailability;

  return fingerprint({
    identity: {
      id: record.id,
      closingMonth: record.closingMonth,
      courseId: record.courseId,
      classId: record.classId,
      className: record.className,
      courseStartDate: record.courseStartDate,
      courseEndDate: record.courseEndDate,
      studentId: record.studentId,
      studentName: record.studentName,
      teacherId: record.teacherId,
      teacherName: record.teacherName,
    },
    artifact,
    snapshot,
    availability,
  });
}

function requiredIdentityPresent(record: CourseClosingRecord): boolean {
  return [
    record.id,
    record.closingMonth,
    record.courseId,
    record.classId,
    record.className,
    record.courseStartDate,
    record.courseEndDate,
    record.studentId,
    record.studentName,
  ].every((value) => text(value).length > 0);
}

function matchingEvidence(
  sources: MaterializationSourceBundle,
  record: CourseClosingRecord,
  documentType: ClosingDocumentType
): MaterializationEvidenceDocument[] {
  const notifications = sources.notifications.filter((entry) => {
    const data = entry.data || {};
    return (
      text(data.status) === 'sent' &&
      NOTIFICATION_TYPES[documentType].has(text(data.type)) &&
      text(data.courseId) === record.courseId &&
      text(data.studentId) === record.studentId
    );
  });
  const ledgers =
    documentType === 'tuition'
      ? sources.ledgers.filter(
          (entry) =>
            text(entry.data?.courseId) === record.courseId &&
            text(entry.data?.studentId) === record.studentId
        )
      : [];
  return [...notifications, ...ledgers].sort((left, right) => left.id.localeCompare(right.id));
}

function emptyRepairSummary(): MaterializationRunPlan['summary'] {
  return {
    total: 0,
    evaluation: 0,
    tuition: 0,
    unchanged_ready: 0,
    repair_ready_status: 0,
    materialize_verified: 0,
    materialize_unavailable_missing: 0,
    materialize_unavailable_incomplete: 0,
    conflict: 0,
  };
}

function unavailableReasonFor(
  availability: { reason?: CourseClosingDataUnavailableReason } | undefined,
  evidence: MaterializationEvidenceDocument[]
): CourseClosingDataUnavailableReason {
  if (availability?.reason) return availability.reason;
  return evidence.length > 0 ? 'historical_source_incomplete' : 'historical_source_missing';
}

function planRepair(
  sources: MaterializationSourceBundle,
  storageStates: MaterializationStorageState[],
  generatedAt: string
): MaterializationRunPlan {
  const items: MaterializationPlanItem[] = [];
  const summary = emptyRepairSummary();

  for (const record of sources.records) {
    for (const [documentType, documentField, snapshotField, availabilityField] of DOCUMENT_FIELDS) {
      const artifact = record[documentField];
      const snapshot = record[snapshotField];
      const availability = record[availabilityField];
      const evidence = matchingEvidence(sources, record, documentType);
      const matchingStorage = storageStates.filter(
        (entry) => entry.recordId === record.id && entry.documentType === documentType
      );
      const storage = matchingStorage[0];
      let action: MaterializationAction;
      let conflictCode: string | undefined;
      let unavailableReason: CourseClosingDataUnavailableReason | undefined;

      if (!requiredIdentityPresent(record)) {
        action = 'conflict';
        conflictCode = 'IDENTITY_INCOMPLETE';
      } else if (matchingStorage.length !== 1) {
        action = 'conflict';
        conflictCode =
          matchingStorage.length === 0 ? 'STORAGE_STATE_MISSING' : 'STORAGE_STATE_DUPLICATE';
      } else if (!artifact || artifact.type !== documentType || artifact.templateVersion !== 1) {
        action = 'conflict';
        conflictCode = 'DOCUMENT_METADATA_INVALID';
      } else if (
        storage.exists &&
        artifact.status === 'ready' &&
        artifact.storagePath === storage.expectedStoragePath &&
        Boolean(artifact.generatedAt)
      ) {
        action = 'unchanged_ready';
      } else if (storage.exists) {
        action = 'repair_ready_status';
        if (!snapshot) unavailableReason = unavailableReasonFor(availability, evidence);
      } else if (snapshot) {
        action = 'materialize_verified';
      } else {
        unavailableReason = unavailableReasonFor(availability, evidence);
        action =
          unavailableReason === 'historical_source_incomplete'
            ? 'materialize_unavailable_incomplete'
            : 'materialize_unavailable_missing';
      }

      const expectedStoragePath = storage?.expectedStoragePath || '';
      const recordFingerprint = createMaterializationRecordFingerprint(record, documentType);
      const evidenceFingerprint = fingerprint({
        evidence,
        storage: storage
          ? {
              expectedStoragePath: storage.expectedStoragePath,
              exists: storage.exists,
            }
          : null,
      });

      items.push({
        recordId: record.id,
        documentType,
        templateVersion: 1,
        action,
        expectedStoragePath,
        recordFingerprint,
        evidenceFingerprint,
        ...(unavailableReason ? { unavailableReason } : {}),
        ...(conflictCode ? { conflictCode } : {}),
      });
      summary[action] = (summary[action] || 0) + 1;
    }
  }

  items.sort(
    (left, right) =>
      left.recordId.localeCompare(right.recordId) ||
      left.documentType.localeCompare(right.documentType)
  );
  summary.total = items.length;
  summary.evaluation = items.filter((item) => item.documentType === 'evaluation').length;
  summary.tuition = items.filter((item) => item.documentType === 'tuition').length;

  return {
    generatedAt,
    items,
    summary,
    blocked: (summary.conflict || 0) > 0,
  };
}

function planPendingOnly(
  records: CourseClosingRecord[],
  generatedAt: string
): MaterializationRunPlan {
  const items: MaterializationPlanItem[] = [];
  const summary: MaterializationRunPlan['summary'] = {
    planned: 0,
    evaluation: 0,
    tuition: 0,
    skippedNotRequested: 0,
    skippedReady: 0,
    skippedRetrying: 0,
    skippedFailed: 0,
  };

  for (const record of records) {
    for (const [documentType, field] of DOCUMENT_FIELDS) {
      const artifact = record?.[field];
      const status = artifact?.status;

      if (status === 'pending') {
        items.push({
          recordId: record.id,
          documentType,
          templateVersion: 1,
          plannedStatus: 'pending',
          plannedAttempts: artifact.attempts || 0,
        });
        continue;
      }

      if (status === 'ready') summary.skippedReady = (summary.skippedReady || 0) + 1;
      else if (status === 'retrying') summary.skippedRetrying = (summary.skippedRetrying || 0) + 1;
      else if (status === 'failed') summary.skippedFailed = (summary.skippedFailed || 0) + 1;
      else summary.skippedNotRequested = (summary.skippedNotRequested || 0) + 1;
    }
  }

  items.sort(
    (left, right) =>
      left.recordId.localeCompare(right.recordId) ||
      left.documentType.localeCompare(right.documentType)
  );
  summary.planned = items.length;
  summary.evaluation = items.filter((item) => item.documentType === 'evaluation').length;
  summary.tuition = items.filter((item) => item.documentType === 'tuition').length;

  return { generatedAt, items, summary };
}

export function planCourseClosingMaterialization(
  records: CourseClosingRecord[],
  generatedAt: string
): MaterializationRunPlan;
export function planCourseClosingMaterialization(
  sources: MaterializationSourceBundle,
  storageStates: MaterializationStorageState[],
  generatedAt: string
): MaterializationRunPlan;
export function planCourseClosingMaterialization(
  input: CourseClosingRecord[] | MaterializationSourceBundle,
  storageOrGeneratedAt: MaterializationStorageState[] | string,
  generatedAt?: string
): MaterializationRunPlan {
  if (Array.isArray(input)) {
    return planPendingOnly(input, String(storageOrGeneratedAt));
  }
  return planRepair(
    input,
    storageOrGeneratedAt as MaterializationStorageState[],
    generatedAt || ''
  );
}
