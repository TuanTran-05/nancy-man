/**
 * READ-ONLY diagnostic: students whose payment badge says "Đã đóng" but the
 * "Thu tiền" dialog still lists công nợ.
 *
 * Reproduces both sides exactly:
 *  - badge  = accounting_student_summaries.currentCoursePaymentStatus (list view)
 *  - dialog = GET finance/wallet/student-context => every course_fee_ledger of
 *             the student with ledgerRemaining(ledger) > 0
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);

const money = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const remaining = (l: any) =>
  Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const net = (l: any) => Math.max(0, money(l.amount) - money(l.discountTotal));

const today = new Date().toISOString().slice(0, 10);
function deriveStatus(input: {
  ledgerExists: boolean;
  netAmount: number;
  paid: number;
  dueDate?: string | null;
  waived?: boolean;
}) {
  if (input.waived) return 'waived';
  if (!input.ledgerExists) return 'missing_ledger';
  if (input.netAmount <= 0) return 'paid';
  if (input.paid >= input.netAmount) return 'paid';
  if (input.paid > 0) return input.dueDate && input.dueDate < today ? 'overdue' : 'partial';
  if (input.dueDate && input.dueDate < today) return 'overdue';
  return 'unpaid';
}

console.log('loading collections...');
const [studentsSnap, enrollSnap, ledgerSnap, summarySnap, classesSnap, receiptsSnap] =
  await Promise.all([
    db.collection('students').get(),
    db.collection('student_course_enrollments').get(),
    db.collection('course_fee_ledgers').get(),
    db.collection('accounting_student_summaries').get(),
    db.collection('classes').get(),
    db.collection('receipts').get(),
  ]);

console.log(
  `students=${studentsSnap.size} enrollments=${enrollSnap.size} ledgers=${ledgerSnap.size} summaries=${summarySnap.size} classes=${classesSnap.size} receipts=${receiptsSnap.size}`
);

const classNameById = new Map(classesSnap.docs.map((d) => [d.id, String(d.data()?.name || '')]));
const summaryById = new Map(summarySnap.docs.map((d) => [d.id, d.data() as any]));

const enrollByStudent = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const key = String(e.studentId || '');
  if (!enrollByStudent.has(key)) enrollByStudent.set(key, []);
  enrollByStudent.get(key)!.push(e);
}

const ledgersByStudent = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ...(d.data() as any) };
  const key = String(l.studentId || '');
  if (!ledgersByStudent.has(key)) ledgersByStudent.set(key, []);
  ledgersByStudent.get(key)!.push(l);
}

// posted receipt money per ledger, to test whether paidTotal matches its receipts
const postedByLedger = new Map<string, number>();
let receiptsWithoutAlloc = 0;
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  if (String(r.status || '') !== 'posted') continue;
  const allocs = Array.isArray(r.allocations) ? r.allocations : [];
  if (!allocs.length && r.ledgerId) {
    postedByLedger.set(
      String(r.ledgerId),
      (postedByLedger.get(String(r.ledgerId)) || 0) + money(r.amountReceived)
    );
    continue;
  }
  if (!allocs.length) {
    if (!r.walletDeposit) receiptsWithoutAlloc += 1;
    continue;
  }
  for (const a of allocs) {
    const id = String(a.ledgerId || '');
    if (!id) continue;
    postedByLedger.set(id, (postedByLedger.get(id) || 0) + money(a.amount));
  }
}

type Row = {
  studentId: string;
  studentCode: string;
  studentName: string;
  badgeStored: string;
  badgeRecomputed: string;
  currentClass: string;
  dialogDebt: number;
  dialogLedgers: Array<{
    id: string;
    classId: string;
    className: string;
    termStart: string;
    status: string;
    amount: number;
    paid: number;
    discount: number;
    remaining: number;
    isCurrentCourse: boolean;
    hasEnrollment: boolean;
  }>;
  reasons: string[];
};

const rows: Row[] = [];
const reasonCounts = new Map<string, number>();
const bump = (r: string) => reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);

// global data-integrity counters (independent of the badge mismatch)
let ledgerStatusPaidButOwing = 0;
let ledgerStatusUnpaidButSettled = 0;
let ledgerNegativePaid = 0;
let ledgerOverpaid = 0;
let ledgerPaidMismatchReceipts = 0;
let duplicateLedgerGroups = 0;
let orphanLedgers = 0;
const duplicateSamples: any[] = [];
const paidMismatchSamples: any[] = [];

for (const sd of studentsSnap.docs) {
  const student = { id: sd.id, ...(sd.data() as any) };
  const enrollments = enrollByStudent.get(student.id) || [];
  const ledgers = ledgersByStudent.get(student.id) || [];

  const enrollmentClassIds = new Set(enrollments.map((e) => String(e.classId || '')));

  // duplicate ledgers for the same student+class+termStart
  const tupleCounts = new Map<string, any[]>();
  for (const l of ledgers) {
    const key = `${l.classId || ''}|${l.termStart || ''}`;
    if (!tupleCounts.has(key)) tupleCounts.set(key, []);
    tupleCounts.get(key)!.push(l);
  }
  for (const [key, group] of tupleCounts) {
    if (group.length > 1) {
      duplicateLedgerGroups += 1;
      if (duplicateSamples.length < 15)
        duplicateSamples.push({
          studentId: student.id,
          studentName: student.name,
          tuple: key,
          ledgers: group.map((l) => ({
            id: l.id,
            amount: money(l.amount),
            paid: money(l.paidTotal),
            status: l.status,
            remaining: remaining(l),
          })),
        });
    }
  }

  for (const l of ledgers) {
    const rem = remaining(l);
    const st = String(l.status || '');
    if ((st === 'paid' || st === 'waived') && rem > 0) ledgerStatusPaidButOwing += 1;
    if (st === 'unpaid' && rem <= 0 && net(l) > 0) ledgerStatusUnpaidButSettled += 1;
    if (money(l.paidTotal) < 0) ledgerNegativePaid += 1;
    if (money(l.paidTotal) > net(l) && net(l) > 0) ledgerOverpaid += 1;
    if (String(l.classId || '') && !enrollmentClassIds.has(String(l.classId))) orphanLedgers += 1;
    const fromReceipts = postedByLedger.get(l.id) || 0;
    if (Math.abs(fromReceipts - money(l.paidTotal)) > 1) {
      ledgerPaidMismatchReceipts += 1;
      if (paidMismatchSamples.length < 15)
        paidMismatchSamples.push({
          ledgerId: l.id,
          studentId: student.id,
          studentName: student.name,
          classId: l.classId,
          className: classNameById.get(String(l.classId)) || '',
          ledgerPaidTotal: money(l.paidTotal),
          sumPostedReceipts: fromReceipts,
          diff: money(l.paidTotal) - fromReceipts,
          status: l.status,
        });
    }
  }

  // --- badge side (list view) ---
  const stored = summaryById.get(student.id);
  const open = enrollments.filter((e) => ['trial', 'active', 'on_leave'].includes(String(e.status)));
  const current = open[0] || null;
  const ledgerByTuple = new Map<string, any>();
  const ledgerByClass = new Map<string, any>();
  for (const l of ledgers) {
    if (l.classId) {
      ledgerByTuple.set(`${l.classId}|${l.termStart || ''}`, l);
      ledgerByClass.set(String(l.classId), l);
    }
  }
  let badgeRecomputed = current ? 'missing_ledger' : 'paid';
  let currentLedgerId = '';
  if (current) {
    const l =
      ledgerByTuple.get(`${current.classId}|${current.termStart}`) ||
      ledgerByClass.get(String(current.classId));
    currentLedgerId = l?.id || '';
    badgeRecomputed = deriveStatus({
      ledgerExists: Boolean(l),
      netAmount: l ? net(l) : 0,
      paid: l ? money(l.paidTotal) : 0,
      dueDate: l?.dueDate,
      waived: l?.waived,
    });
  }
  const badgeStored = String(stored?.currentCoursePaymentStatus || '(no summary)');

  // --- dialog side (Thu tiền) ---
  const dialogLedgers = ledgers.filter((l) => remaining(l) > 0);
  const dialogDebt = dialogLedgers.reduce((s, l) => s + remaining(l), 0);

  const badgeSaysSettled = badgeStored === 'paid' || badgeStored === 'waived';
  if (!badgeSaysSettled || dialogDebt <= 0) continue;

  const reasons: string[] = [];
  if (badgeStored !== badgeRecomputed) reasons.push('stale_summary');
  const detail = dialogLedgers.map((l) => {
    const isCurrent = Boolean(currentLedgerId) && l.id === currentLedgerId;
    return {
      id: l.id,
      classId: String(l.classId || ''),
      className: classNameById.get(String(l.classId || '')) || '',
      termStart: String(l.termStart || ''),
      status: String(l.status || ''),
      amount: money(l.amount),
      paid: money(l.paidTotal),
      discount: money(l.discountTotal),
      remaining: remaining(l),
      isCurrentCourse: isCurrent,
      hasEnrollment: enrollmentClassIds.has(String(l.classId || '')),
    };
  });
  if (detail.some((d) => d.isCurrentCourse)) reasons.push('current_course_ledger_still_owing');
  if (detail.some((d) => !d.isCurrentCourse && d.hasEnrollment))
    reasons.push('other_course_debt');
  if (detail.some((d) => !d.hasEnrollment)) reasons.push('orphan_ledger_no_enrollment');
  if (detail.some((d) => d.status === 'paid' || d.status === 'waived'))
    reasons.push('ledger_status_says_paid_but_math_owes');
  if (!current) reasons.push('no_open_enrollment');
  if (!reasons.length) reasons.push('unclassified');
  reasons.forEach(bump);

  rows.push({
    studentId: student.id,
    studentCode: String(student.studentId || student.code || ''),
    studentName: String(student.name || ''),
    badgeStored,
    badgeRecomputed,
    currentClass: current ? classNameById.get(String(current.classId)) || String(current.classId) : '—',
    dialogDebt,
    dialogLedgers: detail,
    reasons,
  });
}

rows.sort((a, b) => b.dialogDebt - a.dialogDebt);

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    students: studentsSnap.size,
    ledgers: ledgerSnap.size,
    summaries: summarySnap.size,
    mismatchedStudents: rows.length,
    mismatchedDebtTotal: rows.reduce((s, r) => s + r.dialogDebt, 0),
  },
  reasonCounts: Object.fromEntries([...reasonCounts].sort((a, b) => b[1] - a[1])),
  ledgerIntegrity: {
    ledgerStatusPaidButOwing,
    ledgerStatusUnpaidButSettled,
    ledgerNegativePaid,
    ledgerOverpaid,
    ledgerPaidMismatchReceipts,
    duplicateLedgerGroups,
    orphanLedgers,
    receiptsPostedWithoutAllocations: receiptsWithoutAlloc,
  },
  duplicateSamples,
  paidMismatchSamples,
  top30: rows.slice(0, 30),
};

const out = process.argv[2] || 'paid-but-owing-report.json';
await writeFile(out, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ...report, top30: `see ${out}`, duplicateSamples: duplicateSamples.length, paidMismatchSamples: paidMismatchSamples.length }, null, 2));
