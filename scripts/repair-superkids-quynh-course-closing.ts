/**
 * One-off guarded repair for Superkids - Ms. Quỳnh - T3T5.
 *
 * Dry-run by default. The repair moves the completed closing from the fresh
 * 2026-08-06 course into a reconstructed 2026-06-11 -> 2026-08-04 archived
 * term, rotates a clean current course ID, and regenerates corrected DOCX
 * archives. Sent Zalo rows remain factual delivery logs and are annotated,
 * never resent or rewritten.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { FieldValue, getDocumentStore } from '@/server/db/documentStore.js';
import { computeCourseClosingComputation } from '../server/api/classes/helpers/courseClosing.js';
import { renderCourseClosingDocument } from '../server/api/classes/records/courseClosingRecordDocuments.js';
import { materializeCourseClosingDocument } from '../server/api/classes/records/courseClosingRecordMaterializer.js';
import { readLocalStorageRoot } from '../server/api/lib/storage/config.js';
import { getObjectStore } from '../server/api/lib/storage/objectStore.js';
import { buildSuperkidsCourseClosingRepairPlan } from './superkids-quynh-course-closing-repair-plan.js';

const APPLY = process.argv.includes('--apply');
const CLASS_ID = '4rVoBfFWk8fZHk23bNk8';
const CLASS_NAME = 'Superkids - Ms. Quỳnh - T3T5';
const CURRENT_START = '2026-08-06';
const CURRENT_END = '2026-09-29';
const OLD_COURSE_ID = 'b3b93fe4-7844-441a-af07-45b5dd04543c';
const NEW_COURSE_ID = '2c36abdf-e693-46a5-a37b-4869fc30bdf1';
const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const PROJECT_ID = 'gen-lang-client-0014842483';
const CORRECTED_NOTICE_DATE = '2026-08-11';
const CORRECTED_PAYMENT_DUE_DATE = '2026-08-20';
const EXPECTED = { evaluations: 16, notifications: 40, records: 16, ledgers: 17 };
const ACTOR = 'migration:reassign-superkids-course-closing';

const confirmations = new Set(process.argv.slice(2));
if (
  APPLY &&
  (!confirmations.has(`--confirm-class=${CLASS_ID}`) ||
    !confirmations.has(`--confirm-old-course=${OLD_COURSE_ID}`) ||
    !confirmations.has(`--confirm-new-course=${NEW_COURSE_ID}`))
) {
  throw new Error('Apply requires exact class, old-course, and new-course confirmations.');
}

const now = new Date().toISOString();
const timestamp = now.replace(/[:.]/g, '-');
const manifestPath =
  process.argv.find((arg) => arg.startsWith('--manifest='))?.slice('--manifest='.length) ||
  `scratch/migration-manifest-superkids-quynh-course-closing-${APPLY ? 'apply' : 'dry-run'}-${timestamp}.json`;

const serviceAccountText = await readFile('service-account-key.json', 'utf8');
const serviceAccount = JSON.parse(serviceAccountText);
if (String(serviceAccount.project_id || '') !== PROJECT_ID) throw new Error('Firebase project mismatch.');
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID,
});
const db = getDocumentStore(app, DATABASE_ID);

const [classDoc, evaluations, notifications, records, ledgers, beforeComputation] =
  await Promise.all([
    db.collection('classes').doc(CLASS_ID).get(),
    db.collection('evaluations').where('classId', '==', CLASS_ID).get(),
    db.collection('zalo_notifications').where('classId', '==', CLASS_ID).get(),
    db.collection('course_closing_records').where('classId', '==', CLASS_ID).get(),
    db.collection('course_fee_ledgers').where('classId', '==', CLASS_ID).get(),
    computeCourseClosingComputation(db, CLASS_ID),
  ]);
if (!classDoc.exists) throw new Error('Target class is missing.');
const classData = classDoc.data() || {};
if (classData.name !== CLASS_NAME) throw new Error(`Class name mismatch: ${String(classData.name)}`);
if (classData.startDate !== CURRENT_START || classData.endDate !== CURRENT_END) {
  throw new Error('Current class dates changed; refusing repair.');
}
if (classData.currentCourseId !== OLD_COURSE_ID) throw new Error('Current course ID changed.');
if (Array.isArray(classData.terms) && classData.terms.length > 0) {
  throw new Error('Class gained archived terms; refusing repair.');
}
if (evaluations.size !== EXPECTED.evaluations) throw new Error(`Expected 16 evaluations, found ${evaluations.size}.`);
if (notifications.size !== EXPECTED.notifications) throw new Error(`Expected 40 notifications, found ${notifications.size}.`);
if (records.size !== EXPECTED.records) throw new Error(`Expected 16 records, found ${records.size}.`);
if (ledgers.size !== EXPECTED.ledgers) throw new Error(`Expected 17 ledgers, found ${ledgers.size}.`);
if (
  beforeComputation.snapshot.status !== 'completed' ||
  beforeComputation.snapshot.finalEvaluationCount !== 16 ||
  beforeComputation.snapshot.evaluationSentCount !== 16 ||
  beforeComputation.snapshot.rankSentCount !== 2 ||
  beforeComputation.snapshot.tuitionSentCount !== 16
) {
  throw new Error('Course-closing completion evidence changed; refusing repair.');
}

const rows = <T extends AppDocumentStore.QueryDocumentSnapshot>(docs: T[]) =>
  docs.map((doc) => ({ id: doc.id, ...doc.data() }));
const evaluationRows = rows(evaluations.docs);
const notificationRows = rows(notifications.docs);
const recordRows = rows(records.docs);
const ledgerRows = rows(ledgers.docs);
const plan = buildSuperkidsCourseClosingRepairPlan({
  classData,
  newCourseId: NEW_COURSE_ID,
  now,
  correctedNoticeDate: CORRECTED_NOTICE_DATE,
  correctedPaymentDueDate: CORRECTED_PAYMENT_DUE_DATE,
  evaluations: evaluationRows,
  records: recordRows,
  notifications: notificationRows,
  ledgers: ledgerRows,
});

const manifest: Record<string, any> = {
  migration: 'reassign_superkids_course_closing_to_previous_course',
  mode: APPLY ? 'apply' : 'dry-run',
  generatedAt: now,
  target: {
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID,
    classId: CLASS_ID,
    className: CLASS_NAME,
    oldCourseId: OLD_COURSE_ID,
    newCourseId: NEW_COURSE_ID,
  },
  before: {
    class: classData,
    computation: beforeComputation.snapshot,
    evaluations: evaluationRows,
    notifications: notificationRows,
    records: recordRows,
    ledgers: ledgerRows,
  },
  plan,
  committed: false,
  documentMaterialization: [],
  verification: null,
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

if (!APPLY) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    classId: CLASS_ID,
    oldCourseId: OLD_COURSE_ID,
    newCourseId: NEW_COURSE_ID,
    previousCourse: plan.previousCourse,
    changes: {
      classDocuments: 1,
      evaluations: plan.evaluationUpdates.length,
      notificationsAnnotated: plan.notificationAnnotations.length,
      recordsCorrected: plan.recordUpdates.length,
      ledgersCleared: plan.ledgerIdsToClearClosingNotice.length,
      docxToRegenerate: plan.recordUpdates.length * 2,
      zaloMessagesToSend: 0,
    },
    manifestPath,
  }, null, 2));
  process.exit(0);
}

// Preflight both document rendering and the exact Storage bucket before the first write.
const firstRecord = recordRows[0];
const firstUpdate = plan.recordUpdates.find((row) => row.id === firstRecord.id)!;
const plannedFirstRecord = { ...firstRecord, ...firstUpdate } as any;
const localStorageRoot = readLocalStorageRoot();
await Promise.all([
  renderCourseClosingDocument(plannedFirstRecord, 'evaluation'),
  renderCourseClosingDocument(plannedFirstRecord, 'tuition'),
  mkdir(localStorageRoot, { recursive: true }).then(() =>
    access(localStorageRoot, constants.R_OK | constants.W_OK)
  ),
]);

const batch = db.batch();
batch.update(classDoc.ref, {
  currentCourseId: plan.classUpdate.currentCourseId,
  terms: plan.classUpdate.terms,
  courseClosing: FieldValue.delete(),
  updatedAt: now,
});
for (const update of plan.evaluationUpdates) {
  const { id, ...data } = update;
  batch.update(db.collection('evaluations').doc(id), data);
}
for (const update of plan.recordUpdates) {
  const { id, ...data } = update;
  batch.update(db.collection('course_closing_records').doc(id), data);
}
for (const annotation of plan.notificationAnnotations) {
  const { id, ...data } = annotation;
  batch.update(db.collection('zalo_notifications').doc(id), data);
}
for (const ledgerId of plan.ledgerIdsToClearClosingNotice) {
  batch.update(db.collection('course_fee_ledgers').doc(ledgerId), {
    tuitionNoticeCount: FieldValue.delete(),
    tuitionNoticeLastSentAt: FieldValue.delete(),
    tuitionNoticeLastSentBy: FieldValue.delete(),
    tuitionNoticeLastSentByName: FieldValue.delete(),
    tuitionNoticeLastSource: FieldValue.delete(),
    tuitionNoticeLastMessageId: FieldValue.delete(),
    tuitionNoticeLastAmount: FieldValue.delete(),
    tuitionNoticeLastDueDate: FieldValue.delete(),
    updatedAt: now,
  });
}
const auditId = `repair_course_reassignment_${OLD_COURSE_ID}`;
batch.create(db.collection('audit_logs').doc(auditId), {
  userId: ACTOR,
  userRole: 'system',
  userName: ACTOR,
  action: 'update',
  collection: 'classes',
  documentId: CLASS_ID,
  metadata: {
    migration: manifest.migration,
    reason: 'Course-closing data for the prior course was entered against the fresh 2026-08-06 course.',
    oldCourseId: OLD_COURSE_ID,
    newCourseId: NEW_COURSE_ID,
    archivedTermId: plan.previousCourse.id,
    archivedStartDate: plan.previousCourse.startDate,
    archivedEndDate: plan.previousCourse.endDate,
    evaluationCount: plan.evaluationUpdates.length,
    notificationCount: plan.notificationAnnotations.length,
    recordCount: plan.recordUpdates.length,
    ledgerCount: plan.ledgerIdsToClearClosingNotice.length,
    zaloMessagesSentByRepair: 0,
  },
  createdAt: now,
  timestamp: now,
});
await batch.commit();
manifest.committed = true;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

const materializationResults: Array<Record<string, unknown>> = [];
for (let index = 0; index < recordRows.length; index += 4) {
  const chunk = recordRows.slice(index, index + 4);
  await Promise.all(
    chunk.flatMap((record) =>
      (['evaluation', 'tuition'] as const).map(async (documentType) => {
        try {
          await materializeCourseClosingDocument(db, {
            recordId: record.id,
            documentType,
            templateVersion: 1,
            force: true,
          });
          materializationResults.push({ recordId: record.id, documentType, status: 'ready' });
        } catch (error) {
          materializationResults.push({
            recordId: record.id,
            documentType,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    )
  );
}
manifest.documentMaterialization = materializationResults;

const [afterClass, afterEvaluations, afterNotifications, afterRecords, afterLedgers, afterComputation] =
  await Promise.all([
    classDoc.ref.get(),
    db.collection('evaluations').where('classId', '==', CLASS_ID).get(),
    db.collection('zalo_notifications').where('classId', '==', CLASS_ID).get(),
    db.collection('course_closing_records').where('classId', '==', CLASS_ID).get(),
    db.collection('course_fee_ledgers').where('classId', '==', CLASS_ID).get(),
    computeCourseClosingComputation(db, CLASS_ID),
  ]);
const afterClassData = afterClass.data() || {};
const expectedStoragePrefix = `course_closing_records/2026-08/${CLASS_ID}/${OLD_COURSE_ID}/`;
const filesToVerify = afterRecords.docs.flatMap((doc) => [
  String(doc.data().evaluationDocument?.storagePath || ''),
  String(doc.data().tuitionDocument?.storagePath || ''),
]);
const storageChecks = await Promise.all(
  filesToVerify.map(async (path) => ({ path, exists: await getObjectStore().exists(path) }))
);
const verification = {
  currentCourseId: afterClassData.currentCourseId,
  currentCourseClosingPresent: Boolean(afterClassData.courseClosing),
  archivedTerms: afterClassData.terms || [],
  evaluationRanges: [...new Set(afterEvaluations.docs.map((doc) => `${doc.data().termStart}|${doc.data().termEnd}|${doc.data().termId}`))],
  notificationAnnotations: afterNotifications.docs.filter((doc) => doc.data().reassignedTermId === plan.previousCourse.id).length,
  recordRanges: [...new Set(afterRecords.docs.map((doc) => `${doc.data().courseStartDate}|${doc.data().courseEndDate}|${doc.data().closingMonth}`))],
  readyEvaluationDocuments: afterRecords.docs.filter((doc) => doc.data().evaluationDocument?.status === 'ready').length,
  readyTuitionDocuments: afterRecords.docs.filter((doc) => doc.data().tuitionDocument?.status === 'ready').length,
  correctedStoragePaths: filesToVerify.filter((path) => path.startsWith(expectedStoragePrefix)).length,
  existingStorageFiles: storageChecks.filter((row) => row.exists).length,
  ledgersWithClosingNoticeTracking: afterLedgers.docs.filter((doc) => doc.data().tuitionNoticeCount !== undefined).length,
  currentClosingSnapshot: afterComputation.snapshot,
};
manifest.verification = verification;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

const failures = materializationResults.filter((row) => row.status === 'failed');
const verified =
  afterClassData.currentCourseId === NEW_COURSE_ID &&
  !afterClassData.courseClosing &&
  Array.isArray(afterClassData.terms) &&
  afterClassData.terms.some((term: any) => term.id === plan.previousCourse.id) &&
  verification.evaluationRanges.length === 1 &&
  verification.evaluationRanges[0] === `2026-06-11|2026-08-04|${plan.previousCourse.id}` &&
  verification.notificationAnnotations === EXPECTED.notifications &&
  verification.recordRanges.length === 1 &&
  verification.recordRanges[0] === '2026-06-11|2026-08-04|2026-08' &&
  verification.readyEvaluationDocuments === EXPECTED.records &&
  verification.readyTuitionDocuments === EXPECTED.records &&
  verification.correctedStoragePaths === EXPECTED.records * 2 &&
  verification.existingStorageFiles === EXPECTED.records * 2 &&
  verification.ledgersWithClosingNoticeTracking === 0 &&
  afterComputation.snapshot.courseId === NEW_COURSE_ID &&
  failures.length === 0;

console.log(JSON.stringify({
  mode: 'apply',
  committed: true,
  verified,
  previousCourse: plan.previousCourse,
  newCurrentCourseId: NEW_COURSE_ID,
  materialized: materializationResults.length - failures.length,
  materializationFailures: failures,
  verification,
  zaloMessagesSent: 0,
  manifestPath,
}, null, 2));
if (!verified) process.exitCode = 1;
