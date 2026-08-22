import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getDocumentStore,
  type DocumentData,
  type DocumentStore,
  type Query,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from '@/server/db/documentStore.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRIAL_TIMESTAMP_TOLERANCE_MS = 10 * 60 * 1000;

export type StudentEnrollmentBackfillRecord = {
  id: string;
  data: Record<string, unknown>;
};

export type AdmissionHistoryBackfillRecord = {
  data: Record<string, unknown>;
};

export type StudentEnrollmentBackfillOperation = {
  studentDocId: string;
  studentCode: string;
  action: 'set' | 'delete';
  enrollmentDate?: string;
  reason: string;
};

export type StudentEnrollmentBackfillPlan = {
  scannedStudents: number;
  identityGroups: number;
  setCount: number;
  deleteCount: number;
  unchangedCount: number;
  unresolvedCount: number;
  operations: StudentEnrollmentBackfillOperation[];
};

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const seconds =
    value && typeof value === 'object'
      ? Number(
          (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
            (value as { _seconds?: unknown })._seconds
        )
      : Number.NaN;
  if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  return null;
}

function earliest(dates: Date[]): Date | null {
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function identityKey(record: StudentEnrollmentBackfillRecord): string {
  const studentCode = String(record.data.studentId || '').trim();
  return studentCode ? 'student-code:' + studentCode : 'document:' + record.id;
}

function isOfficialEnrollmentRecord(data: Record<string, unknown>): boolean {
  const lifecycle = String(data.studentLifecycle || '');
  const admissionStatus = String(data.admissionStatus || '');
  if (lifecycle === 'pending' || lifecycle === 'lead' || lifecycle === 'trial') return false;
  if (admissionStatus === 'pending' || admissionStatus === 'trial') return false;
  if (admissionStatus === 'rejected') return false;
  if (lifecycle === 'archived' && data.archiveReason === 'trial_rejected') return false;
  return lifecycle === 'enrolled' || lifecycle === 'archived' || lifecycle === '';
}

function isClearlyTrialDate(
  data: Record<string, unknown>,
  enrollmentDate: Date,
  hasAcceptedHistory: boolean
): boolean {
  if (hasAcceptedHistory) return false;
  const lifecycle = String(data.studentLifecycle || '');
  if (lifecycle === 'pending' || lifecycle === 'lead') return true;
  if (data.archiveReason === 'trial_rejected') return true;
  if (data.admissionStatus === 'rejected') return true;
  if (lifecycle !== 'trial' && data.admissionStatus !== 'trial') return false;

  const trialDates = [data.trialStartedAt, data.admittedAt, data.createdAt]
    .map(parseDate)
    .filter((date): date is Date => Boolean(date));
  return trialDates.some(
    (date) => Math.abs(date.getTime() - enrollmentDate.getTime()) <= TRIAL_TIMESTAMP_TOLERANCE_MS
  );
}

function sameInstant(value: unknown, expected: Date): boolean {
  const current = parseDate(value);
  return Boolean(current && current.getTime() === expected.getTime());
}

export function planStudentEnrollmentDateBackfill(
  students: StudentEnrollmentBackfillRecord[],
  histories: AdmissionHistoryBackfillRecord[]
): StudentEnrollmentBackfillPlan {
  const acceptedByStudentDocId = new Map<string, Date[]>();
  for (const history of histories) {
    if (history.data.action !== 'teacher_accepted') continue;
    const studentDocId = String(history.data.studentId || '');
    const acceptedAt = parseDate(history.data.timestamp);
    if (!studentDocId || !acceptedAt) continue;
    const dates = acceptedByStudentDocId.get(studentDocId) || [];
    dates.push(acceptedAt);
    acceptedByStudentDocId.set(studentDocId, dates);
  }

  const recordsByIdentity = new Map<string, StudentEnrollmentBackfillRecord[]>();
  for (const student of students) {
    const key = identityKey(student);
    const records = recordsByIdentity.get(key) || [];
    records.push(student);
    recordsByIdentity.set(key, records);
  }

  const operations: StudentEnrollmentBackfillOperation[] = [];
  let unchangedCount = 0;
  let unresolvedCount = 0;

  for (const records of recordsByIdentity.values()) {
    const candidates: Date[] = [];

    for (const record of records) {
      const acceptedDates = acceptedByStudentDocId.get(record.id) || [];
      const acceptedAt = earliest(acceptedDates);
      if (acceptedAt) {
        candidates.push(acceptedAt);
        continue;
      }

      const enrollmentDate = parseDate(record.data.enrollmentDate);
      if (
        enrollmentDate &&
        !isClearlyTrialDate(record.data, enrollmentDate, acceptedDates.length > 0) &&
        isOfficialEnrollmentRecord(record.data)
      ) {
        candidates.push(enrollmentDate);
        continue;
      }

      if (isOfficialEnrollmentRecord(record.data)) {
        const createdAt = parseDate(record.data.createdAt);
        if (createdAt) candidates.push(createdAt);
      }
    }

    const firstEnrollment = earliest(candidates);

    for (const record of records) {
      const studentCode = String(record.data.studentId || '');
      const lifecycle = String(record.data.studentLifecycle || '');
      const acceptedDates = acceptedByStudentDocId.get(record.id) || [];
      const currentEnrollmentDate = parseDate(record.data.enrollmentDate);
      const invalidPending = lifecycle === 'pending' || lifecycle === 'lead';
      const clearlyTrialDate = Boolean(
        currentEnrollmentDate &&
        isClearlyTrialDate(record.data, currentEnrollmentDate, acceptedDates.length > 0)
      );

      if (invalidPending) {
        if (record.data.enrollmentDate !== undefined) {
          operations.push({
            studentDocId: record.id,
            studentCode,
            action: 'delete',
            reason: 'pending_or_waitlist_record',
          });
        } else {
          unchangedCount += 1;
        }
        continue;
      }

      if (firstEnrollment && (isOfficialEnrollmentRecord(record.data) || lifecycle === 'trial')) {
        if (sameInstant(record.data.enrollmentDate, firstEnrollment)) {
          unchangedCount += 1;
        } else {
          operations.push({
            studentDocId: record.id,
            studentCode,
            action: 'set',
            enrollmentDate: firstEnrollment.toISOString(),
            reason: acceptedDates.length
              ? 'teacher_accepted_history'
              : 'earliest_logical_student_enrollment',
          });
        }
        continue;
      }

      if (clearlyTrialDate || record.data.archiveReason === 'trial_rejected') {
        if (record.data.enrollmentDate !== undefined) {
          operations.push({
            studentDocId: record.id,
            studentCode,
            action: 'delete',
            reason: 'trial_or_rejected_trial_date',
          });
        } else {
          unchangedCount += 1;
        }
        continue;
      }

      if (record.data.enrollmentDate === undefined && isOfficialEnrollmentRecord(record.data)) {
        unresolvedCount += 1;
      } else {
        unchangedCount += 1;
      }
    }
  }

  return {
    scannedStudents: students.length,
    identityGroups: recordsByIdentity.size,
    setCount: operations.filter((operation) => operation.action === 'set').length,
    deleteCount: operations.filter((operation) => operation.action === 'delete').length,
    unchangedCount,
    unresolvedCount,
    operations,
  };
}

async function readAllDocuments(query: Query<DocumentData>, pageSize = 500) {
  const documents: QueryDocumentSnapshot<DocumentData>[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;

  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    documents.push(...snapshot.docs);
    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }

  return documents;
}

export async function backfillStudentEnrollmentDates({
  db,
  apply,
  maxBatchWrites = 400,
  log = console.log,
}: {
  db: DocumentStore;
  apply: boolean;
  maxBatchWrites?: number;
  log?: (message: string) => void;
}) {
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 400) {
    throw new Error('maxBatchWrites must be an integer between 1 and 400');
  }

  const [studentDocs, historyDocs] = await Promise.all([
    readAllDocuments(db.collection('students')),
    readAllDocuments(db.collection('admissions_history').where('action', '==', 'teacher_accepted')),
  ]);
  const plan = planStudentEnrollmentDateBackfill(
    studentDocs.map((doc) => ({ id: doc.id, data: doc.data() })),
    historyDocs.map((doc) => ({ data: doc.data() }))
  );

  if (apply) {
    let batch: WriteBatch = db.batch();
    let batchWrites = 0;
    for (const operation of plan.operations) {
      const update =
        operation.action === 'set'
          ? { enrollmentDate: Timestamp.fromDate(new Date(operation.enrollmentDate!)) }
          : { enrollmentDate: FieldValue.delete() };
      batch.update(db.collection('students').doc(operation.studentDocId), update);
      batchWrites += 1;
      if (batchWrites >= maxBatchWrites) {
        await batch.commit();
        batch = db.batch();
        batchWrites = 0;
      }
    }
    if (batchWrites > 0) await batch.commit();
  }

  log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        ...plan,
        operations: process.argv.includes('--verbose') ? plan.operations : undefined,
      },
      null,
      2
    )
  );
  return plan;
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function initFirebase(): App {
  if (getApps().length) return getApps()[0];
  const servicePath = path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    return initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
  }
  return initializeApp({
    credential: cert({
      projectId: requiredEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: normalizePrivateKey(requiredEnv('FIREBASE_PRIVATE_KEY')),
    }),
  });
}

async function main() {
  loadLocalEnv();
  const app = initFirebase();
  await backfillStudentEnrollmentDates({
    db: getDocumentStore(app, requiredEnv('FIRESTORE_DATABASE_ID')),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
