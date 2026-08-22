/**
 * Align canonical open enrollments with already-correct class term dates.
 *
 * Dry-run (default):
 *   tsx scripts/repair-current-class-term-enrollments.ts
 *
 * Apply:
 *   tsx scripts/repair-current-class-term-enrollments.ts --apply \
 *     --confirm=align-current-class-terms-2026-08-16
 *
 * The class dates, attendance, sessions, ledger document ids, and receipts are
 * read-only. Enrollment document ids move because termStart is part of their
 * canonical identity; ledger ids stay put so receipt references remain stable.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { FieldValue, getDocumentStore } from '@/server/db/documentStore.js';
import { executeClassUpdateAndSyncAtomic } from '../server/api/classes/helpers/classSyncHelper.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../server/api/lib/services/accountingStudentSummaryService.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';

const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const APPLY_CONFIRMATION = 'align-current-class-terms-2026-08-16';
const OPEN_ENROLLMENT_STATUSES = new Set<string>(['trial', 'active', 'on_leave']);
const TARGETS = [
  {
    classId: 'lYMDImfr5T7qBTEXcmSW',
    expectedName: 'Starters - Ms.Thùy CN - T2 15H45',
    currentStart: '2026-08-09',
    currentEnd: '2026-09-28',
  },
  {
    classId: 'RI6vRY14dJtwLSpdy1Bc',
    expectedName: 'G6 - Mr.Khoa - T7CN',
    currentStart: '2026-08-15',
    currentEnd: '2026-10-04',
  },
] as const;

const APPLY = process.argv.includes('--apply');
const option = (name: string) => {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
};

const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  DATABASE_ID
);

type StoredDoc = {
  id: string;
  ref: AppDocumentStore.DocumentReference;
  data: Record<string, unknown>;
  version: string;
};

const stored = (snapshot: AppDocumentStore.DocumentSnapshot): StoredDoc => ({
  id: snapshot.id,
  ref: snapshot.ref,
  data: (snapshot.data() || {}) as Record<string, unknown>,
  version: snapshot.updateTime?.toDate().toISOString() || '',
});

const docs = (snapshot: AppDocumentStore.QuerySnapshot): StoredDoc[] =>
  snapshot.docs.map((doc) => stored(doc));

const versionKey = (rows: StoredDoc[]) =>
  rows
    .map((row) => `${row.id}@${row.version}`)
    .sort()
    .join('|');

async function loadTarget(target: (typeof TARGETS)[number]) {
  const classRef = db.collection('classes').doc(target.classId);
  const [classSnapshot, enrollmentSnapshot, ledgerSnapshot, attendanceSnapshot, sessionSnapshot] =
    await Promise.all([
      classRef.get(),
      db.collection('student_course_enrollments').where('classId', '==', target.classId).get(),
      db.collection('course_fee_ledgers').where('classId', '==', target.classId).get(),
      db.collection('attendance').where('classId', '==', target.classId).get(),
      db.collection('class_sessions').where('classId', '==', target.classId).get(),
    ]);
  if (!classSnapshot.exists) throw new Error(`TARGET_CLASS_NOT_FOUND:${target.classId}`);

  const enrollments = docs(enrollmentSnapshot);
  const openEnrollments = enrollments.filter((row) =>
    OPEN_ENROLLMENT_STATUSES.has(String(row.data.status || ''))
  );
  const studentIds = [...new Set(openEnrollments.map((row) => String(row.data.studentId || '')))];
  const studentSnapshots = studentIds.length
    ? await db.getAll(...studentIds.map((id) => db.collection('students').doc(id)))
    : [];
  const students = studentSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => stored(snapshot));

  return {
    target,
    classDoc: stored(classSnapshot),
    enrollments,
    openEnrollments,
    ledgers: docs(ledgerSnapshot),
    students,
    attendance: docs(attendanceSnapshot),
    sessions: docs(sessionSnapshot),
  };
}

function analyze(state: Awaited<ReturnType<typeof loadTarget>>) {
  const { target, classDoc, openEnrollments, ledgers, students } = state;
  if (classDoc.data.name !== target.expectedName) {
    throw new Error(`CLASS_NAME_PRECONDITION_FAILED:${target.classId}`);
  }
  if (
    classDoc.data.startDate !== target.currentStart ||
    classDoc.data.endDate !== target.currentEnd
  ) {
    throw new Error(
      `CLASS_DATE_PRECONDITION_FAILED:${target.classId}:${classDoc.data.startDate}..${classDoc.data.endDate}`
    );
  }
  if (openEnrollments.length === 0) {
    throw new Error(`OPEN_ENROLLMENTS_MISSING:${target.classId}`);
  }

  const sourceStarts = [...new Set(openEnrollments.map((row) => String(row.data.termStart || '')))];
  const sourceEnds = [...new Set(openEnrollments.map((row) => String(row.data.termEnd || '')))];
  const aligned = sourceStarts.length === 1 && sourceStarts[0] === target.currentStart;
  if (!aligned && sourceStarts.length !== 1) {
    throw new Error(`MULTIPLE_OPEN_ENROLLMENT_TERMS:${target.classId}:${sourceStarts.join(',')}`);
  }
  const sourceStart = sourceStarts[0];
  const sourceEnd = sourceEnds.length === 1 ? sourceEnds[0] : null;

  const targetIds = new Map(
    openEnrollments.map((row) => {
      const studentId = String(row.data.studentId || '');
      return [
        studentId,
        makeStudentCourseEnrollmentId(studentId, target.classId, target.currentStart),
      ];
    })
  );
  const sourceIds = new Set(openEnrollments.map((row) => row.id));
  const targetCollisions = state.enrollments.filter(
    (row) => !sourceIds.has(row.id) && [...targetIds.values()].includes(row.id)
  );
  if (targetCollisions.length > 0) {
    throw new Error(
      `TARGET_ENROLLMENT_COLLISION:${target.classId}:${targetCollisions
        .map((row) => row.id)
        .join(',')}`
    );
  }

  const studentById = new Map(students.map((row) => [row.id, row]));
  const missingStudents = [...targetIds.keys()].filter((studentId) => !studentById.has(studentId));
  if (missingStudents.length > 0) {
    throw new Error(`STUDENT_PROFILE_MISSING:${target.classId}:${missingStudents.join(',')}`);
  }
  const pointerConflicts = openEnrollments.filter((row) => {
    const studentId = String(row.data.studentId || '');
    const pointer = String(studentById.get(studentId)?.data.currentEnrollmentId || '');
    return pointer && pointer !== row.id && pointer !== targetIds.get(studentId);
  });
  if (pointerConflicts.length > 0) {
    throw new Error(
      `CURRENT_ENROLLMENT_POINTER_CONFLICT:${target.classId}:${pointerConflicts
        .map((row) => row.data.studentId)
        .join(',')}`
    );
  }

  const relevantLedgers = ledgers.filter((row) => {
    const studentId = String(row.data.studentId || '');
    return (
      sourceIds.has(String(row.data.enrollmentId || '')) ||
      (row.data.termStart === sourceStart && targetIds.has(studentId))
    );
  });
  const ledgerIdsByStudent = new Map<string, string[]>();
  for (const ledger of relevantLedgers) {
    const studentId = String(ledger.data.studentId || '');
    const bucket = ledgerIdsByStudent.get(studentId) || [];
    bucket.push(ledger.id);
    ledgerIdsByStudent.set(studentId, bucket);
  }
  const ledgerDuplicates = [...ledgerIdsByStudent.entries()].filter(
    ([, ledgerIds]) => ledgerIds.length > 1
  );
  if (ledgerDuplicates.length > 0) {
    throw new Error(
      `SOURCE_LEDGER_DUPLICATE:${target.classId}:${ledgerDuplicates
        .map(([studentId, ledgerIds]) => `${studentId}=${ledgerIds.join(',')}`)
        .join(';')}`
    );
  }
  const relevantLedgerIds = new Set(relevantLedgers.map((row) => row.id));
  const ledgerCollisions = ledgers.filter((row) => {
    if (relevantLedgerIds.has(row.id)) return false;
    return (
      row.data.termStart === target.currentStart && targetIds.has(String(row.data.studentId || ''))
    );
  });
  if (ledgerCollisions.length > 0) {
    throw new Error(
      `TARGET_LEDGER_COLLISION:${target.classId}:${ledgerCollisions.map((row) => row.id).join(',')}`
    );
  }

  const courseJoinRowsToMove = students.filter((student) =>
    Array.isArray(student.data.courseJoins)
      ? student.data.courseJoins.some(
          (row: Record<string, unknown>) =>
            row?.classId === target.classId && row?.termStart === sourceStart
        )
      : false
  ).length;

  return {
    decision: aligned ? ('noop' as const) : ('align' as const),
    sourceStart,
    sourceEnd,
    studentIds: [...targetIds.keys()],
    summary: {
      classId: target.classId,
      className: target.expectedName,
      classDatesKept: `${target.currentStart}..${target.currentEnd}`,
      sourceEnrollmentTerm: `${sourceStart}..${sourceEnd || '(mixed)'}`,
      openEnrollments: openEnrollments.length,
      enrollmentDocumentsToMove: aligned ? 0 : openEnrollments.length,
      studentPointersToAlign: aligned ? 0 : openEnrollments.length,
      courseJoinRowsToMove: aligned ? 0 : courseJoinRowsToMove,
      ledgersToAlign: aligned ? 0 : relevantLedgers.length,
      attendanceRowsPreserved: state.attendance.length,
      classSessionsPreserved: state.sessions.length,
    },
  };
}

function backupTarget(state: Awaited<ReturnType<typeof loadTarget>>) {
  const compact = (rows: StoredDoc[]) =>
    rows.map((row) => ({ id: row.id, version: row.version, data: row.data }));
  return {
    target: state.target,
    classDoc: compact([state.classDoc]),
    enrollments: compact(state.enrollments),
    ledgers: compact(state.ledgers),
    students: compact(state.students),
    attendanceEvidence: state.attendance.map((row) => ({ id: row.id, version: row.version })),
    sessionEvidence: state.sessions.map((row) => ({ id: row.id, version: row.version })),
  };
}

function sourceVersions(state: Awaited<ReturnType<typeof loadTarget>>) {
  return {
    classDoc: versionKey([state.classDoc]),
    enrollments: versionKey(state.enrollments),
    ledgers: versionKey(state.ledgers),
    students: versionKey(state.students),
    attendance: versionKey(state.attendance),
    sessions: versionKey(state.sessions),
  };
}

async function touchRealtimeEvents(classIds: string[]) {
  const events = [
    ['students', null],
    ['finance-ledger', null],
    ['accounting-students', null],
    ['accounting-student-finance', null],
    ['office-academic-changed', classIds.join(',')],
  ] as const;
  await Promise.all(
    events.map(([key, targetId]) =>
      db
        .collection('realtime_events')
        .doc(key)
        .set(
          {
            key,
            version: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
            targetId,
          },
          { merge: true }
        )
    )
  );
}

const initialStates = await Promise.all(TARGETS.map((target) => loadTarget(target)));
const initialPlans = initialStates.map((state) => analyze(state));

if (!APPLY) {
  console.log(
    JSON.stringify(
      {
        mode: 'dry-run',
        databaseId: DATABASE_ID,
        targets: initialPlans.map((plan) => ({ decision: plan.decision, ...plan.summary })),
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (option('--confirm') !== APPLY_CONFIRMATION) {
  throw new Error(`APPLY_CONFIRMATION_MISMATCH: expected --confirm=${APPLY_CONFIRMATION}`);
}

const generatedAt = new Date().toISOString();
const backupPath = path.join(
  'backups',
  `current-class-term-enrollment-repair-${generatedAt.replace(/[:.]/g, '-')}.json`
);
await mkdir(path.dirname(backupPath), { recursive: true });
await writeFile(
  backupPath,
  JSON.stringify(
    {
      generatedAt,
      databaseId: DATABASE_ID,
      targets: initialStates.map((state) => backupTarget(state)),
    },
    null,
    2
  ),
  { encoding: 'utf8', flag: 'wx' }
);

const applyResults = [];
for (let index = 0; index < initialStates.length; index += 1) {
  const initialState = initialStates[index];
  const initialPlan = initialPlans[index];
  const freshState = await loadTarget(initialState.target);
  if (JSON.stringify(sourceVersions(freshState)) !== JSON.stringify(sourceVersions(initialState))) {
    throw new Error(`SOURCE_CHANGED_AFTER_BACKUP:${initialState.target.classId}`);
  }

  let syncResult: Awaited<ReturnType<typeof executeClassUpdateAndSyncAtomic>> | null = null;
  if (initialPlan.decision === 'align') {
    syncResult = await executeClassUpdateAndSyncAtomic(
      db,
      initialState.target.classId,
      {},
      {
        actorId: 'codex-data-repair',
        termDateChange: {
          beforeStartDate: initialPlan.sourceStart,
          beforeEndDate: initialPlan.sourceEnd,
          afterStartDate: initialState.target.currentStart,
          afterEndDate: initialState.target.currentEnd,
        },
      }
    );
  }

  const verifiedState = await loadTarget(initialState.target);
  const verifiedPlan = analyze(verifiedState);
  if (verifiedPlan.decision !== 'noop') {
    throw new Error(`POST_REPAIR_ALIGNMENT_FAILED:${initialState.target.classId}`);
  }
  if (
    versionKey(verifiedState.attendance) !== versionKey(initialState.attendance) ||
    versionKey(verifiedState.sessions) !== versionKey(initialState.sessions) ||
    versionKey([verifiedState.classDoc]) !== versionKey([initialState.classDoc])
  ) {
    throw new Error(`POST_REPAIR_PRESERVATION_FAILED:${initialState.target.classId}`);
  }

  const summaryRefresh = await refreshAccountingStudentSummariesAfterCommit(
    db,
    initialPlan.studentIds,
    'current-class-term-enrollment-repair',
    { actorId: 'codex-data-repair', operation: 'repair:current-class-term-enrollments' }
  );
  if (summaryRefresh.failed.length > 0) {
    throw new Error(
      `ACCOUNTING_SUMMARY_REFRESH_FAILED:${initialState.target.classId}:${summaryRefresh.failed.join(',')}`
    );
  }

  const auditRef = db
    .collection('audit_logs')
    .doc(`data_repair_current_class_term_2026_08_16_${initialState.target.classId}`);
  const auditSnapshot = await auditRef.get();
  if (!auditSnapshot.exists) {
    await auditRef.create({
      userId: 'codex-data-repair',
      userRole: 'system',
      userName: 'Codex data repair',
      action: 'update',
      collection: 'student_course_enrollments',
      documentId: initialState.target.classId,
      changes: {
        enrollmentTerm: {
          before: `${initialPlan.sourceStart}..${initialPlan.sourceEnd || '(mixed)'}`,
          after: `${initialState.target.currentStart}..${initialState.target.currentEnd}`,
        },
      },
      metadata: {
        event: 'current_class_term_enrollment_alignment',
        className: initialState.target.expectedName,
        classDatesChanged: false,
        enrollmentDocumentsMoved: syncResult?.movedEnrollmentDocuments || 0,
        courseFeeLedgersUpdated: syncResult?.updatedLedgers || 0,
        attendanceRowsPreserved: initialState.attendance.length,
        classSessionsPreserved: initialState.sessions.length,
        backupPath,
      },
      timestamp: generatedAt,
    });
  }

  applyResults.push({
    classId: initialState.target.classId,
    className: initialState.target.expectedName,
    applied: initialPlan.decision === 'align',
    syncResult,
    summaryRefresh,
    verification: verifiedPlan.summary,
  });
}

await touchRealtimeEvents(TARGETS.map((target) => target.classId));

console.log(
  JSON.stringify(
    {
      mode: 'apply',
      backupPath,
      results: applyResults,
    },
    null,
    2
  )
);
