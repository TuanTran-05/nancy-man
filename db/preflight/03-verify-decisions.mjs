// Kiem tra tung khang dinh trong db/normalization/decisions.json co con dung
// voi Firestore production khong.
//
// Ly do ton tai: decisions.json chua nhung cau nhu "ma HS260321 chua ai dung"
// hay "audit_logs co ban ghi tao ho so nay". Neu du lieu doi ma file khong doi,
// buoc nap se dung mot quyet dinh da het han. Script nay bat dieu do.
//
//   node 03-verify-decisions.mjs "<duong-dan-repo>" <databaseId>
//
// Thoat 0 = moi khang dinh con dung. Thoat 1 = co it nhat mot cau da sai.

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const repo = process.argv[2];
const dbId = process.argv[3];
if (!repo || !dbId) {
  console.error('usage: node 03-verify-decisions.mjs "<repo>" <databaseId>');
  process.exit(2);
}

const decisions = JSON.parse(readFileSync(`${repo}/db/normalization/decisions.json`, 'utf8'));
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

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'SAI '}  ${label}${detail ? '  — ' + detail : ''}`);
};

const [students, classes, sessions, users, receipts, wtx, ledgers, audit, closings] =
  await Promise.all(['students', 'classes', 'class_sessions', 'users', 'receipts',
    'wallet_transactions', 'course_fee_ledgers', 'audit_logs', 'course_closing_records'].map(load));

const norm = (v) => String(v || '').trim().toUpperCase();
const codeOwner = new Map();
for (const [id, s] of students) {
  const k = norm(s.studentId);
  if (!codeOwner.has(k)) codeOwner.set(k, []);
  codeOwner.get(k).push(id);
}
const auditBlob = [...audit.values()].map(r => JSON.stringify(r)).join('\n');

console.log(`decisions.json v${decisions.version}, moc ${decisions.baselineDate}\n`);

// ---------------------------------------------------------- dung lai ho so
console.log('--- reconstructStudents ---');
for (const r of decisions.reconstructStudents) {
  check(!students.has(r.id), `${r.id} van vang mat trong students`,
    students.has(r.id) ? 'ho so DA QUAY LAI — bo khoi danh sach dung lai' : '');
  check(!codeOwner.has(norm(r.code)), `ma ${r.code} chua ai dung`,
    (codeOwner.get(norm(r.code)) || []).join(','));
  check(classes.has(r.classId), `lop ${r.classId} ton tai`,
    classes.get(r.classId)?.name || 'KHONG TIM THAY');
  // ten va ma phai thuc su xuat hien trong audit hoac closing_record
  const inAudit = auditBlob.includes(r.id);
  check(inAudit, `${r.id} co dau vet trong audit_logs`);
  if (r.code.startsWith('HS')) {
    const codeSeen = auditBlob.includes(r.code) ||
      [...closings.values()].some(c => c.studentCode === r.code);
    check(codeSeen, `ma ${r.code} tim duoc trong audit_logs hoac course_closing_records`);
  }
}

// ---------------------------------------------------- ho so luu tru giu lai
console.log('\n--- keepArchivedProfiles ---');
for (const r of decisions.keepArchivedProfiles) {
  const s = students.get(r.id);
  check(!!s, `${r.id} con trong students`);
  if (!s) continue;
  check(!!s.deletedAt, `${r.id} co deletedAt`, String(s.deletedAt));
  check(!s.mergedIntoStudentId, `${r.id} KHONG merge vao ho so khac`);
  check(norm(s.studentId) === norm(r.code), `ma van la ${r.code}`, String(s.studentId));
  check((codeOwner.get(norm(r.code)) || []).length === 1, `ma ${r.code} khong trung voi ai`);
}

// -------------------------------------------------------- 58 ho so da gop
console.log('\n--- dropMergedShells ---');
const merged = [...students].filter(([, s]) => s.mergedIntoStudentId);
check(merged.length === decisions.dropMergedShells.count,
  `so ho so co mergedIntoStudentId = ${decisions.dropMergedShells.count}`, `thuc te ${merged.length}`);
let targetsOk = 0;
for (const [id, s] of merged) {
  const t = students.get(s.mergedIntoStudentId);
  if (t && !t.deletedAt && !t.mergedIntoStudentId && norm(t.studentId) === norm(s.studentId)) targetsOk++;
}
check(targetsOk === merged.length, 'moi dich den con song va mang cung ma hoc sinh',
  `${targetsOk}/${merged.length}`);

// ---------------------------------------------------------------- bo hang
console.log('\n--- dropRows ---');
const bulkJobs = await load('zalo_bulk_jobs');
const bulkItems = await load('zalo_bulk_job_items');
for (const d of decisions.dropRows) {
  if (d.match) {
    // Muc theo dieu kien, khong theo id cu the.
    const jobIds = d.match.jobId ?? [];
    for (const jid of jobIds) {
      check(!bulkJobs.has(jid), `job ${jid} van vang mat trong zalo_bulk_jobs`);
    }
    const n = [...bulkItems.values()].filter(it => jobIds.includes(it.jobId)).length;
    check(n === d.count, `co dung ${d.count} item tro toi cac job do`, `thuc te ${n}`);
    const allSent = [...bulkItems.values()]
      .filter(it => jobIds.includes(it.jobId)).every(it => it.status === 'sent');
    check(allSent, `ca ${d.count} item deu status=sent (ban ghi gui that nam o zalo_notifications)`);
    continue;
  }
  const src = { class_sessions: sessions, users, students, receipts }[d.collection];
  check(!!src && src.has(d.id), `${d.collection}/${d.id} van ton tai (con can bo)`);
  if (d.keepInstead) check(!!src && src.has(d.keepInstead), `ban giu ${d.keepInstead} ton tai`);
}
{
  const a = sessions.get('5WiJgcjDQSnpQbXfs3j4');
  const b = sessions.get('Z8oeO9IN5H3lsV6IOAoH_2026-05-13');
  if (a && b) {
    check(a.classId === b.classId && a.date === b.date, 'hai buoi hoc dung la trung classId+date');
    check(!a.teacherAttendanceStatus && !!b.teacherAttendanceStatus,
      'ban bo khong co diem danh giao vien, ban giu thi co');
    check(a.teacherId === b.teacherId && a.salaryPerSession === b.salaryPerSession,
      'cung giao vien va cung muc luong buoi');
  }
}
{
  const u = users.get('loadtest-student-001');
  if (u) check(u.role === 'student' && !u.studentId, 'loadtest-student-001 dung la role student khong co studentId');
}

// ---------------------------------------------------------------- sua gia tri
console.log('\n--- fixValues ---');
for (const f of decisions.fixValues) {
  const src = { classes, students, receipts }[f.collection];
  const doc = src?.get(f.id);
  check(!!doc, `${f.collection}/${f.id} ton tai`);
  if (doc) check(String(doc[f.field]) === String(f.from),
    `${f.field} van dang la ${JSON.stringify(f.from)}`, `thuc te ${JSON.stringify(doc[f.field])}`);
}

// ------------------------------------------------------- gop allocation trung
console.log('\n--- mergeReceiptAllocations ---');
for (const m of decisions.mergeReceiptAllocations) {
  const r = receipts.get(m.receiptId);
  check(!!r, `bien lai ${m.receiptId} ton tai`);
  if (!r) continue;
  check(r.receiptNo === m.receiptNo, `so bien lai la ${m.receiptNo}`, String(r.receiptNo));
  const same = (r.allocations || []).filter(a => a.ledgerId === m.ledgerId);
  check(same.length === m.from.length, `co dung ${m.from.length} allocation tro toi ledger do`, `thuc te ${same.length}`);
  const sum = same.reduce((n, a) => n + (a.amount || 0), 0);
  check(sum === m.to, `tong hai allocation = ${m.to}`, String(sum));
  const amounts = same.map(a => a.amount).sort((x, y) => y - x);
  check(JSON.stringify(amounts) === JSON.stringify([...m.from].sort((x, y) => y - x)),
    `so tien tung dong la ${JSON.stringify(m.from)}`, JSON.stringify(amounts));
  // giao dich vi lam bang chung cho dong thu hai
  const proof = [...wtx.values()].some(t =>
    t.receiptId === m.receiptId && t.type === 'allocation' && t.amount === Math.min(...m.from));
  check(proof, `co wallet_transaction allocation ${Math.min(...m.from)} lam bang chung cho dong thu hai`);
  const l = ledgers.get(m.ledgerId);
  check(l && l.paidTotal === m.to, `ledger ghi paidTotal = ${m.to}`, String(l?.paidTotal));
}

// ---------------------------------------------------------------- cache cu
console.log('\n--- staleCachesNotImported ---');
{
  const s = students.get('b9C4QhZ1h7qQEFp8ChId');
  if (s) {
    let bal = s.walletOpeningBalance || 0;
    for (const [, t] of wtx) {
      if (t.studentId !== 'b9C4QhZ1h7qQEFp8ChId' || t.status !== 'posted') continue;
      bal += (t.type === 'deposit' || t.type === 'credit') ? t.amount : -t.amount;
    }
    check(s.walletBalance !== bal,
      'walletBalance luu san VAN lech so tinh lai (ly do bo cot nay)',
      `luu ${s.walletBalance}, tinh lai ${bal}`);
  }
  const negative = [...classes.values()].filter(c =>
    c.studentCounts && Object.values(c.studentCounts).some(v => typeof v === 'number' && v < 0));
  check(negative.length > 0, 'van con lop co studentCounts am (ly do bo cot nay)',
    `${negative.length} lop`);
}

// ------------------------------------------------- ky dung lai tu ghi danh
// Hai ky nay khong ton tai trong doc lop, chi ghi danh + ledger con nho. Neu ai do
// sua lai doc lop tren Firestore (them terms[] hoac dat lai startDate) thi viec dung
// lai o day thanh thua va se sinh ra ky trung. Kiem lai truoc moi lan nap.
console.log('\n--- deriveClassTerms ---');
{
  const dstr = (v) => (v == null ? null
    : (typeof v.toDate === 'function' ? v.toDate().toISOString().slice(0, 10) : String(v).slice(0, 10)));
  const enrollments = await load('student_course_enrollments');

  for (const t of decisions.deriveClassTerms?.terms ?? []) {
    const c = classes.get(t.classId);
    check(!!c, `lop ${t.className} (${t.classId}) van ton tai`);
    if (!c) continue;

    const starts = new Set([dstr(c.startDate), ...(c.terms ?? []).map(x => dstr(x.startDate)),
      dstr(c.courseClosing?.termStart)].filter(Boolean));
    check(!starts.has(t.termStart),
      `doc lop VAN khong mo ta ky ${t.termStart} (neu co roi thi bo muc nay di)`,
      `doc lop dang mo ta: ${[...starts].sort().join(', ')}`);

    const es = [...enrollments.values()].filter(e =>
      e.classId === t.classId && dstr(e.termStart) === t.termStart);
    const ls = [...ledgers.values()].filter(l =>
      l.classId === t.classId && dstr(l.termStart) === t.termStart);
    check(es.length === t.enrollments, `${t.termStart}: ${t.enrollments} ghi danh`, `thuc te ${es.length}`);
    check(ls.length === t.ledgers, `${t.termStart}: ${t.ledgers} ledger`, `thuc te ${ls.length}`);

    const ends = new Set([...es, ...ls].map(x => dstr(x.termEnd)));
    check(ends.size === 1 && ends.has(t.termEnd),
      `${t.termStart}: moi nhan chung thong nhat term_end = ${t.termEnd}`, [...ends].join(', '));

    const fees = new Set(ls.map(l => l.amount));
    check(fees.size === 1 && fees.has(t.tuitionFee),
      `${t.termStart}: moi ledger cung hoc phi ${t.tuitionFee}`, [...fees].join(', '));

    const paid = ls.reduce((a, l) => a + (l.paidTotal || 0), 0);
    check(paid === t.ledgerPaid, `${t.termStart}: da thu ${t.ledgerPaid}`, String(paid));

    // Khong hoc sinh nao nam o ca hai ky — day la can cu de noi 'hai lop hoc sinh
    // khac nhau', chu khong phai mot ban sao cua cung mot ky.
    const here = new Set(es.map(e => e.studentId));
    const other = new Set([...enrollments.values()]
      .filter(e => e.classId === t.classId && dstr(e.termStart) !== t.termStart)
      .map(e => e.studentId));
    const both = [...here].filter(x => other.has(x));
    check(both.length === 0, `${t.termStart}: khong hoc sinh nao nam o ca hai ky`,
      both.slice(0, 3).join(', '));
  }
}

console.log(`\n${failures === 0 ? 'TAT CA KHANG DINH CON DUNG' : `${failures} KHANG DINH DA SAI — sua decisions.json truoc khi nap`}`);
process.exit(failures === 0 ? 0 : 1);
