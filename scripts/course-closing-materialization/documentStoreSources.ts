import type { DocumentStore } from '@/server/db/documentStore.js';
import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';
import type { MaterializationEvidenceDocument, MaterializationSourceBundle } from './types.js';

export interface MaterializationSourceSummary {
  records: number;
}

/**
 * Reads every archived record. The planner needs the full set so its summary
 * can account for the artifacts it deliberately leaves alone.
 */
export async function loadCourseClosingRecords(db: DocumentStore): Promise<{
  records: CourseClosingRecord[];
  summary: MaterializationSourceSummary;
}> {
  const snapshot = await db.collection('course_closing_records').get();
  const records = snapshot.docs.map((doc) => ({
    ...(doc.data() as CourseClosingRecord),
    id: (doc.data() as CourseClosingRecord)?.id || doc.id,
  }));
  return { records, summary: { records: records.length } };
}

const NOTIFICATION_FIELDS = [
  'status',
  'type',
  'courseId',
  'studentId',
  'ledgerId',
  'amount',
  'tuitionAmount',
  'schoolFee',
  'paymentDueDate',
  'tuitionDueDate',
  'dueDate',
  'noticeDate',
  'createdAt',
  'nextCourseStartDate',
  'nextCourseEndDate',
] as const;

const LEDGER_FIELDS = [
  'courseId',
  'studentId',
  'tuitionNoticeCount',
  'tuitionNoticeLastSentAt',
  'tuitionNoticeLastAmount',
  'amount',
  'tuitionAmount',
  'tuitionNoticeLastDueDate',
  'paymentDueDate',
  'tuitionDueDate',
  'dueDate',
] as const;

const RELEVANT_NOTIFICATION_TYPES = new Set([
  'evaluation_notice',
  'evaluation',
  'tuition_notice',
  'next_course_tuition',
]);

async function loadProjectedEvidence(
  db: DocumentStore,
  collectionName: string,
  fields: readonly string[]
): Promise<MaterializationEvidenceDocument[]> {
  const snapshot = await db
    .collection(collectionName)
    .select(...fields)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

export async function loadCourseClosingMaterializationSources(
  db: DocumentStore
): Promise<MaterializationSourceBundle> {
  const [{ records }, notifications, ledgers] = await Promise.all([
    loadCourseClosingRecords(db),
    loadProjectedEvidence(db, 'zalo_notifications', NOTIFICATION_FIELDS),
    loadProjectedEvidence(db, 'course_fee_ledgers', LEDGER_FIELDS),
  ]);

  return {
    records,
    notifications: notifications.filter(
      (entry) =>
        String(entry.data.status || '') === 'sent' &&
        RELEVANT_NOTIFICATION_TYPES.has(String(entry.data.type || ''))
    ),
    ledgers,
  };
}
