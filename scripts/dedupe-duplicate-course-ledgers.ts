/**
 * Gộp các cặp học sinh–lớp đang có nhiều hơn một sổ nợ.
 *
 * Sổ nợ mang danh tính trong chính doc id (studentId_classId_termStart_termEnd).
 * Khi ngày term của một lớp đang học bị sửa, planner sinh id mới, không nhận ra
 * sổ cũ và tạo thêm một sổ nữa cho cùng lớp — thành ra tính nợ hai lần. Đây là
 * dọn phần đó.
 *
 * Quy tắc giữ lại, theo thứ tự:
 *   1. sổ đang giữ tiền — phiếu thu trỏ vào nó, dời đi là mất dấu tiền
 *   2. nếu không sổ nào có tiền: sổ do planner sinh ra (khớp enrollment hiện tại)
 *   3. còn lại: sổ tạo sớm nhất, cho kết quả tất định
 *
 * Hai chốt chặn cứng, vi phạm là dừng toàn bộ:
 *   - không xóa sổ có paidTotal > 0
 *   - không xóa sổ được bất kỳ phiếu thu đã posted nào trỏ tới
 *
 * Dry run mặc định. `--apply` mới ghi.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const manifestPath = `migration-manifest-dedupe-course-ledgers-${stamp}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const [ledgerSnap, receiptsSnap, studentsSnap, classesSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('receipts').get(),
  db.collection('students').get(),
  db.collection('classes').get(),
]);
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const className = (id: string) =>
  String((classesSnap.docs.find((d) => d.id === id)?.data() as any)?.name || id);

/** Every ledger any posted receipt still points at. Deleting one of these would
 * strand real money, so it is a hard stop rather than a preference. */
const referencedByReceipt = new Set<string>();
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  if (String(r.status || '') !== 'posted') continue;
  if (r.ledgerId) referencedByReceipt.add(String(r.ledgerId));
  for (const a of Array.isArray(r.allocations) ? r.allocations : []) {
    if (a?.ledgerId) referencedByReceipt.add(String(a.ledgerId));
  }
}

/**
 * Khóa gộp lấy termStart/termEnd từ TRƯỜNG DỮ LIỆU, không lấy từ doc id.
 *
 * Một học sinh học lại cùng một lớp ở khóa kế tiếp là chuyện bình thường và
 * đúng ra phải có hai sổ. Gộp theo học sinh+lớp sẽ xóa mất sổ của khóa mới.
 * Trùng thật là hai sổ mô tả cùng một khóa mà id lại khác nhau — dấu vết của
 * ngày term bị sửa sau khi sổ đã được tạo.
 */
const byPair = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ref: d.ref, ...(d.data() as any) };
  const k = `${l.studentId}|${l.classId}|${l.termStart || ''}|${l.termEnd || ''}`;
  if (!byPair.has(k)) byPair.set(k, []);
  byPair.get(k)!.push(l);
}

const toDelete: any[] = [];
const decisions: any[] = [];
const needsManualReview: any[] = [];

for (const [pair, rows] of byPair) {
  if (rows.length < 2) continue;
  const [studentId, classId, termStart, termEnd] = pair.split('|');

  const withMoney = rows.filter((l) => m(l.paidTotal) > 0);
  if (withMoney.length > 1) {
    // Money on both halves cannot be merged by deleting one: that destroys a
    // payment. Leave it for a person to decide.
    needsManualReview.push({
      student: studentById.get(studentId)?.name || '(không có hồ sơ)',
      class: className(classId),
      term: `${termStart} → ${termEnd}`,
      ledgers: rows.map((l) => ({ id: l.id, amount: m(l.amount), paidTotal: m(l.paidTotal) })),
    });
    continue;
  }

  let keep: any;
  let reason: string;
  if (withMoney.length === 1) {
    keep = withMoney[0];
    reason = 'đang giữ tiền';
  } else {
    const fromRebuild = rows.filter(
      (l) => String(l.migrationRunId || '') === 'rebuild_open_course_ledgers'
    );
    if (fromRebuild.length === 1) {
      keep = fromRebuild[0];
      reason = 'khớp enrollment hiện tại';
    } else {
      keep = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
      reason = 'tất định theo id';
    }
  }

  const drop = rows.filter((l) => l.id !== keep.id);
  for (const l of drop) toDelete.push(l);
  decisions.push({
    student: studentById.get(studentId)?.name || '(không có hồ sơ)',
    studentId,
    class: className(classId),
    keptLedger: keep.id,
    keptReason: reason,
    keptAmount: m(keep.amount),
    keptPaid: m(keep.paidTotal),
    deleted: drop.map((l) => ({ id: l.id, amount: m(l.amount), paidTotal: m(l.paidTotal) })),
    billedRemoved: drop.reduce((s, l) => s + m(l.amount), 0),
  });
}

const guards: string[] = [];
const paidBeingDeleted = toDelete.filter((l) => m(l.paidTotal) > 0);
if (paidBeingDeleted.length)
  guards.push(`${paidBeingDeleted.length} sổ sắp xóa vẫn có paidTotal > 0`);
const referencedBeingDeleted = toDelete.filter((l) => referencedByReceipt.has(String(l.id)));
if (referencedBeingDeleted.length)
  guards.push(
    `${referencedBeingDeleted.length} sổ sắp xóa đang được phiếu thu trỏ tới: ${referencedBeingDeleted
      .slice(0, 3)
      .map((l) => l.id)
      .join(', ')}`
  );

const manifest: Record<string, unknown> = {
  migration: 'dedupe_duplicate_course_ledgers',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  databaseId,
  guards,
  before: {
    ledgers: ledgerSnap.size,
    billed: ledgerSnap.docs.reduce((s, d) => s + m((d.data() as any).amount), 0),
    paidTotal: ledgerSnap.docs.reduce((s, d) => s + m((d.data() as any).paidTotal), 0),
  },
  duplicatePairs: decisions.length,
  ledgersToDelete: toDelete.length,
  phantomBilledRemoved: decisions.reduce((s, d) => s + d.billedRemoved, 0),
  moneyOnDeletedLedgers: toDelete.reduce((s, l) => s + m(l.paidTotal), 0),
  needsManualReview,
  decisions,
  deletedDocs: toDelete.map(({ ref, ...l }) => l),
  deleted: 0,
  summariesRebuilt: 0,
  summariesFailed: [] as string[],
};

if (APPLY) {
  if (guards.length) throw new Error(`Dừng lại vì guard: ${guards.join(' | ')}`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  let batch = db.batch();
  let writes = 0;
  for (const l of toDelete) {
    batch.delete(l.ref);
    writes += 1;
    manifest.deleted = (manifest.deleted as number) + 1;
    if (writes >= 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();

  const { rebuildAccountingStudentSummary } = await import(
    '../server/api/lib/services/accountingStudentSummaryService.js'
  );
  for (const studentId of new Set(decisions.map((d) => d.studentId))) {
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
const { deletedDocs, decisions: _d, ...printable } = manifest as any;
console.log(
  JSON.stringify({ ...printable, decisionsSample: decisions.slice(0, 3), manifestPath }, null, 2)
);
