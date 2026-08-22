import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { FieldValue, getDocumentStore } from '@/server/db/documentStore.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';
import { courseTuitionDueDate } from '../shared/tuitionDueDate.js';

const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const CLASS_ID = 'pAKl7xpSLd1atr3eRofo';
const CLASS_NAME = 'Basic 6 - Mr. Anh Tuan T3-T5';
const BEFORE_START = '2026-06-23';
const BEFORE_END = '2026-08-13';
const LEGACY_EXTENDED_END = '2026-08-18';
const AFTER_START = '2026-06-18';
const AFTER_END = '2026-08-11';
const BEFORE_DUE = courseTuitionDueDate(BEFORE_START);
const AFTER_DUE = courseTuitionDueDate(AFTER_START);
const AUDIT_ID = 'data_repair_basic6_anh_tuan_2026_06_18_2026_08_11';

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
  data: Record<string, any>;
  version: string;
};

const stored = (snapshot: AppDocumentStore.DocumentSnapshot): StoredDoc => ({
  id: snapshot.id,
  ref: snapshot.ref,
  data: (snapshot.data() || {}) as Record<string, any>,
  version: snapshot.updateTime?.toDate().toISOString() || '',
});

const docs = (snapshot: AppDocumentStore.QuerySnapshot): StoredDoc[] =>
  snapshot.docs.map((doc) => stored(doc));

const versionKey = (rows: StoredDoc[]) =>
  rows
    .map((row) => `${row.id}@${row.version}`)
    .sort()
    .join('|');

const sum = (rows: StoredDoc[], field: string) =>
  rows.reduce((total, row) => total + (Number(row.data[field]) || 0), 0);

const compactBackup = (rows: StoredDoc[]) =>
  rows.map((row) => ({ id: row.id, version: row.version, data: row.data }));

const isScheduledTargetDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < AFTER_START || date > AFTER_END) {
    return false;
  }
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday === 2 || weekday === 4;
};

async function loadState() {
  const classRef = db.collection('classes').doc(CLASS_ID);
  const [classSnapshot, enrollmentSnapshot, ledgerSnapshot, attendanceSnapshot, sessionSnapshot,
    receiptSnapshot, auditSnapshot] = await Promise.all([
    classRef.get(),
    db.collection('student_course_enrollments').where('classId', '==', CLASS_ID).get(),
    db.collection('course_fee_ledgers').where('classId', '==', CLASS_ID).get(),
    db.collection('attendance').where('classId', '==', CLASS_ID).get(),
    db.collection('class_sessions').where('classId', '==', CLASS_ID).get(),
    db.collection('receipts').get(),
    db.collection('audit_logs').doc(AUDIT_ID).get(),
  ]);
  if (!classSnapshot.exists) throw new Error('TARGET_CLASS_NOT_FOUND');

  const enrollments = docs(enrollmentSnapshot);
  const studentIds = [...new Set(enrollments.map((row) => String(row.data.studentId || '')))];
  const studentSnapshots = studentIds.length
    ? await db.getAll(...studentIds.map((studentId) => db.collection('students').doc(studentId)))
    : [];
  const students = studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => stored(snapshot));
  const ledgers = docs(ledgerSnapshot);
  const ledgerIds = new Set(ledgers.map((row) => row.id));
  const receipts = docs(receiptSnapshot).filter((row) => {
    if (row.data.classId === CLASS_ID || ledgerIds.has(String(row.data.ledgerId || ''))) return true;
    return Array.isArray(row.data.allocations)
      ? row.data.allocations.some((allocation: Record<string, unknown>) =>
          ledgerIds.has(String(allocation?.ledgerId || ''))
        )
      : false;
  });

  return {
    classDoc: stored(classSnapshot),
    enrollments,
    ledgers,
    students,
    attendance: docs(attendanceSnapshot),
    sessions: docs(sessionSnapshot),
    receipts,
    audit: auditSnapshot.exists ? stored(auditSnapshot) : null,
  };
}

function assertReceiptReferences(state: Awaited<ReturnType<typeof loadState>>) {
  const ledgerIds = new Set(state.ledgers.map((row) => row.id));
  for (const receipt of state.receipts) {
    const references = [
      receipt.data.ledgerId,
      ...(Array.isArray(receipt.data.allocations)
        ? receipt.data.allocations.map((allocation: Record<string, unknown>) => allocation?.ledgerId)
        : []),
    ]
      .map((value) => String(value || ''))
      .filter(Boolean);
    if (references.some((ledgerId) => !ledgerIds.has(ledgerId))) {
      throw new Error(`BROKEN_RECEIPT_LEDGER_REFERENCE:${receipt.id}`);
    }
  }
}

function analyze(state: Awaited<ReturnType<typeof loadState>>) {
  const classData = state.classDoc.data;
  if (classData.name !== CLASS_NAME) throw new Error('CLASS_NAME_PRECONDITION_FAILED');
  if (JSON.stringify(classData.daysOfWeek) !== JSON.stringify([2, 4])) {
    throw new Error('CLASS_SCHEDULE_PRECONDITION_FAILED');
  }
  const before = classData.startDate === BEFORE_START && classData.endDate === BEFORE_END;
  const after = classData.startDate === AFTER_START && classData.endDate === AFTER_END;
  if (!before && !after) throw new Error('CLASS_DATE_PRECONDITION_FAILED');
  if (state.enrollments.length === 0 || state.ledgers.length === 0) {
    throw new Error('RELATED_DATA_MISSING');
  }
  if (state.enrollments.length !== state.ledgers.length) {
    throw new Error('ENROLLMENT_LEDGER_COUNT_MISMATCH');
  }

  const invalidAttendanceDates = [...new Set(
    state.attendance.map((row) => String(row.data.date || '')).filter((date) => !isScheduledTargetDate(date))
  )].sort();
  const invalidSessionDates = [...new Set(
    state.sessions.map((row) => String(row.data.date || '')).filter((date) => !isScheduledTargetDate(date))
  )].sort();
  if (invalidAttendanceDates.length) {
    throw new Error(`ATTENDANCE_OUTSIDE_TARGET_SCHEDULE:${invalidAttendanceDates.join(',')}`);
  }
  if (invalidSessionDates.length) {
    throw new Error(`CLASS_SESSIONS_OUTSIDE_TARGET_SCHEDULE:${invalidSessionDates.join(',')}`);
  }
  assertReceiptReferences(state);

  const studentById = new Map(state.students.map((row) => [row.id, row]));
  const enrollmentMoves = state.enrollments.map((row) => {
    const studentId = String(row.data.studentId || '');
    const expectedSourceId = makeStudentCourseEnrollmentId(studentId, CLASS_ID, BEFORE_START);
    const targetId = makeStudentCourseEnrollmentId(studentId, CLASS_ID, AFTER_START);
    const student = studentById.get(studentId);
    return {
      source: row,
      expectedSourceId,
      targetId,
      targetRef: db.collection('student_course_enrollments').doc(targetId),
      student,
      updateStudentReference: student?.data.currentEnrollmentId === row.id,
    };
  });

  if (before) {
    for (const move of enrollmentMoves) {
      const data = move.source.data;
      if (
        move.source.id !== move.expectedSourceId ||
        data.termStart !== BEFORE_START ||
        ![BEFORE_END, LEGACY_EXTENDED_END].includes(String(data.termEnd || ''))
      ) {
        throw new Error(`ENROLLMENT_PRECONDITION_FAILED:${move.source.id}`);
      }
    }
    for (const ledger of state.ledgers) {
      if (
        ledger.data.termStart !== BEFORE_START ||
        ![BEFORE_END, LEGACY_EXTENDED_END].includes(String(ledger.data.termEnd || '')) ||
        ledger.data.dueDate !== BEFORE_DUE
      ) {
        throw new Error(`LEDGER_PRECONDITION_FAILED:${ledger.id}`);
      }
    }
    if (state.audit) throw new Error('REPAIR_AUDIT_ALREADY_EXISTS');
  } else {
    for (const move of enrollmentMoves) {
      const data = move.source.data;
      if (move.source.id !== move.targetId || data.termStart !== AFTER_START || data.termEnd !== AFTER_END) {
        throw new Error(`ENROLLMENT_VERIFICATION_FAILED:${move.source.id}`);
      }
    }
    for (const ledger of state.ledgers) {
      const targetEnrollmentId = makeStudentCourseEnrollmentId(
        String(ledger.data.studentId || ''),
        CLASS_ID,
        AFTER_START
      );
      if (
        ledger.data.termStart !== AFTER_START ||
        ledger.data.termEnd !== AFTER_END ||
        ledger.data.dueDate !== AFTER_DUE ||
        ledger.data.enrollmentId !== targetEnrollmentId
      ) {
        throw new Error(`LEDGER_VERIFICATION_FAILED:${ledger.id}`);
      }
    }
    if (!state.audit) throw new Error('REPAIR_AUDIT_MISSING');
  }

  const attendanceDates = [...new Set(state.attendance.map((row) => String(row.data.date || '')))].sort();
  const sessionDates = [...new Set(state.sessions.map((row) => String(row.data.date || '')))].sort();
  return {
    mode: before ? 'update' as const : 'noop' as const,
    enrollmentMoves,
    attendanceDates,
    sessionDates,
    summary: {
      classId: CLASS_ID,
      className: CLASS_NAME,
      classDates: { before: `${classData.startDate}..${classData.endDate}`, after: `${AFTER_START}..${AFTER_END}` },
      enrollments: state.enrollments.length,
      enrollmentIdsToMove: before ? enrollmentMoves.length : 0,
      inferredJoinedAtToShift: before
        ? state.enrollments.filter((row) => row.data.joinedAt === BEFORE_START).length
        : 0,
      studentCurrentEnrollmentRefsToUpdate: before
        ? enrollmentMoves.filter((move) => move.updateStudentReference).length
        : 0,
      ledgers: state.ledgers.length,
      ledgerDateFieldsToUpdate: before ? state.ledgers.length : 0,
      ledgerDocumentIdsRetained: state.ledgers.length,
      tuitionDueDate: { before: BEFORE_DUE, after: AFTER_DUE },
      ledgerAmountTotal: sum(state.ledgers, 'amount'),
      ledgerPaidTotal: sum(state.ledgers, 'paidTotal'),
      ledgerDiscountTotal: sum(state.ledgers, 'discountTotal'),
      linkedReceipts: state.receipts.length,
      attendanceRows: state.attendance.length,
      attendanceDates,
      attendanceRowsToUpdate: 0,
      classSessions: state.sessions.length,
      sessionDates,
      classSessionsToUpdate: 0,
    },
  };
}

function writeVersions(state: Awaited<ReturnType<typeof loadState>>) {
  return {
    classDoc: versionKey([state.classDoc]),
    enrollments: versionKey(state.enrollments),
    ledgers: versionKey(state.ledgers),
    students: versionKey(state.students),
  };
}

async function applyRepair(state: Awaited<ReturnType<typeof loadState>>) {
  const plan = analyze(state);
  if (plan.mode === 'noop') return { applied: false, backupPath: null, plan };

  if (
    option('--confirm-class') !== CLASS_ID ||
    option('--confirm-before') !== `${BEFORE_START}..${BEFORE_END}` ||
    option('--confirm-after') !== `${AFTER_START}..${AFTER_END}`
  ) {
    throw new Error('APPLY_CONFIRMATION_MISMATCH');
  }

  const targetSnapshots = await db.getAll(...plan.enrollmentMoves.map((move) => move.targetRef));
  const collisions = targetSnapshots.filter((snapshot) => snapshot.exists);
  if (collisions.length) {
    throw new Error(`TARGET_ENROLLMENT_ID_COLLISION:${collisions.map((snapshot) => snapshot.id).join(',')}`);
  }

  const generatedAt = new Date().toISOString();
  const safeTimestamp = generatedAt.replace(/[:.]/g, '-');
  const backupPath = path.join('backups', `basic6-anh-tuan-term-date-repair-${safeTimestamp}.json`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        repair: AUDIT_ID,
        generatedAt,
        databaseId: DATABASE_ID,
        classId: CLASS_ID,
        intendedChange: { startDate: [BEFORE_START, AFTER_START], endDate: [BEFORE_END, AFTER_END] },
        classDoc: compactBackup([state.classDoc]),
        enrollments: compactBackup(state.enrollments),
        ledgers: compactBackup(state.ledgers),
        students: state.students.map((row) => ({
          id: row.id,
          version: row.version,
          currentEnrollmentId: row.data.currentEnrollmentId ?? null,
        })),
        attendanceEvidence: compactBackup(state.attendance),
        classSessionEvidence: compactBackup(state.sessions),
        linkedReceiptEvidence: compactBackup(state.receipts),
      },
      null,
      2
    ),
    { encoding: 'utf8', flag: 'wx' }
  );

  const expectedVersions = writeVersions(state);
  await db.runTransaction(async (transaction) => {
    const classRef = db.collection('classes').doc(CLASS_ID);
    const auditRef = db.collection('audit_logs').doc(AUDIT_ID);
    const [classSnapshot, enrollmentSnapshot, ledgerSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(classRef),
      transaction.get(db.collection('student_course_enrollments').where('classId', '==', CLASS_ID)),
      transaction.get(db.collection('course_fee_ledgers').where('classId', '==', CLASS_ID)),
      transaction.get(auditRef),
    ]);
    const studentSnapshots = await transaction.getAll(
      ...state.students.map((row) => db.collection('students').doc(row.id))
    );
    const collisionSnapshots = await transaction.getAll(
      ...plan.enrollmentMoves.map((move) => move.targetRef)
    );
    if (!classSnapshot.exists) throw new Error('TARGET_CLASS_DISAPPEARED');
    if (auditSnapshot.exists) throw new Error('REPAIR_AUDIT_CONFLICT');
    if (collisionSnapshots.some((snapshot) => snapshot.exists)) {
      throw new Error('TARGET_ENROLLMENT_COLLISION_DURING_TRANSACTION');
    }

    const transactionState = {
      classDoc: stored(classSnapshot),
      enrollments: docs(enrollmentSnapshot),
      ledgers: docs(ledgerSnapshot),
      students: studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => stored(snapshot)),
    };
    if (
      versionKey([transactionState.classDoc]) !== expectedVersions.classDoc ||
      versionKey(transactionState.enrollments) !== expectedVersions.enrollments ||
      versionKey(transactionState.ledgers) !== expectedVersions.ledgers ||
      versionKey(transactionState.students) !== expectedVersions.students
    ) {
      throw new Error('SOURCE_CHANGED_AFTER_BACKUP');
    }

    const enrollmentIdByStudent = new Map<string, string>();
    for (const move of plan.enrollmentMoves) {
      const studentId = String(move.source.data.studentId || '');
      enrollmentIdByStudent.set(studentId, move.targetId);
      transaction.create(move.targetRef, {
        ...move.source.data,
        id: move.targetId,
        termStart: AFTER_START,
        termEnd: AFTER_END,
        joinedAt: move.source.data.joinedAt === BEFORE_START ? AFTER_START : move.source.data.joinedAt,
        updatedAt: generatedAt,
        serverUpdatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(move.source.ref);
      if (move.updateStudentReference && move.student) {
        transaction.update(move.student.ref, {
          currentEnrollmentId: move.targetId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    for (const ledger of state.ledgers) {
      const targetEnrollmentId = enrollmentIdByStudent.get(String(ledger.data.studentId || ''));
      if (!targetEnrollmentId) throw new Error(`LEDGER_WITHOUT_ENROLLMENT:${ledger.id}`);
      transaction.update(ledger.ref, {
        enrollmentId: targetEnrollmentId,
        termStart: AFTER_START,
        termEnd: AFTER_END,
        dueDate: AFTER_DUE,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(classRef, {
      startDate: AFTER_START,
      endDate: AFTER_END,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      userId: 'codex-data-repair',
      userRole: 'system',
      userName: 'Codex data repair',
      action: 'update',
      collection: 'classes',
      documentId: CLASS_ID,
      changes: {
        startDate: { before: BEFORE_START, after: AFTER_START },
        endDate: { before: BEFORE_END, after: AFTER_END },
      },
      metadata: {
        event: 'basic6_anh_tuan_term_date_alignment',
        enrollmentDocumentsMoved: plan.enrollmentMoves.length,
        studentCurrentEnrollmentRefsUpdated: plan.summary.studentCurrentEnrollmentRefsToUpdate,
        courseFeeLedgersUpdated: state.ledgers.length,
        ledgerDocumentIdsRetainedForReceiptStability: state.ledgers.length,
        linkedReceiptsVerifiedUnchanged: state.receipts.length,
        attendanceRowsVerifiedUnchanged: state.attendance.length,
        classSessionsVerifiedUnchanged: state.sessions.length,
        tuitionDueDateBefore: BEFORE_DUE,
        tuitionDueDateAfter: AFTER_DUE,
        backupPath,
      },
      timestamp: generatedAt,
    });
  });

  const verifiedState = await loadState();
  const verifiedPlan = analyze(verifiedState);
  if (verifiedPlan.mode !== 'noop') throw new Error('POST_REPAIR_VERIFICATION_FAILED');
  if (
    sum(verifiedState.ledgers, 'amount') !== sum(state.ledgers, 'amount') ||
    sum(verifiedState.ledgers, 'paidTotal') !== sum(state.ledgers, 'paidTotal') ||
    sum(verifiedState.ledgers, 'discountTotal') !== sum(state.ledgers, 'discountTotal') ||
    versionKey(verifiedState.attendance) !== versionKey(state.attendance) ||
    versionKey(verifiedState.sessions) !== versionKey(state.sessions) ||
    versionKey(verifiedState.receipts) !== versionKey(state.receipts)
  ) {
    throw new Error('POST_REPAIR_INVARIANT_FAILED');
  }
  return { applied: true, backupPath, plan: verifiedPlan };
}

const initialState = await loadState();
const initialPlan = analyze(initialState);
if (!APPLY) {
  console.log(JSON.stringify({ mode: 'dry-run', projectId: serviceAccount.project_id, databaseId: DATABASE_ID, decision: initialPlan.mode, ...initialPlan.summary }, null, 2));
  process.exit(0);
}

const result = await applyRepair(initialState);
console.log(JSON.stringify({ mode: 'apply', applied: result.applied, backupPath: result.backupPath, verification: result.plan.summary }, null, 2));
