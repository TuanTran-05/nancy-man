/**
 * Xóa và tạo lại công nợ của các khóa ĐANG học, giữ nguyên lịch sử đã đóng.
 *
 * Phương án A đã duyệt 2026-08-10. Chỉ những ledger mà planner sẽ dựng lại
 * (enrollment đang mở) mới bị xóa; 113 ledger của khóa đã kết thúc — đang giữ
 * 45.670.000 ₫ học sinh đã đóng — không nằm trong phạm vi và không bị chạm tới.
 *
 * `receipts` và `wallet_transactions` KHÔNG bị xóa. Chúng là sổ gốc của tiền và
 * hiện khớp tuyệt đối với ledger, nên tiền được replay từ chúng chứ không phải
 * dựng lại từ một bản chép. Ledger id là tất định (studentId_classId_term) nên
 * ánh xạ cũ→mới là 1-1, không có chỗ cho suy đoán.
 *
 * Dry run mặc định. `--apply` mới ghi.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { planClassLedgers } from '../server/api/lib/accounting/courseLedgerPlanner.js';
import { courseTuitionDueDate } from '../shared/tuitionDueDate.js';

const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const manifestPath =
  process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1] ||
  `migration-manifest-rebuild-open-ledgers-${stamp}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db: DocumentStore = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  databaseId
);

const m = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const [classesSnap, enrollSnap, ledgerSnap, receiptsSnap, invoicesSnap, paymentsSnap] =
  await Promise.all([
    db.collection('classes').get(),
    db.collection('student_course_enrollments').get(),
    db.collection('course_fee_ledgers').get(),
    db.collection('receipts').get(),
    db.collection('invoices').get(),
    db.collection('payment_requests').get(),
  ]);

/** Anything here means the world moved since the plan was approved. */
const guards: string[] = [];
if (invoicesSnap.size > 0) guards.push(`invoices có ${invoicesSnap.size} doc — chúng trỏ vào ledger`);
if (paymentsSnap.size > 0)
  guards.push(`payment_requests có ${paymentsSnap.size} doc — có giao dịch online đang treo`);

// ---------------------------------------------------------------- the plan
const enrollByClass = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const k = String(e.classId || '');
  if (!enrollByClass.has(k)) enrollByClass.set(k, []);
  enrollByClass.get(k)!.push(e);
}

const planned = new Map<string, { classId: string; ledger: any }>();
for (const c of classesSnap.docs) {
  const enrolls = (enrollByClass.get(c.id) || []).map((e) => ({
    id: e.id,
    studentId: String(e.studentId || ''),
    classId: c.id,
    termStart: String(e.termStart || ''),
    termEnd: e.termEnd ?? null,
    status: e.status,
  }));
  const plan = planClassLedgers({
    classId: c.id,
    classData: c.data() as any,
    enrollments: enrolls,
    ledgers: [],
  });
  if (plan.skipReason) continue;
  for (const l of plan.creates) planned.set(String(l.ledgerId), { classId: c.id, ledger: l });
}

const existing = ledgerSnap.docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() as any }));
const toDelete = existing.filter((l) => planned.has(l.id));
const toKeep = existing.filter((l) => !planned.has(l.id));

// ------------------------------------------------------- money to replay
// Posted receipts are the sole record of collection; allocations say which
// ledger each slice belongs to.
const replay = new Map<string, { paid: number; discount: number; sibling: number }>();
const add = (id: string, paid: number, discount: number, sibling: number) => {
  const cur = replay.get(id) || { paid: 0, discount: 0, sibling: 0 };
  cur.paid += paid;
  cur.discount += discount;
  cur.sibling += sibling;
  replay.set(id, cur);
};
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  if (String(r.status || '') !== 'posted') continue;
  const allocs = Array.isArray(r.allocations) ? r.allocations : [];
  if (!allocs.length && r.ledgerId) {
    add(String(r.ledgerId), m(r.amountReceived), 0, 0);
    continue;
  }
  for (const a of allocs) {
    const id = String(a.ledgerId || '');
    if (!id) continue;
    add(id, m(a.amount), m(a.discountAmount), m(a.siblingDiscountAmount));
  }
}

/** Money that lands on a ledger this run will not recreate is money that would vanish. */
const replayOntoMissing = [...replay.entries()].filter(
  ([id, v]) => v.paid > 0 && !planned.has(id) && !toKeep.some((k) => k.id === id)
);
if (replayOntoMissing.length)
  guards.push(
    `${replayOntoMissing.length} ledger nhận tiền nhưng không được giữ lẫn tạo lại (${replayOntoMissing.reduce((s, [, v]) => s + v.paid, 0)} ₫)`
  );

const deriveStatus = (amount: number, discount: number, paid: number) => {
  const net = Math.max(0, amount - discount);
  if (net <= 0) return 'paid';
  if (paid >= net) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
};

// ---------------------------------------------------------------- forecast
let recreatedBilled = 0;
let replayedMoney = 0;
const statusForecast: Record<string, number> = {};
const overpay: any[] = [];
for (const [ledgerId, { ledger }] of planned) {
  const money = replay.get(ledgerId) || { paid: 0, discount: 0, sibling: 0 };
  recreatedBilled += m(ledger.amount);
  replayedMoney += money.paid;
  const st = deriveStatus(m(ledger.amount), money.discount, money.paid);
  statusForecast[st] = (statusForecast[st] || 0) + 1;
  if (money.paid > Math.max(0, m(ledger.amount) - money.discount)) {
    overpay.push({ ledgerId, amount: m(ledger.amount), paid: money.paid });
  }
}
if (overpay.length) guards.push(`${overpay.length} ledger sẽ bị thu quá sau khi dựng lại`);

const keptPaid = toKeep.reduce((s, l) => s + m(l.data.paidTotal), 0);
const paidBefore = existing.reduce((s, l) => s + m(l.data.paidTotal), 0);

const manifest: Record<string, unknown> = {
  migration: 'rebuild_open_course_ledgers',
  approvedPlan: 'A — giữ lịch sử khóa đã kết thúc',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  databaseId,
  guards,
  before: {
    ledgers: existing.length,
    billed: existing.reduce((s, l) => s + m(l.data.amount), 0),
    paidTotal: paidBefore,
  },
  scope: {
    willDelete: toDelete.length,
    willKeep: toKeep.length,
    willCreate: planned.size,
    keptPaidMoney: keptPaid,
  },
  forecast: {
    recreatedBilled,
    replayedMoney,
    paidAfter: replayedMoney + keptPaid,
    statusForecast,
  },
  untouched: ['receipts', 'wallet_transactions', 'students', 'classes', 'student_course_enrollments'],
  // Verbatim copy of every row this run destroys: the only way back.
  deletedDocs: toDelete.map((l) => ({ __id: l.id, ...l.data })),
  deleted: 0,
  created: 0,
  summariesRebuilt: 0,
  summariesFailed: [] as string[],
};

if (APPLY) {
  if (guards.length) throw new Error(`Dừng lại vì guard: ${guards.join(' | ')}`);
  // The manifest is the only copy of the deleted rows: write it before deleting.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  let batch = db.batch();
  let writes = 0;
  const flush = async () => {
    if (writes) await batch.commit();
    batch = db.batch();
    writes = 0;
  };

  for (const l of toDelete) {
    batch.delete(l.ref);
    writes += 1;
    manifest.deleted = (manifest.deleted as number) + 1;
    if (writes >= 400) await flush();
  }
  await flush();

  for (const [ledgerId, { classId, ledger }] of planned) {
    const money = replay.get(ledgerId) || { paid: 0, discount: 0, sibling: 0 };
    batch.create(db.collection('course_fee_ledgers').doc(ledgerId), {
      studentId: ledger.studentId,
      classId,
      amount: m(ledger.amount),
      paidTotal: money.paid,
      discountTotal: money.discount,
      ...(money.sibling ? { siblingDiscountTotal: money.sibling } : {}),
      status: deriveStatus(m(ledger.amount), money.discount, money.paid),
      termStart: ledger.termStart,
      termEnd: ledger.termEnd,
      dueDate: courseTuitionDueDate(ledger.termStart),
      source: 'course',
      periodType: 'course',
      enrollmentId: ledger.enrollmentId,
      migrationRunId: 'rebuild_open_course_ledgers',
      createdAt: FieldValue.serverTimestamp(),
    });
    writes += 1;
    manifest.created = (manifest.created as number) + 1;
    if (writes >= 400) await flush();
  }
  await flush();

  // Summaries are a projection of the rows above, so they are rebuilt last.
  const { rebuildAccountingStudentSummary } = await import(
    '../server/api/lib/services/accountingStudentSummaryService.js'
  );
  const students = new Set<string>([
    ...[...planned.values()].map((p) => String(p.ledger.studentId)),
    ...toDelete.map((l) => String(l.data.studentId)),
  ]);
  for (const studentId of students) {
    try {
      await rebuildAccountingStudentSummary(db, studentId);
      manifest.summariesRebuilt = (manifest.summariesRebuilt as number) + 1;
    } catch (error) {
      (manifest.summariesFailed as string[]).push(
        `${studentId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const after = await db.collection('course_fee_ledgers').get();
  manifest.after = {
    ledgers: after.size,
    billed: after.docs.reduce((s, d) => s + m((d.data() as any).amount), 0),
    paidTotal: after.docs.reduce((s, d) => s + m((d.data() as any).paidTotal), 0),
  };
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
const { deletedDocs, ...printable } = manifest as any;
console.log(JSON.stringify({ ...printable, manifestPath }, null, 2));
