/** READ-ONLY: bước 1 có tạo ra sổ nợ trùng không?
 *
 * Planner sinh id từ termStart/termEnd của enrollment. Nếu sổ cũ được tạo hồi
 * ngày term còn khác, id không khớp và planner tưởng chưa có sổ nên tạo thêm
 * một cái nữa — cùng học sinh, cùng lớp, hai sổ. Đó là tính nợ hai lần. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const [ledgerSnap, studentsSnap, classesSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('students').get(),
  db.collection('classes').get(),
]);
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const className = (id: string) =>
  String((classesSnap.docs.find((d) => d.id === id)?.data() as any)?.name || id);

const byPair = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ...(d.data() as any) };
  const k = `${l.studentId}|${l.classId}`;
  if (!byPair.has(k)) byPair.set(k, []);
  byPair.get(k)!.push(l);
}

const dupes: any[] = [];
for (const [pair, rows] of byPair) {
  if (rows.length < 2) continue;
  const [studentId, classId] = pair.split('|');
  dupes.push({
    student: studentById.get(studentId)?.name || '(không có hồ sơ)',
    studentId,
    class: className(classId),
    ledgers: rows.map((l) => ({
      id: l.id,
      fromRebuild: String(l.migrationRunId || '') === 'rebuild_open_course_ledgers',
      termStart: l.termStart,
      termEnd: l.termEnd,
      amount: m(l.amount),
      paidTotal: m(l.paidTotal),
      status: l.status,
    })),
    doubleBilled: rows.reduce((s, l) => s + m(l.amount), 0) - Math.max(...rows.map((l) => m(l.amount))),
  });
}

const totalDoubleBilled = dupes.reduce((s, d) => s + d.doubleBilled, 0);
const emptyDuplicates = dupes.filter((d) =>
  d.ledgers.some((l: any) => l.fromRebuild && l.paidTotal === 0) &&
  d.ledgers.some((l: any) => !l.fromRebuild && l.paidTotal > 0)
);

console.log(JSON.stringify({
  totalLedgers: ledgerSnap.size,
  pairsWithMoreThanOneLedger: dupes.length,
  phantomBilledFromDuplicates: totalDoubleBilled,
  classicCase_paidOldPlusEmptyNew: emptyDuplicates.length,
  sample: dupes.slice(0, 6),
}, null, 2));
