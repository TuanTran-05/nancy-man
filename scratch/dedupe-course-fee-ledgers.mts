/**
 * Remove residue duplicate course fee ledgers.
 *
 * Ledger doc ids historically embedded `termEnd`, so rewriting a class end date
 * minted a second ledger for the same (studentId, classId, termStart) tuple and
 * doubled the debt. `courseLedgerIdentity.ts` now dedupes by tuple, so this only
 * clears what the old id scheme left behind.
 *
 * Keeps the ledger whose `termEnd` matches the class's current `endDate`; falls
 * back to the one that carries money, then to the oldest. Refuses to delete a
 * ledger that any receipt, invoice, wallet transaction or payment request points
 * at, or that holds paid/discount money.
 *
 * Dry run by default. Pass --apply to write. Always writes a manifest.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const APPLY = process.argv.includes('--apply');
const manifestPath =
  process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1] ||
  `migration-manifest-dedupe-ledgers-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

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
const iso = (v: any) =>
  typeof v === 'string' ? v : v?.toDate ? v.toDate().toISOString() : String(v ?? '');

const [ledgerSnap, classesSnap, studentsSnap, receiptsSnap, walletSnap, invoicesSnap, paymentsSnap] =
  await Promise.all([
    db.collection('course_fee_ledgers').get(),
    db.collection('classes').get(),
    db.collection('students').get(),
    db.collection('receipts').get(),
    db.collection('wallet_transactions').get(),
    db.collection('invoices').get(),
    db.collection('payment_requests').get(),
  ]);

const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));

/** every ledgerId referenced by any money document */
const referenced = new Map<string, string[]>();
const refer = (ledgerId: string, what: string) => {
  if (!ledgerId) return;
  if (!referenced.has(ledgerId)) referenced.set(ledgerId, []);
  referenced.get(ledgerId)!.push(what);
};
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  refer(String(r.ledgerId || ''), `receipt:${d.id}`);
  for (const a of r.allocations || []) refer(String(a.ledgerId || ''), `receipt-alloc:${d.id}`);
}
for (const d of walletSnap.docs) refer(String((d.data() as any).ledgerId || ''), `wallet:${d.id}`);
for (const d of invoicesSnap.docs) refer(String((d.data() as any).ledgerId || ''), `invoice:${d.id}`);
for (const d of paymentsSnap.docs)
  refer(String((d.data() as any).ledgerId || ''), `payment_request:${d.id}`);

const groups = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ref: d.ref, ...(d.data() as any) };
  const key = `${l.studentId}|${l.classId}|${l.termStart || ''}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(l);
}

const plan: any[] = [];
const blocked: any[] = [];

for (const [key, group] of groups) {
  if (group.length < 2) continue;
  const [studentId, classId] = key.split('|');
  const cls = classById.get(classId);
  const classEndDate = String(cls?.endDate || '');

  const scored = [...group].sort((a, b) => {
    const matchA = String(a.termEnd || '') === classEndDate ? 1 : 0;
    const matchB = String(b.termEnd || '') === classEndDate ? 1 : 0;
    if (matchA !== matchB) return matchB - matchA;
    const moneyA = money(a.paidTotal) + money(a.discountTotal);
    const moneyB = money(b.paidTotal) + money(b.discountTotal);
    if (moneyA !== moneyB) return moneyB - moneyA;
    const refA = (referenced.get(a.id) || []).length;
    const refB = (referenced.get(b.id) || []).length;
    if (refA !== refB) return refB - refA;
    return iso(a.createdAt).localeCompare(iso(b.createdAt)) || a.id.localeCompare(b.id);
  });

  const keep = scored[0];
  for (const drop of scored.slice(1)) {
    const reasons: string[] = [];
    if (money(drop.paidTotal) > 0) reasons.push(`paidTotal=${money(drop.paidTotal)}`);
    if (money(drop.discountTotal) > 0) reasons.push(`discountTotal=${money(drop.discountTotal)}`);
    if (money(drop.siblingDiscountTotal) > 0)
      reasons.push(`siblingDiscountTotal=${money(drop.siblingDiscountTotal)}`);
    if (referenced.has(drop.id)) reasons.push(`referenced by ${referenced.get(drop.id)!.join(', ')}`);
    if (money(drop.amount) !== money(keep.amount))
      reasons.push(`amount differs: drop=${money(drop.amount)} keep=${money(keep.amount)}`);

    const row = {
      tuple: key,
      studentId,
      studentName: String(studentById.get(studentId)?.name || ''),
      studentCode: String(studentById.get(studentId)?.studentId || ''),
      classId,
      className: String(cls?.name || ''),
      classEndDate,
      keep: {
        id: keep.id,
        termEnd: String(keep.termEnd || ''),
        amount: money(keep.amount),
        paidTotal: money(keep.paidTotal),
        status: String(keep.status || ''),
      },
      drop: {
        id: drop.id,
        termEnd: String(drop.termEnd || ''),
        amount: money(drop.amount),
        paidTotal: money(drop.paidTotal),
        discountTotal: money(drop.discountTotal),
        status: String(drop.status || ''),
        remaining: remaining(drop),
        doc: JSON.parse(JSON.stringify({ ...drop, ref: undefined })),
      },
      phantomDebtRemoved: remaining(drop),
    };
    if (reasons.length) blocked.push({ ...row, blockedBecause: reasons });
    else plan.push(row);
  }
}

const manifest = {
  migration: 'dedupe_course_fee_ledgers',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  totals: {
    ledgersScanned: ledgerSnap.size,
    duplicateGroups: [...groups.values()].filter((g) => g.length > 1).length,
    toDelete: plan.length,
    blocked: blocked.length,
    phantomDebtRemoved: plan.reduce((s, r) => s + r.phantomDebtRemoved, 0),
  },
  plan,
  blocked,
  deleted: [] as string[],
};

if (APPLY && plan.length) {
  let batch = db.batch();
  let writes = 0;
  for (const row of plan) {
    batch.delete(db.collection('course_fee_ledgers').doc(row.drop.id));
    manifest.deleted.push(row.drop.id);
    writes += 1;
    if (writes >= 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      mode: manifest.mode,
      ...manifest.totals,
      deleted: manifest.deleted.length,
      manifestPath,
      preview: plan.map((r) => ({
        student: `${r.studentName} (${r.studentCode})`,
        class: r.className,
        classEndDate: r.classEndDate,
        keep: `${r.keep.id} [termEnd ${r.keep.termEnd}]`,
        drop: `${r.drop.id} [termEnd ${r.drop.termEnd}]`,
        phantomDebtRemoved: r.phantomDebtRemoved,
      })),
      blocked: blocked.map((r) => ({
        student: r.studentName,
        drop: r.drop.id,
        because: r.blockedBecause,
      })),
    },
    null,
    2
  )
);
