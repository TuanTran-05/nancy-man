/**
 * READ-ONLY follow-up on the four anomalies the audit surfaced. Reads the
 * backup files on disk, so it touches DocumentStore not at all.
 *
 *  1. receipts posted (260,690,000) exceed ledger paidTotal (255,952,497)
 *  2. wallet_transactions look like 516M of credit and no debit
 *  3. two students hold paid money but have no student document
 *  4. eighteen students with paid money carry a duplicated code
 */
import { readFile } from 'node:fs/promises';

const dir = process.argv[2];
if (!dir) throw new Error('usage: drilldown <backupDir>');
const load = async (n: string) => JSON.parse(await readFile(`${dir}/${n}.json`, 'utf8')) as any[];

const [receipts, walletTx, students, ledgers] = await Promise.all([
  load('receipts'),
  load('wallet_transactions'),
  load('students'),
  load('course_fee_ledgers'),
]);

const money = (v: unknown) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const studentById = new Map(students.map((s) => [s.__id, s]));

// ---- 1. what shape are receipts, and where does the 4,737,503 gap live? ----
const byKind = new Map<string, { count: number; amount: number }>();
for (const r of receipts) {
  const kind = r.walletDeposit ? 'walletDeposit' : Array.isArray(r.allocations) && r.allocations.length ? 'allocated' : r.ledgerId ? 'ledgerIdOnly' : 'unattributed';
  const key = `${String(r.status || '?')}/${kind}`;
  const cur = byKind.get(key) || { count: 0, amount: 0 };
  cur.count += 1;
  cur.amount += money(r.amountReceived);
  byKind.set(key, cur);
}

// sum of allocation amounts vs amountReceived, per receipt
let allocSum = 0;
let receivedSum = 0;
const partiallyAllocated: any[] = [];
for (const r of receipts) {
  if (String(r.status) !== 'posted') continue;
  receivedSum += money(r.amountReceived);
  const allocs = Array.isArray(r.allocations) ? r.allocations : [];
  const a = allocs.reduce((s: number, x: any) => s + money(x.amount), 0);
  allocSum += a;
  if (!r.walletDeposit && Math.abs(a - money(r.amountReceived)) > 1) {
    partiallyAllocated.push({
      receiptNo: r.receiptNo,
      studentName: studentById.get(String(r.studentId))?.name || '(missing)',
      amountReceived: money(r.amountReceived),
      allocated: a,
      gap: money(r.amountReceived) - a,
    });
  }
}

// ---- 2. wallet transaction shape ----
const walletByType = new Map<string, { count: number; amount: number }>();
const walletKeys = new Set<string>();
for (const t of walletTx) {
  Object.keys(t).forEach((k) => walletKeys.add(k));
  const key = String(t.type || t.kind || t.direction || '(no type field)');
  const cur = walletByType.get(key) || { count: 0, amount: 0 };
  cur.count += 1;
  cur.amount += money(t.amount);
  walletByType.set(key, cur);
}

// current wallet balance per student, as the app would compute it
const walletBalanceByStudent = new Map<string, number>();
for (const t of walletTx) {
  const sid = String(t.studentId || '');
  const type = String(t.type || '');
  const amt = money(t.amount);
  const signed = /deposit|topup|top_up|credit|refund/i.test(type) ? amt : -amt;
  walletBalanceByStudent.set(sid, (walletBalanceByStudent.get(sid) || 0) + signed);
}
const nonZeroWallets = [...walletBalanceByStudent.entries()]
  .filter(([, v]) => Math.abs(v) > 0)
  .map(([sid, v]) => ({
    studentId: sid,
    studentName: studentById.get(sid)?.name || '(STUDENT DOC MISSING)',
    balance: v,
  }))
  .sort((a, b) => b.balance - a.balance);

// ---- 3. paid money with no student document ----
const paidByStudent = new Map<string, number>();
for (const r of receipts) {
  if (String(r.status) !== 'posted') continue;
  const sid = String(r.studentId || '');
  paidByStudent.set(sid, (paidByStudent.get(sid) || 0) + money(r.amountReceived));
}
const ghosts = [...paidByStudent.entries()]
  .filter(([sid]) => !studentById.has(sid))
  .map(([sid, amt]) => ({
    studentId: sid,
    paidTotal: amt,
    receipts: receipts
      .filter((r) => String(r.studentId) === sid && String(r.status) === 'posted')
      .map((r) => ({ receiptNo: r.receiptNo, amount: money(r.amountReceived), createdAt: r.createdAt, classId: r.classId })),
    ledgersStillReferencingThem: ledgers.filter((l) => String(l.studentId) === sid).length,
  }));

// ---- 4. duplicated codes that hold money ----
const idsByCode = new Map<string, string[]>();
for (const s of students) {
  const code = String(s.studentId || s.code || '').trim().toUpperCase();
  if (!code) continue;
  if (!idsByCode.has(code)) idsByCode.set(code, []);
  idsByCode.get(code)!.push(s.__id);
}
const dupWithMoney = [];
for (const [code, ids] of idsByCode) {
  if (ids.length < 2) continue;
  const legs = ids.map((id) => ({
    studentId: id,
    name: studentById.get(id)?.name || '',
    status: studentById.get(id)?.status || '',
    paid: paidByStudent.get(id) || 0,
    wallet: walletBalanceByStudent.get(id) || 0,
    ledgers: ledgers.filter((l) => String(l.studentId) === id).length,
    billed: ledgers.filter((l) => String(l.studentId) === id).reduce((s, l) => s + money(l.amount), 0),
  }));
  const totalMoney = legs.reduce((s, l) => s + l.paid + l.wallet, 0);
  if (totalMoney > 0 || legs.filter((l) => l.ledgers > 0).length > 1) {
    dupWithMoney.push({ code, legsHoldingMoney: legs.filter((l) => l.paid + l.wallet > 0).length, legs });
  }
}

console.log(JSON.stringify({
  receiptBreakdown: Object.fromEntries([...byKind].sort()),
  allocationCheck: { postedReceived: receivedSum, postedAllocated: allocSum, gap: receivedSum - allocSum, partiallyAllocated },
  walletShape: { fields: [...walletKeys].sort(), byType: Object.fromEntries([...walletByType].sort()) },
  walletBalances: { studentsWithBalance: nonZeroWallets.length, total: nonZeroWallets.reduce((s, w) => s + w.balance, 0), top: nonZeroWallets.slice(0, 15) },
  ghostStudentsHoldingMoney: ghosts,
  duplicateCodesHoldingMoney: { count: dupWithMoney.length, detail: dupWithMoney },
}, null, 2));
