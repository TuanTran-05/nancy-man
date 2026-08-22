import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  ADMIN_CLASS_TUITION_HEALTH_COLLECTION,
  ADMIN_CLASS_TUITION_HEALTH_DOC_ID,
  ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
  ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION,
  computeSummaryPaidRatio,
  computeSummaryRankingBand,
  makeAdminClassTuitionSummaryDocId,
  type AdminClassTuitionHealthDoc,
  type AdminClassTuitionSummaryDoc,
} from '../../../../shared/adminClassTuitionSummary.js';
import type { AdminRankingCriterion } from '../../../../shared/adminChatMetrics.js';
import { buildClassTerms } from '../../../../shared/studentEnrollmentTimeline.js';
import type {
  AdminClassTuitionRankingResult,
  AdminClassTuitionRankingRow,
  AdminDataQuality,
  AdminDataQualityIssue,
} from '../../zalo-bot/chat/admin/adminChatTypes.js';

import { buildClassTuitionReconciliationReport } from './classTuitionReconciliationService.js';

export const ADMIN_CLASS_TUITION_SNAPSHOT_MAX_AGE_MS = 26 * 60 * 60 * 1000;

async function markClassSnapshotsNotCurrent(db: DocumentStore, classId: string): Promise<void> {
  const snapshotQuery = await db
    .collection(ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION)
    .where('classId', '==', classId)
    .limit(21)
    .get();
  if (snapshotQuery.docs.length > 20) {
    throw new Error(`Too many tuition snapshots for class ${classId}`);
  }
  const currentDocs = snapshotQuery.docs.filter((doc) => doc.data()?.isCurrent === true);
  if (currentDocs.length === 0) return;
  const batch = db.batch();
  currentDocs.forEach((doc) => batch.update(doc.ref, { isCurrent: false }));
  await batch.commit();
}

/**
 * Builds and saves a single class tuition summary snapshot document.
 */
export async function buildAndSaveClassTuitionSnapshot(
  db: DocumentStore,
  classId: string,
  termStart: string,
  now = new Date()
): Promise<AdminClassTuitionSummaryDoc> {
  const classSnap = await db.collection('classes').doc(classId).get();
  const classData = classSnap.exists ? classSnap.data() || {} : {};
  const teacherId = String(classData.teacherId || '');

  const terms = buildClassTerms({ id: classId, ...classData });
  const matchedTerm = terms.find((t) => t.startDate === termStart);
  const isCurrent = matchedTerm ? matchedTerm.isCurrent : true;
  const termEnd = matchedTerm?.endDate || null;
  const courseId = matchedTerm?.termId || null;

  const reconciliation = await buildClassTuitionReconciliationReport(db, {
    classId,
    termStart,
  });

  const sum = reconciliation.summary;
  const netDueTotal = sum.netDueTotal;
  const paidTotal = sum.paidTotal;
  const outstandingTotal = sum.outstandingTotal;

  const isComplete =
    sum.missingLedgerCount === 0 &&
    sum.warningRowCount === 0 &&
    reconciliation.warnings.length === 0 &&
    netDueTotal !== null &&
    paidTotal !== null &&
    outstandingTotal !== null;

  const paidRatio = computeSummaryPaidRatio(paidTotal, netDueTotal);
  const rankingBand = computeSummaryRankingBand({
    netDueTotal,
    paidTotal,
    outstandingTotal,
    complete: isComplete,
    missingLedgerCount: sum.missingLedgerCount,
    warningRowCount: sum.warningRowCount,
  });

  // Count students with outstanding balance
  const outstandingStudentCount = reconciliation.rows.filter(
    (row) => (row.outstandingTotal ?? 0) > 0
  ).length;

  const docId = makeAdminClassTuitionSummaryDocId(classId, termStart);
  const snapshotDoc: AdminClassTuitionSummaryDoc = {
    id: docId,
    classId,
    teacherId,
    courseId,
    termStart,
    termEnd,
    isCurrent,
    netDueTotal,
    paidTotal,
    outstandingTotal,
    paidRatio,
    rankingBand,
    studentCount: sum.studentCount,
    outstandingStudentCount,
    missingLedgerCount: sum.missingLedgerCount,
    warningRowCount: sum.warningRowCount,
    complete: isComplete,
    sourceVersion: ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    sourceUpdatedAt: now.toISOString(),
  };

  await markClassSnapshotsNotCurrent(db, classId);
  await db.collection(ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION).doc(docId).set(snapshotDoc);

  return snapshotDoc;
}

/**
 * Queries class tuition ranking across complete snapshots.
 */
export async function queryAdminClassTuitionRanking(
  db: DocumentStore,
  options: {
    criterion: AdminRankingCriterion;
    limit?: number | null;
  },
  now = new Date()
): Promise<AdminClassTuitionRankingResult> {
  const computedAt = now.toISOString();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 10);

  const issues: AdminDataQualityIssue[] = [];
  let qualityStatus: AdminDataQuality['status'] = 'complete';

  // 1. Check health document
  const healthSnap = await db
    .collection(ADMIN_CLASS_TUITION_HEALTH_COLLECTION)
    .doc(ADMIN_CLASS_TUITION_HEALTH_DOC_ID)
    .get();

  const healthData = healthSnap.exists ? (healthSnap.data() as AdminClassTuitionHealthDoc) : null;

  const newestGeneratedAtMs = Date.parse(healthData?.newestGeneratedAt || '');
  const healthIsStale =
    !Number.isFinite(newestGeneratedAtMs) ||
    now.getTime() - newestGeneratedAtMs > ADMIN_CLASS_TUITION_SNAPSHOT_MAX_AGE_MS;
  const healthIsComplete = Boolean(
    healthData &&
    healthData.sourceVersion === ADMIN_CLASS_TUITION_SNAPSHOT_VERSION &&
    healthData.healthy &&
    healthData.expectedCount > 0 &&
    healthData.materializedCount === healthData.expectedCount &&
    healthData.completeCount === healthData.expectedCount &&
    healthData.incompleteCount === 0
  );

  if (!healthIsComplete || healthIsStale) {
    qualityStatus = 'failed';
    issues.push({
      code: healthIsStale ? 'stale' : 'source_incomplete',
      source: 'admin_class_tuition_health',
    });
    return {
      kind: 'class_tuition_ranking',
      criterion: options.criterion,
      rows: [],
      omittedCount: 0,
      excludedIncompleteCount: healthData?.incompleteCount ?? 0,
      quality: { status: qualityStatus, issues },
      computedAt,
      source: 'admin_class_tuition_summaries_v1',
      sourceAsOf: healthData?.newestGeneratedAt ?? undefined,
    };
  }

  // 2. Query snapshots for current course terms
  const querySnap = await db
    .collection(ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION)
    .where('isCurrent', '==', true)
    .limit(201)
    .get();

  if (querySnap.docs.length > 200) {
    return {
      kind: 'class_tuition_ranking',
      criterion: options.criterion,
      rows: [],
      omittedCount: 0,
      excludedIncompleteCount: 0,
      quality: {
        status: 'failed',
        issues: [{ code: 'result_cap_reached', source: ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION }],
      },
      computedAt,
      source: 'admin_class_tuition_summaries_v1',
      sourceAsOf: healthData?.newestGeneratedAt ?? undefined,
    };
  }

  const allDocs = querySnap.docs.map((doc) => doc.data() as AdminClassTuitionSummaryDoc);
  const completeDocs = allDocs.filter((d) => d.complete === true);
  const excludedIncompleteCount = allDocs.length - completeDocs.length;

  const snapshotMismatch =
    allDocs.length !== healthData!.expectedCount ||
    completeDocs.some(
      (doc) =>
        computeSummaryRankingBand({
          netDueTotal: doc.netDueTotal,
          paidTotal: doc.paidTotal,
          outstandingTotal: doc.outstandingTotal,
          complete: doc.complete,
          missingLedgerCount: doc.missingLedgerCount,
          warningRowCount: doc.warningRowCount,
        }) !== doc.rankingBand
    );
  if (snapshotMismatch) {
    return {
      kind: 'class_tuition_ranking',
      criterion: options.criterion,
      rows: [],
      omittedCount: 0,
      excludedIncompleteCount,
      quality: {
        status: 'failed',
        issues: [{ code: 'source_incomplete', source: ADMIN_CLASS_TUITION_SUMMARIES_COLLECTION }],
      },
      computedAt,
      source: 'admin_class_tuition_summaries_v1',
      sourceAsOf: healthData?.newestGeneratedAt ?? undefined,
    };
  }

  let filteredDocs: AdminClassTuitionSummaryDoc[] = [];

  if (options.criterion === 'highest_outstanding') {
    filteredDocs = completeDocs
      .filter(
        (d) =>
          (d.rankingBand === 'outstanding' || d.rankingBand === 'nearly_paid') &&
          (d.outstandingTotal ?? 0) > 0
      )
      .sort((a, b) => {
        const diff = (b.outstandingTotal ?? 0) - (a.outstandingTotal ?? 0);
        if (diff !== 0) return diff;
        return a.classId.localeCompare(b.classId);
      });
  } else if (options.criterion === 'nearly_paid') {
    filteredDocs = completeDocs
      .filter((d) => d.rankingBand === 'nearly_paid')
      .sort((a, b) => {
        const diff = (b.paidRatio ?? 0) - (a.paidRatio ?? 0);
        if (diff !== 0) return diff;
        const outDiff = (a.outstandingTotal ?? 0) - (b.outstandingTotal ?? 0);
        if (outDiff !== 0) return outDiff;
        return a.classId.localeCompare(b.classId);
      });
  } else if (options.criterion === 'fully_paid') {
    filteredDocs = completeDocs
      .filter((d) => d.rankingBand === 'fully_paid')
      .sort((a, b) => {
        const diff = (b.paidTotal ?? 0) - (a.paidTotal ?? 0);
        if (diff !== 0) return diff;
        return a.classId.localeCompare(b.classId);
      });
  }

  const topDocs = filteredDocs.slice(0, limit);
  const omittedCount = Math.max(0, filteredDocs.length - topDocs.length);

  // 3. Batch hydrate class names and teacher names dynamically
  const classIds = Array.from(new Set(topDocs.map((d) => d.classId)));
  const teacherIds = Array.from(new Set(topDocs.map((d) => d.teacherId).filter(Boolean)));

  const classNameMap = new Map<string, string>();
  if (classIds.length > 0) {
    const classSnaps = await Promise.all(
      classIds.map((cid) => db.collection('classes').doc(cid).get())
    );
    for (const snap of classSnaps) {
      if (snap.exists) classNameMap.set(snap.id, String(snap.data()?.name || snap.id));
    }
  }

  const teacherNameMap = new Map<string, string>();
  if (teacherIds.length > 0) {
    const teacherSnaps = await Promise.all(
      teacherIds.map((tid) => db.collection('users').doc(tid).get())
    );
    for (const snap of teacherSnaps) {
      if (snap.exists) {
        teacherNameMap.set(
          snap.id,
          String(snap.data()?.name || snap.data()?.displayName || snap.id)
        );
      }
    }
  }

  const rows: AdminClassTuitionRankingRow[] = topDocs.map((d) => ({
    classId: d.classId,
    className: classNameMap.get(d.classId) || d.classId,
    teacherName: teacherNameMap.get(d.teacherId) || '',
    netDueTotal: d.netDueTotal,
    paidTotal: d.paidTotal,
    outstandingTotal: d.outstandingTotal,
    paidRatio: d.paidRatio,
    rankingBand: d.rankingBand,
  }));

  return {
    kind: 'class_tuition_ranking',
    criterion: options.criterion,
    rows,
    omittedCount,
    excludedIncompleteCount,
    quality: {
      status: qualityStatus,
      issues,
    },
    computedAt,
    source: 'admin_class_tuition_summaries_v1',
    sourceAsOf: healthData?.newestGeneratedAt ?? undefined,
  };
}

/**
 * Rebuilds all class tuition snapshots for active classes and updates the health document.
 */
export async function rebuildAllAdminClassTuitionSnapshots(
  db: DocumentStore,
  options: { dryRun?: boolean } = {},
  now = new Date()
): Promise<AdminClassTuitionHealthDoc> {
  const classesSnap = await db.collection('classes').limit(501).get();
  const classesTruncated = classesSnap.docs.length > 500;

  let expectedCount = 0;
  let materializedCount = 0;
  let completeCount = 0;
  let incompleteCount = 0;

  const generatedAts: string[] = [];

  for (const doc of classesSnap.docs.slice(0, 500)) {
    const classData = doc.data() || {};
    if (classData.status === 'archived') {
      if (!options.dryRun) await markClassSnapshotsNotCurrent(db, doc.id);
      continue;
    }

    const terms = buildClassTerms({ id: doc.id, ...classData });
    const currentTerm = terms.find((t) => t.isCurrent);
    const termStart = currentTerm?.startDate;

    expectedCount++;

    if (!termStart) {
      incompleteCount++;
      if (!options.dryRun) await markClassSnapshotsNotCurrent(db, doc.id);
      continue;
    }

    if (!options.dryRun) {
      try {
        const snap = await buildAndSaveClassTuitionSnapshot(db, doc.id, termStart, now);
        materializedCount++;
        generatedAts.push(snap.generatedAt);
        if (snap.complete) completeCount++;
        else incompleteCount++;
      } catch {
        incompleteCount++;
      }
    }
  }

  if (classesTruncated) incompleteCount++;

  generatedAts.sort();
  const oldestGeneratedAt = generatedAts[0] ?? null;
  const newestGeneratedAt = generatedAts.at(-1) ?? null;
  const isHealthy = !options.dryRun && expectedCount > 0 && incompleteCount === 0;

  const healthDoc: AdminClassTuitionHealthDoc = {
    sourceVersion: ADMIN_CLASS_TUITION_SNAPSHOT_VERSION,
    healthy: isHealthy,
    expectedCount,
    materializedCount: options.dryRun ? 0 : materializedCount,
    completeCount: options.dryRun ? 0 : completeCount,
    incompleteCount: options.dryRun ? 0 : incompleteCount,
    oldestGeneratedAt,
    newestGeneratedAt,
    lastDailyRebuildAt: now.toISOString(),
    lastDailyRebuildStatus: isHealthy ? 'success' : 'failed',
  };

  if (!options.dryRun) {
    await db
      .collection(ADMIN_CLASS_TUITION_HEALTH_COLLECTION)
      .doc(ADMIN_CLASS_TUITION_HEALTH_DOC_ID)
      .set(healthDoc);
  }

  return healthDoc;
}
