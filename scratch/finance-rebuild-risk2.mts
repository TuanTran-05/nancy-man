/** READ-ONLY. Two questions the plan hinges on: is any student's money split
 * across both halves of a duplicated code, and does every rupiah of money sit
 * on a student the rebuild can actually reach through an enrollment? */
import { readFile } from 'node:fs/promises';

const dir = process.argv[2];
const L = async (n: string) => JSON.parse(await readFile(`${dir}/${n}.json`, 'utf8')) as any[];
const [students, ledgers, receipts, wtx, enr] = await Promise.all(
  ['students', 'course_fee_ledgers', 'receipts', 'wallet_transactions', 'student_course_enrollments'].map(L)
);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const paid = new Map<string, number>();
for (const r of receipts) {
  if (r.status !== 'posted') continue;
  const s = String(r.studentId);
  paid.set(s, (paid.get(s) || 0) + m(r.amountReceived));
}
const wal = new Map<string, number>();
for (const t of wtx) {
  const s = String(t.studentId);
  const a = /deposit/i.test(String(t.type)) ? m(t.amount) : -m(t.amount);
  wal.set(s, (wal.get(s) || 0) + a);
}

const byCode = new Map<string, string[]>();
for (const s of students) {
  const c = String(s.studentId || s.code || '').trim().toUpperCase();
  if (!c) continue;
  if (!byCode.has(c)) byCode.set(c, []);
  byCode.get(c)!.push(s.__id);
}
const splitMoney: any[] = [];
for (const [code, ids] of byCode) {
  if (ids.length < 2) continue;
  const legs = ids.map((id) => ({
    id,
    paid: paid.get(id) || 0,
    wallet: wal.get(id) || 0,
    ledgers: ledgers.filter((l) => String(l.studentId) === id).length,
    enrollments: enr.filter((e) => String(e.studentId) === id).length,
  }));
  if (legs.filter((l) => l.paid + l.wallet > 0).length > 1) splitMoney.push({ code, legs });
}

const enrolled = new Set(enr.map((e) => String(e.studentId)));
const sById = new Map(students.map((s) => [s.__id, s]));
const holders = [...new Set([...paid.keys(), ...wal.keys()])].filter(
  (s) => (paid.get(s) || 0) + (wal.get(s) || 0) > 0
);
const unreachable = holders
  .filter((s) => !enrolled.has(s))
  .map((s) => ({
    studentId: s,
    name: sById.get(s)?.name || '(NO STUDENT DOC)',
    studentDocExists: sById.has(s),
    paid: paid.get(s) || 0,
    wallet: wal.get(s) || 0,
    ledgers: ledgers.filter((l) => String(l.studentId) === s).length,
  }));

const count = (arr: any[], k: string) =>
  arr.reduce((a: any, x: any) => { const v = String(x[k] || '?'); a[v] = (a[v] || 0) + 1; return a; }, {});

console.log(JSON.stringify({
  duplicateCodesWithMoneyOnBothLegs: splitMoney.length,
  splitMoneyDetail: splitMoney,
  studentsHoldingMoney: holders.length,
  holdersUnreachableByEnrollment: unreachable.length,
  unreachableDetail: unreachable,
  unreachableMoneyTotal: unreachable.reduce((s, u) => s + u.paid + u.wallet, 0),
  enrollmentStatusCounts: count(enr, 'status'),
  ledgerStatusCounts: count(ledgers, 'status'),
  ledgersWithNoMatchingEnrollment: ledgers.filter(
    (l) => !enr.some((e) => String(e.studentId) === String(l.studentId) && String(e.classId) === String(l.classId))
  ).length,
}, null, 2));
