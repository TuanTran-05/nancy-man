/** READ-ONLY: is the receipt flow actually in use, or is unpaid just "not recorded yet"? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const toIso = (v: any): string => !v ? '' : typeof v === 'string' ? v
  : typeof v?.toDate === 'function' ? v.toDate().toISOString() : '';
const [ledgerSnap, receiptsSnap, invoicesSnap, paymentsSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(), db.collection('receipts').get(),
  db.collection('invoices').get(), db.collection('payment_requests').get(),
]);
const ledgersByMonth = new Map<string, {count:number; billed:number; paid:number}>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const m = toIso(l.createdAt).slice(0,7) || '(?)';
  const cur = ledgersByMonth.get(m) || {count:0,billed:0,paid:0};
  cur.count++; cur.billed += money(l.amount); cur.paid += money(l.paidTotal);
  ledgersByMonth.set(m, cur);
}
const receiptsByMonth = new Map<string, {count:number; amount:number}>();
for (const d of receiptsSnap.docs) {
  const r = d.data() as any;
  if (String(r.status) !== 'posted') continue;
  const m = String(r.receivedDate || '').slice(0,7) || '(?)';
  const cur = receiptsByMonth.get(m) || {count:0,amount:0};
  cur.count++; cur.amount += money(r.amountReceived);
  receiptsByMonth.set(m, cur);
}
console.log(JSON.stringify({
  ledgersByMonth: Object.fromEntries([...ledgersByMonth].sort()),
  postedReceiptsByMonth: Object.fromEntries([...receiptsByMonth].sort()),
  totals: {
    ledgers: ledgerSnap.size,
    billed: ledgerSnap.docs.reduce((s,d)=>s+money((d.data() as any).amount),0),
    recordedAsPaid: ledgerSnap.docs.reduce((s,d)=>s+money((d.data() as any).paidTotal),0),
    postedReceipts: receiptsSnap.docs.filter(d=>String((d.data() as any).status)==='posted').length,
    invoices: invoicesSnap.size,
    onlinePaymentRequests: paymentsSnap.size,
  },
}, null, 2));
