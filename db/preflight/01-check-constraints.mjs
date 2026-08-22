import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const repo = process.argv[2], dbId = process.argv[3];
const sa = JSON.parse(readFileSync(`${repo}/service-account-key.json`, 'utf8'));
const db = getFirestore(initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
}), dbId);

const load = async (name) => {
  const out = new Map();
  let last = null;
  for (;;) {
    let q = db.collection(name).orderBy('__name__').limit(1000);
    if (last) q = q.startAfter(last);
    const s = await q.get();
    if (s.empty) break;
    for (const d of s.docs) { out.set(d.id, d.data()); last = d; }
    if (s.size < 1000) break;
  }
  return out;
};

const R = [];
const say = (label, bad, total, extra = '') =>
  R.push(`${bad === 0 ? 'OK  ' : 'FAIL'}  ${label}: ${bad}/${total}${extra ? '  ' + extra : ''}`);

const [students, classes, users, enrollments, ledgers, receipts, wtx, attendance, sessions, evals] =
  await Promise.all(['students', 'classes', 'users', 'student_course_enrollments', 'course_fee_ledgers',
    'receipts', 'wallet_transactions', 'attendance', 'class_sessions', 'evaluations'].map(load));

const norm = (v) => String(v || '').trim().toUpperCase();

let codeEqStudentId = 0, codeEmpty = 0;
for (const [, s] of students) {
  if (norm(s.code) === norm(s.studentId)) codeEqStudentId++;
  if (!norm(s.code)) codeEmpty++;
}
R.push(`INFO  students.code === students.studentId tren ${codeEqStudentId}/${students.size} doc; code rong: ${codeEmpty}`);

const byCode = new Map();
for (const [id, s] of students) {
  const k = norm(s.code || s.studentId);
  if (!byCode.has(k)) byCode.set(k, []);
  byCode.get(k).push(id);
}
const dupAll = [...byCode.entries()].filter(([, ids]) => ids.length > 1);
say('UNIQUE(code_normalized) tren TOAN BO students', dupAll.length, byCode.size,
  dupAll.length ? `vd: ${dupAll.slice(0, 5).map(([k, v]) => `${k}x${v.length}`).join(', ')}` : '');

const isRetired = (s) => Boolean(s.deletedAt || s.mergedIntoStudentId || s.studentProfileState === 'merged_tombstone');
const byCodeLive = new Map();
let liveCount = 0;
for (const [id, s] of students) {
  if (isRetired(s)) continue;
  liveCount++;
  const k = norm(s.code || s.studentId);
  if (!byCodeLive.has(k)) byCodeLive.set(k, []);
  byCodeLive.get(k).push(id);
}
const dupLive = [...byCodeLive.entries()].filter(([, ids]) => ids.length > 1);
say(`UNIQUE(code_normalized) chi tren student con song (${liveCount})`, dupLive.length, byCodeLive.size,
  dupLive.length ? `vd: ${dupLive.slice(0, 5).map(([k, v]) => `${k}x${v.length}`).join(', ')}` : '');
R.push(`INFO  students bi soft-delete/merge: ${students.size - liveCount}`);

const fk = (label, rows, getRef, target) => {
  let bad = 0; const eg = [];
  for (const [id, d] of rows) {
    const v = getRef(d);
    if (v == null || v === '') continue;
    if (!target.has(v)) { bad++; if (eg.length < 3) eg.push(`${id}->${v}`); }
  }
  say(label, bad, rows.size, eg.join(' '));
};
fk('FK students.classId -> classes', students, d => d.classId, classes);
fk('FK students.teacherId -> users', students, d => d.teacherId, users);
fk('FK enrollments.studentId -> students', enrollments, d => d.studentId, students);
fk('FK enrollments.classId -> classes', enrollments, d => d.classId, classes);
fk('FK ledgers.studentId -> students', ledgers, d => d.studentId, students);
fk('FK ledgers.classId -> classes', ledgers, d => d.classId, classes);
fk('FK ledgers.enrollmentId -> enrollments', ledgers, d => d.enrollmentId, enrollments);
fk('FK receipts.studentId -> students', receipts, d => d.studentId, students);
fk('FK receipts.ledgerId -> ledgers', receipts, d => d.ledgerId, ledgers);
fk('FK wallet_tx.studentId -> students', wtx, d => d.studentId, students);
fk('FK wallet_tx.receiptId -> receipts', wtx, d => d.receiptId, receipts);
fk('FK wallet_tx.ledgerId -> ledgers', wtx, d => d.ledgerId, ledgers);
fk('FK attendance.studentId -> students', attendance, d => d.studentId, students);
fk('FK attendance.classId -> classes', attendance, d => d.classId, classes);
fk('FK attendance.teacherId -> users', attendance, d => d.teacherId, users);
fk('FK class_sessions.classId -> classes', sessions, d => d.classId, classes);
fk('FK class_sessions.teacherId -> users', sessions, d => d.teacherId, users);
fk('FK evaluations.studentId -> students', evals, d => d.studentId, students);
fk('FK evaluations.classId -> classes', evals, d => d.classId, classes);
fk('FK classes.teacherId -> users', classes, d => d.teacherId, users);

{
  let bad = 0, tot = 0; const eg = [];
  for (const [id, r] of receipts) for (const a of r.allocations || []) {
    tot++;
    if (a.ledgerId && !ledgers.has(a.ledgerId)) { bad++; if (eg.length < 3) eg.push(`${id}->${a.ledgerId}`); }
  }
  say('FK receipt.allocations[].ledgerId -> ledgers', bad, tot, eg.join(' '));
}

const uniq = (label, rows, keyFn) => {
  const m = new Map(); const dups = [];
  for (const [id, d] of rows) {
    const k = keyFn(d);
    if (m.has(k)) dups.push(`${k} (${m.get(k)} vs ${id})`); else m.set(k, id);
  }
  say(label, dups.length, rows.size, dups.slice(0, 3).join(' | '));
};
uniq('UNIQUE(student,class,term_start) tren enrollments', enrollments, d => `${d.studentId}|${d.classId}|${d.termStart}`);
uniq('UNIQUE(student,class,term_start) tren ledgers', ledgers, d => `${d.studentId}|${d.classId}|${d.termStart}`);
uniq('UNIQUE(student,class,date) tren attendance', attendance, d => `${d.studentId}|${d.classId}|${d.date}`);
uniq('UNIQUE(class,date) tren class_sessions', sessions, d => `${d.classId}|${d.date}`);
uniq('UNIQUE(receipt_no) tren receipts', receipts, d => d.receiptNo);

const open = new Set(['trial', 'active', 'on_leave']);
const closed = new Set(['completed', 'transferred', 'dropped']);
let cTerm = 0, cJoin = 0, cOpen = 0, cPair = 0;
const egJoin = [];
for (const [id, e] of enrollments) {
  if (e.termEnd && e.termEnd < e.termStart) cTerm++;
  if (!(e.joinedAt >= e.termStart && (!e.termEnd || e.joinedAt <= e.termEnd))) {
    cJoin++;
    if (egJoin.length < 3) egJoin.push(`${id} joined=${e.joinedAt} term=${e.termStart}..${e.termEnd}`);
  }
  const okOpen = (open.has(e.status) && e.endedAt == null) ||
    (closed.has(e.status) && e.endedAt != null && e.endedAt >= e.joinedAt);
  if (!okOpen) cOpen++;
  if ((e.confirmedAt == null) !== (e.confirmedBy == null)) cPair++;
}
say('CHECK term_order (enrollments)', cTerm, enrollments.size);
say('CHECK joined_in_term (enrollments)', cJoin, enrollments.size, egJoin.join(' | '));
say('CHECK open_has_no_end (enrollments)', cOpen, enrollments.size);
say('CHECK confirm_pair (enrollments)', cPair, enrollments.size);

{
  const allocByLedger = new Map();
  for (const [, r] of receipts) {
    if (r.status !== 'posted') continue;
    for (const a of r.allocations || []) {
      allocByLedger.set(a.ledgerId, (allocByLedger.get(a.ledgerId) || 0) + (a.amount || 0));
    }
  }
  let bad = 0, tot = 0, deltaSum = 0; const eg = [];
  for (const [id, l] of ledgers) {
    tot++;
    const derived = allocByLedger.get(id) || 0;
    const stored = l.paidTotal || 0;
    if (derived !== stored) {
      bad++; deltaSum += stored - derived;
      if (eg.length < 3) eg.push(`${id} stored=${stored} derived=${derived}`);
    }
  }
  say('ledger.paidTotal === SUM(receipt_allocations.amount)', bad, tot,
    `tong lech=${deltaSum} VND  ${eg.join(' | ')}`);
}
{
  let bad = 0, tot = 0; const eg = [];
  for (const [id, r] of receipts) {
    if (r.status !== 'posted') continue;
    tot++;
    const sum = (r.allocations || []).reduce((n, a) => n + (a.amount || 0), 0);
    const isDeposit = (r.allocations || []).length === 0;
    if (!isDeposit && sum !== r.amountReceived) {
      bad++;
      if (eg.length < 3) eg.push(`${id} received=${r.amountReceived} alloc=${sum}`);
    }
  }
  say('SUM(allocations) === receipt.amountReceived (posted, co allocation)', bad, tot, eg.join(' | '));
}
{
  const sign = { deposit: 1, credit: 1, allocation: -1, refund: -1 };
  const bal = new Map();
  for (const [, t] of wtx) {
    if (t.status !== 'posted') continue;
    const s = t.type === 'adjustment' ? (t.direction === 'out' ? -1 : 1) : (sign[t.type] ?? 0);
    bal.set(t.studentId, (bal.get(t.studentId) || 0) + s * (t.amount || 0));
  }
  let bad = 0, tot = 0, neg = 0; const eg = [];
  for (const [id, s] of students) {
    const stored = s.walletBalance;
    if (stored === undefined) continue;
    tot++;
    const derived = (s.walletOpeningBalance || 0) + (bal.get(id) || 0);
    if (derived < 0) neg++;
    if (derived !== stored) { bad++; if (eg.length < 3) eg.push(`${id} stored=${stored} derived=${derived}`); }
  }
  say('student.walletBalance === opening + SUM(wallet_transactions)', bad, tot,
    `so du am khi tinh lai: ${neg}  ${eg.join(' | ')}`);
}

{
  let overlaps = 0, classesWithTerms = 0; const eg = [];
  for (const [id, c] of classes) {
    const terms = (c.terms || []).filter(t => t.startDate);
    if (!terms.length) continue;
    classesWithTerms++;
    const sorted = [...terms].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].endDate;
      if (prevEnd && sorted[i].startDate <= prevEnd) {
        overlaps++;
        if (eg.length < 3) eg.push(`${id}: ${sorted[i - 1].startDate}..${prevEnd} vs ${sorted[i].startDate}`);
      }
    }
  }
  say('EXCLUDE chong ky chong lan (classes.terms[])', overlaps, classesWithTerms, eg.join(' | '));
}

fk('FK users.studentId -> students', users, d => d.studentId, students);
{
  let bad = 0; const eg = [];
  for (const [id, u] of users) {
    if ((u.role === 'student' || u.role === 'parent') && !u.studentId) { bad++; if (eg.length < 3) eg.push(id); }
  }
  say('users role student/parent phai co studentId', bad, users.size, eg.join(' '));
}

console.log(R.join('\n'));
process.exit(0);
