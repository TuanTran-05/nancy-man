// Dien tap nap: doc Firestore production -> bien doi -> chen vao mot Postgres
// that (PGlite) da chay du 12 migration. Muc dich khong phai nap that, ma la
// chung minh schema NHAN duoc du lieu that, va liet ke chinh xac nhung gi phai
// don truoc khi nap that.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { createRecorder, withRecorder } from './lib/sql-emit.mjs';

const repo = process.argv[2];
const dbId = process.argv[3];
const migrationsDir = process.argv[4];

// --emit <duong-dan>: ngoai viec dien tap, ghi lai moi cau lenh ghi thanh mot file
// .sql chay duoc bang psql tren VPS. File chi duoc viet ra neu lan chay nay khong
// bo qua hang nao ngoai du kien.
const emitAt = (() => {
  const i = process.argv.indexOf('--emit');
  return i > 0 ? process.argv[i + 1] : null;
})();

// --------------------------------------------------------------------- setup
const sa = JSON.parse(readFileSync(`${repo}/service-account-key.json`, 'utf8'));
const fs_ = getFirestore(initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
}), dbId);

const raw = await PGlite.create({ extensions: { btree_gist, pg_trgm, unaccent } });
for (const f of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
  await raw.exec(readFileSync(`${migrationsDir}/${f}`, 'utf8'));
}
console.log('schema san sang' + (emitAt ? ` (se ghi SQL ra ${emitAt})` : '') + '\n');

// DDL khong duoc ghi vao file du lieu: tren VPS schema do run-migrations.sh dung,
// nen recorder chi bat dau lam viec tu day tro di.
const recorder = emitAt ? createRecorder() : null;
const pg = withRecorder(raw, recorder);

const load = async (name) => {
  const out = new Map();
  let last = null;
  for (;;) {
    let q = fs_.collection(name).orderBy('__name__').limit(1000);
    if (last) q = q.startAfter(last);
    const s = await q.get();
    if (s.empty) break;
    for (const d of s.docs) { out.set(d.id, d.data()); last = d; }
    if (s.size < 1000) break;
  }
  return out;
};

// ----------------------------------------------------------------- bien doi
const ts = (v) => {
  if (v == null) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === 'object' && v._seconds != null) {
    return new Date(v._seconds * 1000 + (v._nanoseconds || 0) / 1e6).toISOString();
  }
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  if (typeof v === 'number') return new Date(v).toISOString();
  return null;
};
const date = (v) => {
  if (v == null) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = ts(v);
  return t ? t.slice(0, 10) : null;
};
const time = (v) => {
  if (!v || typeof v !== 'string') return null;
  const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
};
const str = (v) => (v == null ? null : String(v));
const nonEmpty = (v) => { const s = str(v); return s && s.trim() ? s : null; };

const NL = String.fromCharCode(10);

// `note` = bat ngo, phai xem lai. `planned` = da co quyet dinh trong
// decisions.json. Tach hai loai ra la diem cua ca bai: cuoi lan chay, muc
// "bat ngo" phai bang 0.
const skipped = [];
const expected = [];
const note = (table, id, why) => skipped.push({ table, id, why });
const planned = (table, id, why) => expected.push({ table, id, why });

let seq = 0;
const gen = (prefix) => `${prefix}_${(++seq).toString(36)}`;

// So hang thuc su vao duoc moi bang — ghi xuong cuoi file SQL lam con so ky vong,
// de sau khi chay tren VPS co thu ma doi chieu.
const loadedCount = new Map();

// Chen tung hang de biet chinh xac hang nao hong (cham hon nhung day la dien tap).
async function insert(table, cols, rows) {
  let ok = 0;
  const names = cols.join(', ');
  const holes = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${names}) VALUES (${holes})`;
  recorder?.section(`${table}  (${rows.length} hang)`);
  for (const row of rows) {
    try {
      await pg.query(sql, cols.map(c => row[c] ?? null));
      ok++;
    } catch (e) {
      note(table, row.id ?? '?', e.message.split('\n')[0]);
    }
  }
  console.log(`${table.padEnd(30)} nap ${ok}/${rows.length}`);
  loadedCount.set(table, (loadedCount.get(table) ?? 0) + ok);
  return ok;
}

// ------------------------------------------------------------------ doc data
const [users, students, classes, enrollments, ledgers, receipts, wtx, attendance, sessions, credentials]
  = await Promise.all(['users', 'students', 'classes', 'student_course_enrollments', 'course_fee_ledgers',
    'receipts', 'wallet_transactions', 'attendance', 'class_sessions', 'student_auth_credentials'].map(load));

// ------------------------------------------------------------- chuan hoa
// Moi quyet dinh nam o db/normalization/decisions.json, khong giau trong code.
// Chay 03-verify-decisions.mjs de kiem tung khang dinh trong do con dung khong.
const decisions = JSON.parse(readFileSync(`${repo}/db/normalization/decisions.json`, 'utf8'));

const reconstruct = new Map(decisions.reconstructStudents.map(r => [r.id, r]));
const keepArchived = new Set(decisions.keepArchivedProfiles.map(r => r.id));
const dropRow = new Set(decisions.dropRows.map(d => `${d.collection}/${d.id}`));
const fixValue = new Map(decisions.fixValues.map(f => [`${f.collection}/${f.id}/${f.field}`, f]));
const mergeAlloc = new Set(decisions.mergeReceiptAllocations.map(m => m.receiptId));
const dropOrphanBulkJobIds = new Set(
  decisions.dropRows
    .filter(d => d.collection === 'zalo_bulk_job_items')
    .flatMap(d => d.match?.jobId ?? []));

// Ho so da gop (mergedIntoStudentId): khong nap — ca 58 dich den con song va
// mang cung ma. Ho so chi bi luu tru (deletedAt, khong merge) thi GIU, vi chung
// con nam cuoi mot so tham chieu that.
const retired = new Set();
for (const [id, s] of students) {
  if (keepArchived.has(id)) continue;
  if (s.deletedAt || s.mergedIntoStudentId || s.studentProfileState === 'merged_tombstone') retired.add(id);
}
const liveStudent = (id) =>
  reconstruct.has(id) || (students.has(id) && !retired.has(id));

const applyFix = (collection, id, field, value) =>
  fixValue.get(`${collection}/${id}/${field}`)?.to ?? value;

console.log(`chuan hoa: dung lai ${reconstruct.size} ho so, giu ${keepArchived.size} ho so luu tru, `
  + `bo ${retired.size} vo ho so da gop, bo ${dropRow.size} hang, sua ${fixValue.size} gia tri\n`);

await pg.query('SELECT app_disable_finance_guards()');

// ------------------------------------------------------------------ students
await insert('students', ['id', 'code', 'name', 'dob', 'contact', 'gender', 'grade',
  'student_lifecycle', 'admission_status', 'admitted_at', 'enrollment_date',
  'trial_session_count', 'trial_required_sessions', 'trial_review_status', 'trial_started_at',
  'face_image_storage_path', 'is_revoked', 'created_at', 'updated_at'],
  [...students].filter(([id]) => !retired.has(id)).map(([id, s]) => ({
    id,
    // Ma dang nhap nam o truong `studentId`, khong phai `code`.
    code: str(s.studentId),
    name: str(s.name),
    dob: date(s.dob),
    contact: nonEmpty(s.contact),
    gender: ['male', 'female', 'other'].includes(s.gender) ? s.gender : null,
    grade: Number.isInteger(s.grade) ? s.grade : null,
    // Ho so bi luu tru (co deletedAt nhung khong merge) vao voi lifecycle
    // 'archived' + is_revoked — chung con nam cuoi mot so tham chieu that,
    // nhung khong duoc xuat hien nhu hoc sinh dang hoc.
    student_lifecycle: keepArchived.has(id) ? 'archived'
      : (['pending', 'lead', 'trial', 'enrolled', 'archived'].includes(s.studentLifecycle)
        ? s.studentLifecycle : 'enrolled'),
    admission_status: ['pending', 'trial', 'accepted', 'rejected'].includes(s.admissionStatus)
      ? s.admissionStatus : null,
    admitted_at: null,   // dat cung admitted_by o buoc sau (CHECK di doi)
    enrollment_date: date(s.enrollmentDate),
    trial_session_count: Number.isInteger(s.trialSessionCount) ? s.trialSessionCount : 0,
    trial_required_sessions: s.trialRequiredSessions || null,
    trial_review_status: s.trialReviewStatus || null,
    trial_started_at: ts(s.trialStartedAt),
    face_image_storage_path: nonEmpty(s.faceImageStoragePath) || nonEmpty(s.faceImage),
    is_revoked: keepArchived.has(id) ? true : !!s.isRevoked,
    created_at: ts(s.createdAt) || new Date().toISOString(),
    updated_at: ts(s.updatedAt) || new Date().toISOString(),
  })));

// students.admitted_by / trial_teacher_id / trial_class_id duoc va nguoc sau
// khi co users + classes (xem muc "Thu tu nap" trong db/README.md).

// --------------------------------------------------- ho so dung lai tu audit
// Sau dot xoa tay 2026-08-10, sau ho so bien mat khoi students nhung van con
// bi 68 ban ghi tro toi — trong do co bien lai va giao dich vi. audit_logs con
// giu du ten + ma + lop cua ca sau. Dung lai o day; khong bia them truong nao
// ngoai nhung gi decisions.json tro nguoc duoc ve mot ban ghi that.
await insert('students', ['id', 'code', 'name', 'dob', 'contact',
  'student_lifecycle', 'is_revoked', 'created_at', 'updated_at'],
  decisions.reconstructStudents.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    dob: r.dob ?? null,
    contact: r.contact ?? null,
    student_lifecycle: r.studentLifecycle,
    is_revoked: r.isRevoked,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })));

await insert('student_auth_credentials',
  ['student_id', 'parent_password_hash', 'parent_password_salt', 'migrated_at', 'updated_at'],
  [...credentials].filter(([id]) => liveStudent(id)).map(([id, c]) => ({
    student_id: id,
    parent_password_hash: nonEmpty(c.parentPasswordHash),
    parent_password_salt: nonEmpty(c.parentPasswordSalt),
    migrated_at: ts(c.migratedAt),
    updated_at: ts(c.updatedAt) || new Date().toISOString(),
  })));

// --------------------------------------------------------------------- users
// THU TU BAT BUOC: students -> users -> classes -> vá nguoc students.
// Ly do: users_student_link la CHECK (khong deferrable duoc trong Postgres),
// nen mot user role student/parent PHAI co student_id ngay tu luc chen. Con
// students.admitted_by / trial_teacher_id / trial_class_id deu nullable nen vá
// nguoc duoc. Xem db/README.md muc "Thu tu nap".
await insert('users', ['id', 'email', 'display_name', 'bio', 'role', 'phone', 'student_id',
  'force_password_change', 'is_revoked', 'created_at', 'updated_at'],
  [...users].filter(([id]) => !dropRow.has(`users/${id}`)).map(([id, u]) => ({
    id,
    email: nonEmpty(u.email),
    display_name: str(u.displayName) || id,
    bio: nonEmpty(u.bio),
    role: str(u.role),
    phone: nonEmpty(u.phone),
    student_id: liveStudent(u.studentId) ? u.studentId : null,
    force_password_change: !!u.forcePasswordChange,
    is_revoked: !!u.isRevoked,
    created_at: ts(u.createdAt) || new Date().toISOString(),
    updated_at: ts(u.updatedAt) || new Date().toISOString(),
  })));

// ------------------------------------------------------------------- classes
await insert('classes', ['id', 'name', 'description', 'room', 'teacher_id', 'status', 'grade',
  'salary_per_session', 'promoted_at', 'promotion_source_class_name', 'promotion_source_teacher_name',
  'promotion_note', 'promotion_recorded_at', 'archived_at', 'archived_by', 'archive_reason',
  'created_at', 'updated_at'],
  [...classes].map(([id, c]) => {
    const status = c.status === 'archived' ? 'archived' : (c.status || 'active');
    return {
      id,
      name: str(c.name),
      description: str(c.description ?? ''),
      room: str(c.room ?? ''),
      teacher_id: str(c.teacherId),
      status,
      grade: Number.isInteger(c.grade) ? c.grade : null,
      salary_per_session: c.salaryPerSession ?? 0,
      promoted_at: ts(c.promotedAt),
      promotion_source_class_name: c.promotionLineage?.sourceClassName ?? null,
      promotion_source_teacher_name: c.promotionLineage?.sourceTeacherName ?? null,
      promotion_note: c.promotionLineage?.note ?? null,
      promotion_recorded_at: ts(c.promotionLineage?.recordedAt),
      archived_at: status === 'archived' ? ts(c.archivedAt ?? c.deletedAt) : null,
      archived_by: status === 'archived' && users.has(c.archivedBy ?? c.deletedBy)
        ? (c.archivedBy ?? c.deletedBy) : null,
      archive_reason: status === 'archived' ? nonEmpty(c.archiveReason) : null,
      created_at: ts(c.createdAt) || new Date().toISOString(),
      updated_at: ts(c.updatedAt) || new Date().toISOString(),
    };
  }));

// import_source_class_id dat sau (self-FK).
for (const [id, c] of classes) {
  if (c.importSourceClassId && classes.has(c.importSourceClassId)) {
    try {
      await pg.query('UPDATE classes SET import_source_class_id = $1 WHERE id = $2',
        [c.importSourceClassId, id]);
    } catch (e) { note('classes.import_source', id, e.message.split('\n')[0]); }
  }
}

// Va nguoc ba cot cua students tro sang users/classes (deu nullable, nen de
// den buoc nay duoc).
{
  let n = 0;
  for (const [id, st] of students) {
    if (retired.has(id)) continue;
    const admittedBy = users.has(st.admittedBy) ? st.admittedBy : null;
    const trialClass = classes.has(st.trialClassId) ? st.trialClassId : null;
    const trialTeacher = users.has(st.trialTeacherId) ? st.trialTeacherId : null;
    if (!admittedBy && !trialClass && !trialTeacher) continue;
    try {
      await pg.query(
        'UPDATE students SET admitted_at = $1, admitted_by = $2, trial_class_id = $3, trial_teacher_id = $4 WHERE id = $5',
        [admittedBy ? ts(st.admittedAt) : null, admittedBy, trialClass, trialTeacher, id]);
      n++;
    } catch (e) { note('students.backpatch', id, String(e.message).split(NL)[0]); }
  }
  console.log('students (va nguoc)              cap nhat ' + n);
}

// --------------------------------------------------------------- class_terms
// Ky trong terms[] cong voi "ky hien tai" dang nam rai tren chinh classes.
// Neu ky hien tai co cung startDate voi mot phan tu terms[] thi do la cung mot
// ky, khong tao hang thu hai.
// Ky duoc GHI DANH va LEDGER lam chung. Tren Firestore, danh sach ky cua mot lop
// nam trong chinh doc lop (terms[] + startDate/endDate hien tai). Khi lop bi reset
// sang khoa moi ma terms[] khong duoc noi them, ranh gioi ky cu chi con song trong
// ghi danh va ledger. Chung la nhan chung hop le: ca hai deu mang termStart/termEnd
// cua rieng chung va deu duoc ghi cung luc voi nghiep vu that.
const attestedTerms = new Map();   // classId -> Map(termStart -> { ends, fees, nE, nL })
{
  const put = (classId, start, end, fee, kind) => {
    if (!classId || !start || !classes.has(classId)) return;
    if (!attestedTerms.has(classId)) attestedTerms.set(classId, new Map());
    const m = attestedTerms.get(classId);
    if (!m.has(start)) m.set(start, { ends: new Set(), fees: new Set(), nE: 0, nL: 0 });
    const ev = m.get(start);
    if (end) ev.ends.add(end);
    if (typeof fee === 'number') ev.fees.add(fee);
    if (kind === 'e') ev.nE++; else ev.nL++;
  };
  for (const [, e] of enrollments) {
    if (!liveStudent(e.studentId)) continue;
    put(e.classId, date(e.termStart), date(e.termEnd), null, 'e');
  }
  for (const [, l] of ledgers) {
    if (!liveStudent(l.studentId)) continue;
    put(l.classId, date(l.termStart), date(l.termEnd), l.amount, 'l');
  }
}

let derivedFromAttestation = 0;
const termRows = [];
const termIdByKey = new Map();   // `${classId}|${termStart}` -> termId
for (const [classId, c] of classes) {
  const seen = new Map();
  for (const t of c.terms || []) {
    const start = date(t.startDate);
    if (!start) continue;
    seen.set(start, {
      id: str(t.id) || gen('term'),
      class_id: classId,
      course_id: nonEmpty(t.courseId),
      name: nonEmpty(t.name),
      term_start: start,
      term_end: date(t.endDate),
      tuition_fee: t.tuitionFee ?? null,
      start_time: time(t.startTime),
      days_of_week: Array.isArray(t.daysOfWeek) ? t.daysOfWeek : [],
      reset_operation_id: nonEmpty(t.resetOperationId),
      repair_source: nonEmpty(t.repairSource),
    });
  }
  const curStart = date(c.startDate);
  if (curStart) {
    const existing = seen.get(curStart);
    if (existing) {
      // Ky hien tai chinh la phan tu nay: bo sung nhung gi chi lop moi co.
      existing.tuition_fee ??= c.tuitionFee ?? null;
      existing.start_time ??= time(applyFix('classes', classId, 'startTime', c.startTime));
      if (!existing.days_of_week.length && Array.isArray(c.daysOfWeek)) existing.days_of_week = c.daysOfWeek;
      existing.course_id ??= nonEmpty(c.currentCourseId);
      existing.term_end ??= date(c.endDate);
    } else {
      seen.set(curStart, {
        id: gen('term'),
        class_id: classId,
        course_id: nonEmpty(c.currentCourseId),
        name: null,
        term_start: curStart,
        term_end: date(c.endDate),
        tuition_fee: c.tuitionFee ?? null,
        start_time: time(applyFix('classes', classId, 'startTime', c.startTime)),
        days_of_week: Array.isArray(c.daysOfWeek) ? c.daysOfWeek : [],
        reset_operation_id: null,
        repair_source: null,
      });
    }
  }
  // Ky ma CHI courseClosing con nho. Lop RI6vRY14dJtwLSpdy1Bc bi reset sang khoa
  // moi ma khong day khoa cu vao terms[]; ban ghi ket khoa cua chinh lop la thu
  // duy nhat con giu ranh gioi ky do, va co ledger tro toi no.
  for (const cc of [c.courseClosing, ...(c.terms || []).map(t => t.courseClosing)]) {
    const start = date(cc?.termStart);
    if (!start || seen.has(start)) continue;
    seen.set(start, {
      id: gen('term'),
      class_id: classId,
      course_id: nonEmpty(cc.courseId),
      name: null,
      term_start: start,
      term_end: date(cc.termEnd),
      tuition_fee: null,
      start_time: null,
      days_of_week: [],
      reset_operation_id: null,
      repair_source: 'derived_from_course_closing',
    });
  }

  // Ky ma CHI ghi danh + ledger con nho. Do tren production 2026-08-19: dung hai lop
  // (G8 - Ms. Hang - T3T5 va G4 - Ms. Hang - T7CN) co terms[] rong VA courseClosing
  // null, trong khi 26 ghi danh + 26 ledger cua chung tro toi mot ky khac han ky ghi
  // tren doc lop — va 7.450.000d da thu nam tren cac ky do. Bo qua thi class_terms
  // thieu mot ky co tien, moi man hinh liet ke ky cua lop se khong thay no, va 26
  // ghi danh phai chiu term_id NULL vinh vien.
  //
  // Chi dung khi nhan chung khong mau thuan: moi ghi danh/ledger cua ky do phai cung
  // mot term_end. Mau thuan thi bao ra chu khong chon bua mot ben.
  for (const [start, ev] of attestedTerms.get(classId) ?? []) {
    if (seen.has(start)) continue;
    if (ev.ends.size > 1) {
      note('class_terms', `${classId}|${start}`,
        `ghi danh/ledger khong thong nhat term_end: ${[...ev.ends].join(', ')}`);
      continue;
    }
    seen.set(start, {
      id: gen('term'),
      class_id: classId,
      course_id: null,          // khong nhan chung nao con giu courseId cua ky da mat
      name: null,
      term_start: start,
      term_end: [...ev.ends][0] ?? null,
      tuition_fee: ev.fees.size === 1 ? [...ev.fees][0] : null,
      start_time: null,
      days_of_week: [],
      reset_operation_id: null,
      repair_source: 'derived_from_enrollments',
    });
    derivedFromAttestation++;
  }

  for (const [start, row] of seen) {
    termRows.push(row);
    termIdByKey.set(`${classId}|${start}`, row.id);
  }
}
await insert('class_terms', ['id', 'class_id', 'course_id', 'name', 'term_start', 'term_end',
  'tuition_fee', 'start_time', 'days_of_week', 'reset_operation_id', 'repair_source'], termRows);
if (derivedFromAttestation) {
  console.log(`  trong do ${derivedFromAttestation} ky dung lai tu ghi danh + ledger `
    + `(repair_source = 'derived_from_enrollments')`);
}

// Lich tuan + ngay nghi cua tung ky
const weekly = [], holidays = [];
for (const [classId, c] of classes) {
  const attach = (termStart, list) => {
    const termId = termIdByKey.get(`${classId}|${termStart}`);
    if (!termId) return;
    const slots = new Set();
    for (const w of list || []) {
      const st = time(w.startTime), en = time(w.endTime);
      if (st == null || en == null || w.dayOfWeek == null) continue;
      const key = `${w.dayOfWeek}|${st}`;
      if (slots.has(key)) continue;
      slots.add(key);
      weekly.push({
        id: gen('ws'), term_id: termId, day_of_week: w.dayOfWeek,
        start_time: st, end_time: en, room: nonEmpty(w.room),
      });
    }
  };
  for (const t of c.terms || []) attach(date(t.startDate), t.weeklySessions);
  const curStart = date(c.startDate);
  if (curStart && !(c.terms || []).some(t => date(t.startDate) === curStart)) {
    attach(curStart, c.weeklySessions);
  } else if (curStart) {
    const t = (c.terms || []).find(t => date(t.startDate) === curStart);
    if (!(t?.weeklySessions || []).length) attach(curStart, c.weeklySessions);
  }
}
await insert('class_term_weekly_sessions',
  ['id', 'term_id', 'day_of_week', 'start_time', 'end_time', 'room'], weekly);

// --------------------------------------------------------------- enrollments
const termFor = (classId, termStart) => termIdByKey.get(`${classId}|${termStart}`) ?? null;

await insert('student_course_enrollments', ['id', 'student_id', 'class_id', 'term_id',
  'term_start', 'term_end', 'status', 'joined_at', 'ended_at', 'status_reason', 'source',
  'confidence', 'status_changed_at', 'status_changed_by', 'confirmed_at', 'confirmed_by',
  'created_at', 'updated_at'],
  [...enrollments].filter(([id, e]) => {
    if (!liveStudent(e.studentId)) { note('student_course_enrollments', id, `studentId mo coi: ${e.studentId}`); return false; }
    return true;
  }).map(([id, e]) => ({
    id,
    student_id: e.studentId,
    class_id: e.classId,
    term_id: termFor(e.classId, date(e.termStart)),
    term_start: date(e.termStart),
    term_end: date(e.termEnd),
    status: e.status,
    joined_at: date(e.joinedAt),
    ended_at: date(e.endedAt),
    status_reason: nonEmpty(e.statusReason),
    source: e.source,
    confidence: e.confidence,
    status_changed_at: ts(e.statusChangedAt) || new Date().toISOString(),
    status_changed_by: str(e.statusChangedBy),
    confirmed_at: ts(e.confirmedAt),
    confirmed_by: e.confirmedAt ? str(e.confirmedBy) : null,
    created_at: ts(e.createdAt) || new Date().toISOString(),
    updated_at: ts(e.updatedAt) || new Date().toISOString(),
  })));

// ------------------------------------------------------------- class_sessions
const sessionSeen = new Set();
await insert('class_sessions', ['id', 'class_id', 'term_id', 'session_date', 'teacher_id',
  'status', 'salary_per_session', 'teacher_attendance_status', 'teacher_attendance_marked_at',
  'teacher_attendance_marked_by', 'teacher_attendance_marked_by_role', 'teacher_attendance_note',
  'teacher_attendance_source', 'created_at', 'updated_at'],
  [...sessions].filter(([id, s]) => {
    const k = `${s.classId}|${date(s.date)}`;
    if (dropRow.has(`class_sessions/${id}`)) return false;
    if (sessionSeen.has(k)) { note('class_sessions', id, `trung (class_id, session_date) = ${k} — KHONG nam trong decisions.json`); return false; }
    sessionSeen.add(k);
    return true;
  }).map(([id, s]) => ({
    id,
    class_id: s.classId,
    term_id: null,
    session_date: date(s.date),
    teacher_id: s.teacherId,
    status: s.status === 'taught' ? 'taught' : (s.status || 'taught'),
    salary_per_session: s.salaryPerSession ?? 0,
    teacher_attendance_status: s.teacherAttendanceStatus || null,
    teacher_attendance_marked_at: ts(s.teacherAttendanceMarkedAt),
    teacher_attendance_marked_by: nonEmpty(s.teacherAttendanceMarkedBy),
    teacher_attendance_marked_by_role: s.teacherAttendanceMarkedByRole || null,
    teacher_attendance_note: nonEmpty(s.teacherAttendanceNote),
    teacher_attendance_source: s.teacherAttendanceSource || null,
    created_at: ts(s.createdAt) || new Date().toISOString(),
    updated_at: ts(s.updatedAt) || new Date().toISOString(),
  })));

// -------------------------------------------------------------------- ledgers
await insert('course_fee_ledgers', ['id', 'student_id', 'class_id', 'enrollment_id', 'term_id',
  'term_start', 'term_end', 'amount', 'status', 'period_type', 'month', 'source', 'due_date',
  'migration_run_id', 'created_at', 'updated_at'],
  [...ledgers].filter(([id, l]) => {
    if (!liveStudent(l.studentId)) { note('course_fee_ledgers', id, `studentId mo coi: ${l.studentId}`); return false; }
    return true;
  }).map(([id, l]) => ({
    id,
    student_id: l.studentId,
    class_id: l.classId,
    enrollment_id: enrollments.has(l.enrollmentId) && liveStudent(enrollments.get(l.enrollmentId).studentId)
      ? l.enrollmentId : null,
    term_id: termFor(l.classId, date(l.termStart)),
    term_start: date(l.termStart),
    term_end: date(l.termEnd),
    amount: l.amount ?? 0,
    status: l.status,
    period_type: l.periodType || null,
    month: nonEmpty(l.month),
    source: l.source || null,
    due_date: date(l.dueDate),
    migration_run_id: nonEmpty(l.migrationRunId),
    created_at: ts(l.createdAt) || new Date().toISOString(),
    updated_at: ts(l.updatedAt) || new Date().toISOString(),
  })));

// ------------------------------------------------------------ wallets/receipts
await insert('student_wallets', ['student_id', 'opening_balance', 'history_started_at'],
  [...students].filter(([id, s]) => !retired.has(id) && s.walletOpeningBalance !== undefined)
    .map(([id, s]) => ({
      student_id: id,
      opening_balance: s.walletOpeningBalance ?? 0,
      history_started_at: date(s.walletHistoryStartedAt),
    })));

const loadedLedger = new Set();
{ const r = await pg.query('SELECT id FROM course_fee_ledgers'); for (const x of r.rows) loadedLedger.add(x.id); }

await insert('receipts', ['id', 'receipt_no', 'type', 'wallet_deposit', 'flow_version',
  'transaction_group_id', 'student_id', 'class_id', 'ledger_id', 'amount_received',
  'payment_method', 'received_date', 'status', 'note', 'notification_skipped_reason',
  'created_by', 'created_by_role', 'created_at', 'updated_at'],
  [...receipts].filter(([id, r]) => {
    if (!liveStudent(r.studentId)) { note('receipts', id, `studentId mo coi: ${r.studentId}`); return false; }
    return true;
  }).map(([id, r]) => ({
    id,
    receipt_no: str(r.receiptNo),
    type: 'tuition',
    wallet_deposit: !!r.walletDeposit || !(r.allocations || []).length,
    flow_version: nonEmpty(r.flowVersion),
    transaction_group_id: nonEmpty(r.transactionGroupId),
    student_id: r.studentId,
    class_id: classes.has(r.classId) ? r.classId : null,
    ledger_id: loadedLedger.has(r.ledgerId) ? r.ledgerId : null,
    amount_received: r.amountReceived ?? 0,
    payment_method: r.paymentMethod,
    received_date: date(r.receivedDate),
    status: r.status,
    note: str(r.note ?? ''),
    notification_skipped_reason: nonEmpty(r.notificationSkippedReason),
    created_by: r.createdBy,
    created_by_role: str(r.createdByRole),
    created_at: ts(r.createdAt) || new Date().toISOString(),
    updated_at: ts(r.updatedAt) || new Date().toISOString(),
  })));

const loadedReceipt = new Set();
{ const r = await pg.query('SELECT id FROM receipts'); for (const x of r.rows) loadedReceipt.add(x.id); }

const allocRows = [];
for (const [rid, r] of receipts) {
  if (!loadedReceipt.has(rid)) continue;
  // UNIQUE (receipt_id, ledger_id) khong cho hai dong cung tro mot ledger.
  // Production co dung 1 truong hop; gop lai thanh mot dong bang tong so tien
  // — dung ve mat tien, va ghi lai de bao cao.
  const merged = new Map();
  for (const a of r.allocations || []) {
    if (!loadedLedger.has(a.ledgerId)) { note('receipt_allocations', rid, `ledgerId mo coi: ${a.ledgerId}`); continue; }
    const prev = merged.get(a.ledgerId);
    if (prev) {
      prev.amount += a.amount ?? 0;
      prev.discount_amount += a.discountAmount ?? 0;
      prev.sibling_discount_amount += a.siblingDiscountAmount ?? 0;
      planned('receipt_allocations', rid, mergeAlloc.has(rid)
        ? `gop hai allocation cung ledger thanh mot (theo decisions.json)`
        : `GOP hai allocation cung ledger ${a.ledgerId} — KHONG nam trong decisions.json`);
      continue;
    }
    merged.set(a.ledgerId, {
      id: gen('alloc'),
      receipt_id: rid,
      ledger_id: a.ledgerId,
      class_id: a.classId,
      amount: a.amount ?? 0,
      discount_type: a.discountType || null,
      discount_amount: a.discountAmount ?? 0,
      discount_percent: a.discountPercent ?? null,
      discount_reason: nonEmpty(a.discountReason),
      sibling_discount: !!a.siblingDiscount,
      sibling_discount_amount: a.siblingDiscountAmount ?? 0,
    });
  }
  for (const row of merged.values()) allocRows.push(row);
}
await insert('receipt_allocations', ['id', 'receipt_id', 'ledger_id', 'class_id', 'amount',
  'discount_type', 'discount_amount', 'discount_percent', 'discount_reason',
  'sibling_discount', 'sibling_discount_amount'], allocRows);

await insert('wallet_transactions', ['id', 'schema_version', 'transaction_group_id',
  'group_sequence', 'source', 'student_id', 'type', 'amount', 'direction', 'status',
  'receipt_id', 'ledger_id', 'class_id', 'note', 'created_by', 'created_at', 'posted_at', 'updated_at'],
  [...wtx].filter(([id, t]) => {
    if (!liveStudent(t.studentId)) { note('wallet_transactions', id, `studentId mo coi: ${t.studentId}`); return false; }
    if (t.receiptId && !loadedReceipt.has(t.receiptId)) { note('wallet_transactions', id, `receiptId khong nap: ${t.receiptId}`); return false; }
    return true;
  }).map(([id, t]) => ({
    id,
    schema_version: t.schemaVersion ?? 2,
    transaction_group_id: nonEmpty(t.transactionGroupId),
    group_sequence: t.groupSequence ?? null,
    source: t.source || null,
    student_id: t.studentId,
    type: t.type,
    amount: t.amount,
    direction: t.type === 'adjustment' ? (t.direction || 'in') : null,
    status: t.status,
    receipt_id: loadedReceipt.has(t.receiptId) ? t.receiptId : null,
    ledger_id: loadedLedger.has(t.ledgerId) ? t.ledgerId : null,
    class_id: classes.has(t.classId) ? t.classId : null,
    note: str(t.note ?? ''),
    created_by: str(t.createdBy),
    created_at: ts(t.createdAt) || new Date().toISOString(),
    posted_at: ts(t.postedAt) || ts(t.createdAt),
    updated_at: ts(t.updatedAt) || ts(t.createdAt) || new Date().toISOString(),
  })));

// ----------------------------------------------------------------- attendance
const loadedEnrollment = new Map();
{
  const r = await pg.query('SELECT id, student_id, class_id, term_start, term_end FROM student_course_enrollments');
  for (const x of r.rows) {
    const k = `${x.student_id}|${x.class_id}`;
    if (!loadedEnrollment.has(k)) loadedEnrollment.set(k, []);
    loadedEnrollment.get(k).push(x);
  }
}
const enrollmentFor = (studentId, classId, d) => {
  const list = loadedEnrollment.get(`${studentId}|${classId}`) || [];
  for (const e of list) {
    const s = e.term_start instanceof Date ? e.term_start.toISOString().slice(0, 10) : String(e.term_start);
    const en = e.term_end == null ? null
      : (e.term_end instanceof Date ? e.term_end.toISOString().slice(0, 10) : String(e.term_end));
    if (d >= s && (en == null || d <= en)) return e.id;
  }
  return null;
};

const attSeen = new Set();
await insert('attendance', ['id', 'student_id', 'class_id', 'enrollment_id', 'attendance_date',
  'status', 'teacher_id', 'permission', 'minutes_late', 'is_voided', 'void_reason',
  'voided_at', 'voided_by', 'created_at', 'updated_at'],
  [...attendance].filter(([id, a]) => {
    if (!liveStudent(a.studentId)) { note('attendance', id, `studentId mo coi: ${a.studentId}`); return false; }
    const k = `${a.studentId}|${a.classId}|${date(a.date)}`;
    if (attSeen.has(k)) { note('attendance', id, `trung (student, class, date)`); return false; }
    attSeen.add(k);
    return true;
  }).map(([id, a]) => {
    const d = date(a.date);
    return {
      id,
      student_id: a.studentId,
      class_id: a.classId,
      enrollment_id: enrollmentFor(a.studentId, a.classId, d),
      attendance_date: d,
      status: a.status,
      teacher_id: a.teacherId,
      permission: !!a.permission,
      minutes_late: Number.isInteger(a.minutesLate) ? a.minutesLate : null,
      is_voided: !!a.isVoided,
      void_reason: nonEmpty(a.voidReason),
      voided_at: a.isVoided ? ts(a.voidedAt) : null,
      voided_by: a.isVoided && users.has(a.voidedBy) ? a.voidedBy : null,
      created_at: new Date().toISOString(),
      updated_at: ts(a.updatedAt) || new Date().toISOString(),
    };
  }));

// ------------------------------------------------------- bat lai bat bien tien
// ===========================================================================
// PHAN 2 — 40 collection con lai
// ===========================================================================
// Phan tren nap 14 bang cot loi (nguoi, lop, ky, ghi danh, tien). Phan nay nap
// phan con lai de chung minh CA schema nhan duoc du lieu that, khong chi phan
// xuong song.

const [evals, dailyReports, assignmentsC, submissionsC, knowledgeBank,
  notificationsC, adminNotifications, zaloNotifications, zaloBotLinks,
  zaloBotLinkCodes, zaloBotMessages, zaloBotClaims, zaloBotSessions,
  zaloBulkJobs, zaloBulkItems, zaloConfig, auditLogs, outboxJobs, jobsC, jobRuns,
  finIdem, finMonthly, orderCodes, closingRecords, availProfiles, allowedTeachers,
  configC, systemSettingsC, maintenanceC, admissionsHistory, staffRequests,
  enrollJournal]
  = await Promise.all([
    'evaluations', 'dailyReports', 'assignments', 'submissions', 'knowledge_bank',
    'notifications', 'admin_notifications', 'zalo_notifications', 'zalo_bot_links',
    'zalo_bot_link_codes', 'zalo_bot_messages', 'zalo_bot_chat_claims', 'zalo_bot_chat_sessions',
    'zalo_bulk_jobs', 'zalo_bulk_job_items', '_zalo_config', 'audit_logs', 'outbox_jobs',
    'jobs', 'job_runs', 'finance_idempotency_keys', 'finance_monthly_aggregates',
    'payment_order_codes', 'course_closing_records', 'teacher_availability_profiles',
    'allowed_teachers', 'config', 'system_settings', '_maintenance', 'admissions_history',
    'staff_account_requests', 'student_enrollment_migration_journal',
  ].map(load));

const liveUser = (id) => id != null && users.has(id) && !dropRow.has(`users/${id}`);
const liveClass = (id) => id != null && classes.has(id);

// --------------------------------------------------------- student_leave_periods
{
  const rows = [];
  for (const [sid, s] of students) {
    if (!liveStudent(sid)) continue;
    for (const p of s.leavePeriods || []) {
      if (!p || !p.from) continue;
      rows.push({
        id: gen('leave'),
        student_id: sid,
        class_id: liveClass(p.classId) ? p.classId : null,
        leave_from: date(p.from),
        leave_until: date(p.until),
        note: nonEmpty(p.note),
        created_at: new Date().toISOString(),
      });
    }
  }
  await insert('student_leave_periods',
    ['id', 'student_id', 'class_id', 'leave_from', 'leave_until', 'note', 'created_at'], rows);
}

// ------------------------------------------------------------------ evaluations
{
  // termId cua Firestore co gia tri canh chung 'current' (17 doc) — phan giai
  // thanh ky that qua (classId, termStart), khong thi de NULL.
  const termIds = new Set([...(await pg.query('SELECT id FROM class_terms')).rows.map(r => r.id)]);
  const rows = [];
  for (const [id, e] of evals) {
    if (e.deletedAt || e.isDeleted === true) { planned('evaluations', id, 'ban danh gia da bi xoa — khong nap'); continue; }
    if (!liveStudent(e.studentId)) { note('evaluations', id, `studentId mo coi: ${e.studentId}`); continue; }
    if (!liveClass(e.classId)) { note('evaluations', id, `classId mo coi: ${e.classId}`); continue; }
    const sc = e.scores || {};
    rows.push({
      id,
      student_id: e.studentId,
      class_id: e.classId,
      term_id: termIds.has(e.termId) ? e.termId : termFor(e.classId, date(e.termStart)),
      teacher_id: liveUser(e.teacherId) ? e.teacherId : null,
      evaluation_type: e.evaluationType === 'midterm' ? 'midterm' : 'final',
      evaluated_at: ts(e.date) || ts(e.createdAt) || new Date().toISOString(),
      term_start: date(e.termStart),
      term_end: date(e.termEnd),
      score_attendance: sc.attendance ?? 0,
      score_behavior: sc.behavior ?? 0,
      score_effort: sc.effort ?? 0,
      score_homework: sc.homework ?? 0,
      score_pronunciation: sc.pronunciation ?? 0,
      final_score: e.finalScore ?? 0,
      total_score: e.totalScore ?? 0,
      rank: ['first', 'second', 'none'].includes(e.rank) ? e.rank : null,
      positive_points: Array.isArray(e.positivePoints) ? e.positivePoints : [],
      improvement_points: str(e.improvementPoints ?? ''),
      created_at: ts(e.createdAt) || new Date().toISOString(),
      updated_at: ts(e.updatedAt) || new Date().toISOString(),
    });
  }
  await insert('evaluations', ['id', 'student_id', 'class_id', 'term_id', 'teacher_id',
    'evaluation_type', 'evaluated_at', 'term_start', 'term_end',
    'score_attendance', 'score_behavior', 'score_effort', 'score_homework',
    'score_pronunciation', 'final_score', 'total_score', 'rank',
    'positive_points', 'improvement_points', 'created_at', 'updated_at'], rows);
}

// ----------------------------------------------------------------- daily_reports
await insert('daily_reports', ['id', 'class_id', 'teacher_id', 'report_date',
  'general_comment', 'additional_notes', 'created_at', 'updated_at'],
  [...dailyReports].filter(([id, r]) => liveClass(r.classId) && liveUser(r.teacherId))
    .map(([id, r]) => ({
      id,
      class_id: r.classId,
      teacher_id: r.teacherId,
      report_date: date(r.date),
      general_comment: str(r.generalComment ?? ''),
      additional_notes: str(r.additionalNotes ?? ''),
      created_at: ts(r.createdAt) || new Date().toISOString(),
      updated_at: ts(r.updatedAt) || new Date().toISOString(),
    })));

// ------------------------------------------------- assignments / questions / options
const questionIdByKey = new Map();   // `${assignmentId}|${legacyKey}` -> question id
{
  await insert('assignments', ['id', 'class_id', 'teacher_id', 'title', 'description',
    'type', 'due_date', 'attempts_allowed', 'created_at', 'updated_at'],
    [...assignmentsC].filter(([id, a]) => liveClass(a.classId) && liveUser(a.teacherId))
      .map(([id, a]) => ({
        id,
        class_id: a.classId,
        teacher_id: a.teacherId,
        title: str(a.title),
        description: str(a.description ?? ''),
        type: ['quiz', 'essay', 'assessment'].includes(a.type) ? a.type : 'quiz',
        // 'YYYY-MM-DDTHH:mm' khong mui gio -> dien giai theo Asia/Ho_Chi_Minh (+07)
        due_date: a.dueDate ? new Date(`${a.dueDate}:00+07:00`).toISOString() : null,
        attempts_allowed: a.attemptsAllowed ?? 1,
        created_at: ts(a.createdAt) || new Date().toISOString(),
        updated_at: ts(a.updatedAt) || new Date().toISOString(),
      })));

  const qRows = [], oRows = [];
  for (const [aid, a] of assignmentsC) {
    if (!liveClass(a.classId) || !liveUser(a.teacherId)) continue;
    let pos = 0;
    for (const q of a.questions || []) {
      pos++;
      const qid = gen('q');
      questionIdByKey.set(`${aid}|${q.id}`, qid);
      qRows.push({
        id: qid, assignment_id: aid, position: pos,
        legacy_question_key: Number.isFinite(q.id) ? q.id : null,
        question_content: str(q.question_content ?? ''),
        level: nonEmpty(q.level),
        correct_answer: str(q.correct_answer),
      });
      for (const o of q.options || []) {
        oRows.push({ id: gen('opt'), question_id: qid, option_key: str(o.key), option_text: str(o.text ?? '') });
      }
    }
  }
  // FK ghep (id, correct_answer) -> options(question_id, option_key) la
  // DEFERRABLE INITIALLY DEFERRED, tuc hoan kiem toi CUOI TRANSACTION — khong
  // lau hon. Chen tung hang o che do autocommit thi moi INSERT la mot
  // transaction rieng, nen cau hoi bi tu choi ngay vi phuong an chua ton tai.
  // Hai bang nay PHAI nam trong cung mot transaction.
  await pg.exec('BEGIN');
  try {
    await insert('assignment_questions', ['id', 'assignment_id', 'position',
      'legacy_question_key', 'question_content', 'level', 'correct_answer'], qRows);
    await insert('assignment_question_options',
      ['id', 'question_id', 'option_key', 'option_text'], oRows);
    await pg.exec('COMMIT');
  } catch (e) {
    await pg.exec('ROLLBACK');
    note('assignment_questions', '-', `transaction that bai: ${String(e.message).split(NL)[0]}`);
  }
}

// ------------------------------------------------------------------- submissions
{
  const rows = [], ansRows = [];
  for (const [id, s] of submissionsC) {
    if (!liveStudent(s.studentId)) { note('submissions', id, `studentId mo coi: ${s.studentId}`); continue; }
    if (!assignmentsC.has(s.assignmentId)) { note('submissions', id, `assignmentId mo coi: ${s.assignmentId}`); continue; }
    const ei = s.examIntegrity || {};
    rows.push({
      id,
      assignment_id: s.assignmentId,
      student_id: s.studentId,
      class_id: s.classId,
      teacher_id: s.teacherId,
      attempt_number: s.attemptNumber ?? 1,
      content: str(s.content ?? ''),
      grade: s.grade ?? null,
      status: ['submitted', 'graded', 'returned'].includes(s.status) ? s.status : 'submitted',
      submitted_at: ts(s.submittedAt) || new Date().toISOString(),
      integrity_session_started_at: ts(ei.sessionStartedAt),
      integrity_tab_switch_count: ei.tabSwitchCount ?? 0,
      integrity_focus_loss_count: ei.focusLossCount ?? 0,
      integrity_fullscreen_exit_count: ei.fullscreenExitCount ?? 0,
      integrity_auto_submitted: !!ei.autoSubmitted,
      integrity_auto_submit_reason: nonEmpty(ei.autoSubmitReason),
      created_at: ts(s.submittedAt) || new Date().toISOString(),
      updated_at: ts(s.updatedAt) || new Date().toISOString(),
    });
    const seenQ = new Set();
    for (const a of s.quizAnswers || []) {
      const qid = questionIdByKey.get(`${s.assignmentId}|${a.questionId}`);
      if (!qid) { note('submission_quiz_answers', id, `questionId ${a.questionId} khong khop cau hoi nao`); continue; }
      if (seenQ.has(qid)) { note('submission_quiz_answers', id, `tra loi trung cau hoi ${a.questionId}`); continue; }
      seenQ.add(qid);
      ansRows.push({ id: gen('ans'), submission_id: id, question_id: qid, selected_option: nonEmpty(a.selectedOption) });
    }
  }
  await insert('submissions', ['id', 'assignment_id', 'student_id', 'class_id', 'teacher_id',
    'attempt_number', 'content', 'grade', 'status', 'submitted_at',
    'integrity_session_started_at', 'integrity_tab_switch_count', 'integrity_focus_loss_count',
    'integrity_fullscreen_exit_count', 'integrity_auto_submitted', 'integrity_auto_submit_reason',
    'created_at', 'updated_at'], rows);
  await insert('submission_quiz_answers', ['id', 'submission_id', 'question_id', 'selected_option'], ansRows);
}

// ------------------------------------------------------------ knowledge_bank_items
await insert('knowledge_bank_items', ['id', 'title', 'description', 'resource_kind',
  'target_type', 'class_id', 'grade', 'curriculum_family', 'program_name', 'unit_number',
  'storage_path', 'original_filename', 'file_type', 'mime_type', 'file_size',
  'download_count', 'last_downloaded_at', 'uploaded_by', 'created_at', 'updated_at'],
  [...knowledgeBank].filter(([id, k]) => liveUser(k.uploadedBy)).map(([id, k]) => ({
    id,
    title: str(k.title),
    description: nonEmpty(k.description),
    resource_kind: ['document', 'video', 'audio', 'link'].includes(k.resourceKind) ? k.resourceKind : 'document',
    target_type: ['grade', 'class', 'global'].includes(k.targetType) ? k.targetType : 'global',
    class_id: liveClass(k.classId) ? k.classId : null,
    grade: Number.isInteger(k.grade) ? k.grade : null,
    curriculum_family: nonEmpty(k.curriculumFamily),
    program_name: nonEmpty(k.programName),
    unit_number: Number.isInteger(k.unitNumber) ? k.unitNumber : null,
    storage_path: str(k.storagePath),
    original_filename: str(k.originalFilename),
    file_type: str(k.fileType),
    mime_type: str(k.mimeType),
    file_size: k.fileSize ?? 0,
    download_count: k.downloadCount ?? 0,
    last_downloaded_at: ts(k.lastDownloadedAt),
    uploaded_by: k.uploadedBy,
    created_at: ts(k.createdAt) || new Date().toISOString(),
    updated_at: ts(k.updatedAt) || ts(k.createdAt) || new Date().toISOString(),
  })));

// -------------------------------------------------------------- ledger_notice_log
{
  // 14 cot tuitionNotice* / tuitionReminder* de len nhau trong cung document ->
  // mot hang mot lan gui.
  const rows = [];
  for (const [lid, l] of ledgers) {
    if (!loadedLedger.has(lid)) continue;
    const dmy = (v) => {
      const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : date(v);
    };
    if (l.tuitionNoticeLastSentAt) {
      rows.push({
        id: gen('notice'), ledger_id: lid, notice_kind: 'notice',
        sent_at: ts(l.tuitionNoticeLastSentAt),
        sent_by: str(l.tuitionNoticeLastSentBy ?? 'unknown'),
        source: ['evaluation', 'accounting', 'office', 'system'].includes(l.tuitionNoticeLastSource)
          ? l.tuitionNoticeLastSource : null,
        amount: l.tuitionNoticeLastAmount ?? null,
        due_date: dmy(l.tuitionNoticeLastDueDate),
        semester: null,
        message_id: nonEmpty(l.tuitionNoticeLastMessageId),
        created_at: ts(l.tuitionNoticeLastSentAt),
      });
    }
    if (l.tuitionReminderLastSentAt) {
      rows.push({
        id: gen('notice'), ledger_id: lid, notice_kind: 'reminder',
        sent_at: ts(l.tuitionReminderLastSentAt),
        sent_by: str(l.tuitionReminderLastSentBy ?? 'unknown'),
        source: null,
        amount: l.tuitionReminderLastAmount ?? null,
        due_date: dmy(l.tuitionReminderLastDueDate),
        semester: nonEmpty(l.tuitionReminderLastSemester),
        message_id: null,
        created_at: ts(l.tuitionReminderLastSentAt),
      });
    }
  }
  await insert('ledger_notice_log', ['id', 'ledger_id', 'notice_kind', 'sent_at', 'sent_by',
    'source', 'amount', 'due_date', 'semester', 'message_id', 'created_at'], rows);
}

// ------------------------------------------------------------------ course_closings
{
  const rows = [];
  const push = (classId, termStart, cc) => {
    const termId = termFor(classId, date(termStart));
    if (!termId) { note('course_closings', `${classId}|${termStart}`, 'khong tim thay ky tuong ung'); return; }
    if (rows.some(r => r.term_id === termId)) return;   // UNIQUE(term_id)
    const ap = cc.approval || {};
    rows.push({
      id: gen('closing'),
      term_id: termId,
      course_id: nonEmpty(cc.courseId),
      term_start: date(cc.termStart ?? termStart),
      term_end: date(cc.termEnd),
      approval_status: ['pending', 'approved', 'invalidated'].includes(ap.status) ? ap.status : null,
      approved_at: ts(ap.approvedAt),
      approved_by: liveUser(ap.approvedBy) ? ap.approvedBy : null,
      approved_by_role: ['teacher', 'admin', 'office'].includes(ap.approvedByRole) ? ap.approvedByRole : null,
      approval_source: ['teacher', 'admin', 'system'].includes(ap.source) ? ap.source : null,
      roster_fingerprint: nonEmpty(ap.rosterFingerprint),
      evaluation_fingerprint: nonEmpty(ap.evaluationFingerprint),
      invalidated_at: ts(ap.invalidatedAt),
      invalidated_by: liveUser(ap.invalidatedBy) ? ap.invalidatedBy : null,
      invalidated_reason: nonEmpty(ap.invalidatedReason),
      created_at: ts(ap.approvedAt) || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  };
  for (const [cid, c] of classes) {
    for (const t of c.terms || []) if (t.courseClosing) push(cid, t.startDate, t.courseClosing);
    if (c.courseClosing) push(cid, c.courseClosing.termStart ?? c.startDate, c.courseClosing);
  }
  await insert('course_closings', ['id', 'term_id', 'course_id', 'term_start', 'term_end',
    'approval_status', 'approved_at', 'approved_by', 'approved_by_role', 'approval_source',
    'roster_fingerprint', 'evaluation_fingerprint', 'invalidated_at', 'invalidated_by',
    'invalidated_reason', 'created_at', 'updated_at'], rows);
}

// ------------------------------------------------------- course_closing_records
{
  const rows = [], docRows = [];
  for (const [id, r] of closingRecords) {
    if (!liveStudent(r.studentId)) { note('course_closing_records', id, `studentId mo coi: ${r.studentId}`); continue; }
    if (!liveClass(r.classId)) { note('course_closing_records', id, `classId mo coi: ${r.classId}`); continue; }
    const es = r.evaluationSnapshot || {};
    const tsnap = r.tuitionSnapshot || {};
    rows.push({
      id,
      class_id: r.classId,
      term_id: termFor(r.classId, date(r.courseStartDate)),
      student_id: r.studentId,
      teacher_id: liveUser(r.teacherId) ? r.teacherId : null,
      course_id: str(r.courseId),
      closing_month: str(r.closingMonth),
      course_start_date: date(r.courseStartDate),
      course_end_date: date(r.courseEndDate),
      record_version: r.recordVersion ?? 1,
      student_code_snapshot: str(r.studentCode),
      student_name_snapshot: str(r.studentName),
      class_name_snapshot: str(r.className),
      teacher_name_snapshot: str(r.teacherName),
      evaluation_id: nonEmpty(es.evaluationId),
      evaluation_version: nonEmpty(es.evaluationVersion),
      evaluation_date_snapshot: date(es.evaluationDate),
      evaluation_classification: ['excellent', 'good', 'fair', 'failing'].includes(es.classification)
        ? es.classification : null,
      evaluation_final_score: es.finalExamScore ?? null,
      evaluation_total_score: es.totalScore ?? null,
      evaluation_positive_points: Array.isArray(es.positivePoints) ? es.positivePoints : [],
      evaluation_improvement_points: nonEmpty(es.improvementPoints),
      evaluation_scores_snapshot: es.scores ? JSON.stringify(es.scores) : null,
      evaluation_midterm_snapshot: es.midterm ? JSON.stringify(es.midterm) : null,
      tuition_ledger_id: loadedLedger.has(tsnap.ledgerId) ? tsnap.ledgerId : null,
      tuition_amount_snapshot: tsnap.amount ?? null,
      tuition_notice_date: date(tsnap.noticeDate),
      next_course_start_date: date(tsnap.nextCourseStartDate),
      next_course_end_date: date(tsnap.nextCourseEndDate),
      tuition_final_exam_date: date(tsnap.finalExamDate),
      tuition_final_exam_score: tsnap.finalExamScore ?? null,
      evaluation_availability_status: r.evaluationDataAvailability?.status ?? null,
      evaluation_availability_reason: nonEmpty(r.evaluationDataAvailability?.reason),
      evaluation_availability_assessed_at: ts(r.evaluationDataAvailability?.assessedAt),
      tuition_availability_status: r.tuitionDataAvailability?.status ?? null,
      tuition_availability_reason: nonEmpty(r.tuitionDataAvailability?.reason),
      tuition_availability_assessed_at: ts(r.tuitionDataAvailability?.assessedAt),
      backfilled_at: ts(r.backfill?.backfilledAt),
      backfill_source_digest: nonEmpty(r.backfill?.sourceDigest),
      backfill_version: r.backfill?.version ?? null,
      repair_source: nonEmpty(r.repairSource),
      repaired_at: ts(r.repairedAt),
      created_at: ts(r.createdAt) || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    for (const [kind, d] of [['evaluation', r.evaluationDocument], ['tuition', r.tuitionDocument]]) {
      if (!d) continue;
      docRows.push({
        id: gen('doc'), record_id: id, kind,
        status: ['pending', 'generating', 'ready', 'failed'].includes(d.status) ? d.status : 'pending',
        storage_path: nonEmpty(d.storagePath),
        preview_storage_path: nonEmpty(d.previewStoragePath),
        download_filename: nonEmpty(d.downloadFilename),
        mime_type: nonEmpty(d.mimeType),
        template_version: d.templateVersion ?? 1,
        attempts: d.attempts ?? 0,
        generated_at: ts(d.generatedAt),
        last_attempt_at: ts(d.lastAttemptAt),
        source_notification_id: nonEmpty(d.sourceNotificationId),
      });
    }
  }
  await insert('course_closing_records', Object.keys(rows[0] ?? { id: 1 }), rows);
  await insert('course_closing_record_documents', ['id', 'record_id', 'kind', 'status',
    'storage_path', 'preview_storage_path', 'download_filename', 'mime_type',
    'template_version', 'attempts', 'generated_at', 'last_attempt_at',
    'source_notification_id'], docRows);
}

// ------------------------------------------------------ teacher_availability
{
  const pRows = [], sRows = [];
  for (const [id, p] of availProfiles) {
    if (!liveUser(p.teacherId)) { note('teacher_availability_profiles', id, `teacherId mo coi: ${p.teacherId}`); continue; }
    pRows.push({
      id, teacher_id: p.teacherId, version: p.version ?? 1,
      created_by: liveUser(p.createdBy) ? p.createdBy : p.teacherId,
      updated_by: liveUser(p.updatedBy) ? p.updatedBy : p.teacherId,
      created_at: ts(p.createdAt) || new Date().toISOString(),
      updated_at: ts(p.updatedAt) || new Date().toISOString(),
    });
    const seen = new Set();
    for (const sel of p.selections || []) {
      const k = `${sel.dayKey}|${sel.slotId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      sRows.push({ id: gen('sel'), profile_id: id, day_key: sel.dayKey, slot_id: sel.slotId });
    }
  }
  await insert('teacher_availability_profiles',
    ['id', 'teacher_id', 'version', 'created_by', 'updated_by', 'created_at', 'updated_at'], pRows);
  await insert('teacher_availability_profile_selections',
    ['id', 'profile_id', 'day_key', 'slot_id'], sRows);
}

// ----------------------------------------------------------------- notifications
await insert('notifications', ['id', 'student_id', 'class_id', 'teacher_id', 'type',
  'title', 'message', 'is_read', 'created_at', 'updated_at'],
  [...notificationsC].filter(([id, n]) => {
    if (!liveStudent(n.studentId)) { note('notifications', id, `studentId mo coi: ${n.studentId}`); return false; }
    return true;
  }).map(([id, n]) => ({
    id,
    student_id: n.studentId,
    class_id: liveClass(n.classId) ? n.classId : null,
    teacher_id: liveUser(n.teacherId) ? n.teacherId : null,
    type: str(n.type),
    title: str(n.title),
    message: str(n.message),
    is_read: !!n.isRead,
    created_at: ts(n.createdAt) || new Date().toISOString(),
    updated_at: ts(n.updatedAt),
  })));

// ------------------------------------------------------------ zalo_notifications
await insert('zalo_notifications', ['id', 'zalo_message_id', 'type', 'status', 'phone',
  'student_id', 'class_id', 'term_id', 'teacher_id', 'notification_date', 'amount',
  'template_id', 'recipient_role', 'error_message', 'provider_error_code',
  'provider_message_id', 'sent_at', 'sent_by', 'delivered_at', 'completed_at',
  'resend_by', 'payload_snapshot', 'snapshot_checksum', 'created_at', 'updated_at'],
  [...zaloNotifications].map(([id, z]) => ({
    id,
    zalo_message_id: str(z.zaloMessageId ?? id),
    type: str(z.type),
    status: ['pending', 'sent', 'failed', 'skipped'].includes(z.status) ? z.status : 'pending',
    phone: str(z.phone ?? ''),
    student_id: liveStudent(z.studentId) ? z.studentId : null,
    class_id: liveClass(z.classId) ? z.classId : null,
    term_id: null,
    teacher_id: liveUser(z.teacherId) ? z.teacherId : null,
    notification_date: date(z.date),
    amount: z.amount ?? null,
    template_id: nonEmpty(z.templateId),
    recipient_role: nonEmpty(z.recipientRole),
    error_message: str(z.errorMessage ?? ''),
    provider_error_code: Number.isInteger(z.providerErrorCode) ? z.providerErrorCode : null,
    provider_message_id: nonEmpty(z.providerMessageId),
    sent_at: ts(z.sentAt) || (z.status === 'sent' ? ts(z.createdAt) : null),
    sent_by: liveUser(z.sentBy) ? z.sentBy : null,
    delivered_at: ts(z.deliveredAt),
    completed_at: ts(z.completedAt),
    resend_by: nonEmpty(z.resendBy),
    payload_snapshot: z.payloadSnapshot ? JSON.stringify(z.payloadSnapshot) : null,
    snapshot_checksum: nonEmpty(z.snapshotChecksum),
    created_at: ts(z.createdAt) || new Date().toISOString(),
    updated_at: ts(z.updatedAt) || ts(z.createdAt) || new Date().toISOString(),
  })));

// ------------------------------------------------------------- admin_notifications
{
  const rows = [], failRows = [];
  for (const [id, a] of adminNotifications) {
    rows.push({
      id,
      type: ['zalo_failure_digest', 'payment_needs_review', 'payment_failed', 'system_alert'].includes(a.type)
        ? a.type : 'system_alert',
      title: str(a.title), message: str(a.message), is_read: !!a.read,
      counts_by_type: JSON.stringify(a.countsByType ?? {}),
      payment_id: nonEmpty(a.paymentId),
      order_code: Number.isInteger(a.orderCode) ? a.orderCode : null,
      amount: a.amount ?? null, reason: nonEmpty(a.reason),
      created_at: ts(a.createdAt) || new Date().toISOString(),
      updated_at: ts(a.createdAt) || new Date().toISOString(),
    });
    for (const f of a.sampleFailures || []) {
      failRows.push({
        id: gen('fail'), admin_notification_id: id,
        zalo_notification_id: zaloNotifications.has(f.id) ? f.id : null,
        student_id: liveStudent(f.studentId) ? f.studentId : null,
        phone: nonEmpty(f.phone), failure_type: str(f.type),
        error_message: nonEmpty(f.errorMessage),
        occurred_at: ts(f.createdAt) || new Date().toISOString(),
      });
    }
  }
  await insert('admin_notifications', ['id', 'type', 'title', 'message', 'is_read',
    'counts_by_type', 'payment_id', 'order_code', 'amount', 'reason',
    'created_at', 'updated_at'], rows);
  await insert('admin_notification_failures', ['id', 'admin_notification_id',
    'zalo_notification_id', 'student_id', 'phone', 'failure_type', 'error_message',
    'occurred_at'], failRows);
}

// ----------------------------------------------------------------- bot Zalo
await insert('zalo_bot_links', ['id', 'staff_id', 'chat_id', 'chat_id_hash', 'role',
  'display_name', 'status', 'confirmation_status', 'linked_method', 'linked_by',
  'linked_at', 'last_seen_at', 'created_at', 'updated_at'],
  [...zaloBotLinks].filter(([id, l]) => liveUser(l.staffId)).map(([id, l]) => ({
    id, staff_id: l.staffId, chat_id: str(l.chatId), chat_id_hash: str(l.chatIdHash),
    role: l.role, display_name: nonEmpty(l.displayName),
    status: l.status === 'revoked' ? 'revoked' : 'active',
    confirmation_status: ['pending', 'confirmed', 'failed'].includes(l.confirmationStatus)
      ? l.confirmationStatus : null,
    linked_method: ['self', 'admin'].includes(l.linkedMethod) ? l.linkedMethod : null,
    linked_by: liveUser(l.linkedBy) ? l.linkedBy : null,
    linked_at: ts(l.linkedAt) || new Date().toISOString(),
    last_seen_at: ts(l.lastSeenAt),
    created_at: ts(l.linkedAt) || new Date().toISOString(),
    updated_at: ts(l.updatedAt) || new Date().toISOString(),
  })));

await insert('zalo_bot_link_codes', ['id', 'staff_id', 'role', 'display_name',
  'issued_at', 'expires_at', 'consumed_at', 'consumed_by_chat_id_hash'],
  [...zaloBotLinkCodes].filter(([id, c]) => liveUser(c.staffId)).map(([id, c]) => ({
    id, staff_id: c.staffId, role: c.role, display_name: nonEmpty(c.displayName),
    issued_at: ts(c.issuedAt), expires_at: ts(c.expiresAt),
    consumed_at: ts(c.consumedAt),
    consumed_by_chat_id_hash: c.consumedAt ? str(c.consumedByChatIdHash) : null,
  })));

await insert('zalo_bot_chat_claims', ['id', 'staff_id', 'claimed_at', 'released', 'released_at'],
  [...zaloBotClaims].filter(([id, c]) => liveUser(c.staffId)).map(([id, c]) => ({
    id, staff_id: c.staffId, claimed_at: ts(c.claimedAt),
    released: !!c.released, released_at: c.released ? (ts(c.releasedAt) || ts(c.claimedAt)) : null,
  })));

await insert('zalo_bot_chat_sessions', ['staff_id', 'last_intent', 'last_class_id',
  'last_asked_at', 'expires_at'],
  [...zaloBotSessions].filter(([id]) => liveUser(id)).map(([id, s]) => ({
    staff_id: id, last_intent: nonEmpty(s.lastIntent),
    last_class_id: liveClass(s.lastClassId) ? s.lastClassId : null,
    last_asked_at: ts(s.lastAskedAt), expires_at: ts(s.expiresAt),
  })));

await insert('zalo_bot_messages', ['id', 'staff_id', 'chat_id_hash', 'role', 'message_type',
  'digest_date', 'status', 'content_snapshot', 'provider_message_id', 'attempts',
  'last_attempt_at', 'error_code', 'error_message', 'created_at', 'updated_at'],
  [...zaloBotMessages].filter(([id, m]) => liveUser(m.staffId)).map(([id, m]) => ({
    id, staff_id: m.staffId, chat_id_hash: str(m.chatIdHash), role: m.role,
    message_type: ['daily_digest', 'chat_reply', 'link_confirmation'].includes(m.messageType)
      ? m.messageType : 'chat_reply',
    digest_date: date(m.digestDate),
    status: ['pending', 'sent', 'failed'].includes(m.status) ? m.status : 'pending',
    content_snapshot: nonEmpty(m.contentSnapshot),
    provider_message_id: nonEmpty(m.providerMessageId),
    attempts: m.attempts ?? 0, last_attempt_at: ts(m.lastAttemptAt),
    error_code: nonEmpty(m.errorCode), error_message: nonEmpty(m.errorMessage),
    created_at: ts(m.createdAt) || new Date().toISOString(),
    updated_at: ts(m.updatedAt) || new Date().toISOString(),
  })));

// ------------------------------------------------------------------ zalo bulk
await insert('zalo_bulk_jobs', ['id', 'class_id', 'course_id', 'type', 'status',
  'requested_count', 'valid_count', 'success_count', 'failure_count', 'created_by',
  'created_at', 'updated_at'],
  [...zaloBulkJobs].filter(([id, j]) => liveClass(j.classId) && liveUser(j.createdBy))
    .map(([id, j]) => ({
      id, class_id: j.classId, course_id: nonEmpty(j.courseId), type: j.type,
      status: ['pending', 'running', 'completed', 'partial_failure', 'failed'].includes(j.status)
        ? j.status : 'completed',
      requested_count: j.requestedCount ?? 0, valid_count: j.validCount ?? 0,
      success_count: j.successCount ?? 0, failure_count: j.failureCount ?? 0,
      created_by: j.createdBy,
      created_at: ts(j.createdAt) || new Date().toISOString(),
      updated_at: ts(j.updatedAt) || new Date().toISOString(),
    })));

{
  const loadedJobs = new Set((await pg.query('SELECT id FROM zalo_bulk_jobs')).rows.map(r => r.id));
  const seenPair = new Set();
  await insert('zalo_bulk_job_items', ['id', 'job_id', 'student_id', 'class_id', 'course_id',
    'type', 'status', 'message_id', 'error', 'created_at', 'updated_at'],
    [...zaloBulkItems].filter(([id, it]) => {
      if (dropOrphanBulkJobIds.has(it.jobId)) {
        planned('zalo_bulk_job_items', id, `job ${it.jobId} da bi xoa — bo hang noi (theo decisions.json)`);
        return false;
      }
      if (!loadedJobs.has(it.jobId)) { note('zalo_bulk_job_items', id, `jobId mo coi: ${it.jobId}`); return false; }
      if (!liveStudent(it.studentId)) { note('zalo_bulk_job_items', id, `studentId mo coi: ${it.studentId}`); return false; }
      const k = `${it.jobId}|${it.studentId}`;
      if (seenPair.has(k)) { note('zalo_bulk_job_items', id, 'trung (job_id, student_id)'); return false; }
      seenPair.add(k);
      return true;
    }).map(([id, it]) => ({
      id, job_id: it.jobId, student_id: it.studentId, class_id: it.classId,
      course_id: nonEmpty(it.courseId), type: it.type,
      status: ['pending', 'sent', 'failed'].includes(it.status) ? it.status : 'pending',
      message_id: zaloNotifications.has(it.messageId) ? it.messageId : null,
      error: str(it.error ?? ''),
      created_at: ts(it.createdAt) || new Date().toISOString(),
      updated_at: ts(it.updatedAt) || new Date().toISOString(),
    })));
}

await insert('zalo_config', ['id', 'access_token', 'refresh_token', 'expires_at', 'updated_at'],
  [...zaloConfig].map(([id, c]) => ({
    id: 'tokens', access_token: str(c.accessToken), refresh_token: str(c.refreshToken),
    expires_at: new Date(c.expiresAt).toISOString(),
    updated_at: ts(c.updatedAt) || new Date().toISOString(),
  })));

// ---------------------------------------------------------------- staff access
{
  // allowed_teachers (29 doc) + config/allowedStaff -> mot bang, hai view.
  const rows = new Map();
  for (const [email, a] of allowedTeachers) {
    rows.set(String(email).toLowerCase().trim(), {
      email: String(email).toLowerCase().trim(), status: 'allowed',
      role: ['teacher', 'admin', 'accounting', 'office'].includes(a.role) ? a.role : 'teacher',
      added_at: ts(a.addedAt), added_by_admin: !!a.addedByAdmin,
      blocked_at: null, blocked_by: null, updated_at: ts(a.addedAt) || new Date().toISOString(),
    });
  }
  const cfg = configC.get('allowedStaff');
  for (const [email, role] of Object.entries(cfg?.roles ?? {})) {
    const k = String(email).toLowerCase().trim();
    if (rows.has(k)) continue;
    rows.set(k, {
      email: k, status: 'allowed',
      role: ['teacher', 'admin', 'accounting', 'office'].includes(role) ? role : 'teacher',
      added_at: null, added_by_admin: false, blocked_at: null, blocked_by: null,
      updated_at: new Date().toISOString(),
    });
  }
  await insert('staff_email_access', ['email', 'status', 'role', 'added_at',
    'added_by_admin', 'blocked_at', 'blocked_by', 'updated_at'], [...rows.values()]);
}

// ------------------------------------------------------- cau hinh / bao tri
await insert('system_settings', ['key', 'value', 'updated_at'],
  [...systemSettingsC].map(([id, v]) => ({
    key: id, value: JSON.stringify(v), updated_at: ts(v.updatedAt) || new Date().toISOString(),
  })));

await insert('maintenance_flags', ['key', 'value', 'ran_at', 'updated_at'],
  [...maintenanceC].map(([id, v]) => ({
    key: id, value: JSON.stringify(v), ran_at: ts(v.ranAt ?? v.lastRunAt),
    updated_at: ts(v.ranAt ?? v.createdAt) || new Date().toISOString(),
  })));

await insert('staff_account_requests', ['id', 'name', 'phone', 'role', 'status',
  'created_at', 'updated_at'],
  [...staffRequests].map(([id, r]) => ({
    id, name: str(r.name), phone: str(r.phone),
    role: ['teacher', 'admin', 'accounting', 'office'].includes(r.role) ? r.role : 'teacher',
    status: ['pending', 'accepted', 'rejected'].includes(r.status) ? r.status : 'pending',
    created_at: ts(r.createdAt) || new Date().toISOString(),
    updated_at: ts(r.updatedAt) || new Date().toISOString(),
  })));

await insert('admissions_history', ['id', 'student_id', 'class_id', 'teacher_id', 'action',
  'actor_id', 'actor_role', 'note', 'created_by', 'created_at'],
  [...admissionsHistory].filter(([id, a]) => {
    if (!liveStudent(a.studentId)) { note('admissions_history', id, `studentId mo coi: ${a.studentId}`); return false; }
    return true;
  }).map(([id, a]) => ({
    id, student_id: a.studentId,
    class_id: liveClass(a.classId) ? a.classId : null,
    teacher_id: liveUser(a.teacherId) ? a.teacherId : null,
    action: ['added_to_waitlist', 'class_changed', 'admitted', 'rejected'].includes(a.action)
      ? a.action : 'class_changed',
    actor_id: liveUser(a.actorId) ? a.actorId : null,
    actor_role: nonEmpty(a.actorRole), note: nonEmpty(a.note),
    created_by: str(a.createdBy ?? a.actorId ?? 'system'),
    created_at: ts(a.createdAt ?? a.timestamp) || new Date().toISOString(),
  })));

// -------------------------------------------------------------------- van hanh
{
  const isIp = (v) => typeof v === 'string' &&
    (/^\d{1,3}(\.\d{1,3}){3}$/.test(v) || /^[0-9a-fA-F:]+$/.test(v) && v.includes(':'));
  let badIp = 0;
  await insert('audit_logs', ['id', 'occurred_at', 'user_id', 'user_role', 'user_name', 'action',
    'entity_table', 'entity_id', 'ip', 'user_agent', 'changes', 'metadata'],
    [...auditLogs].map(([id, a]) => {
      if (a.ip && !isIp(a.ip)) badIp++;
      return {
        id,
        occurred_at: ts(a.timestamp) || new Date().toISOString(),
        user_id: str(a.userId ?? 'unknown'),
        user_role: str(a.userRole ?? 'unknown'),
        user_name: nonEmpty(a.userName),
        action: str(a.action),
        entity_table: str(a.collection),
        entity_id: str(a.documentId ?? ''),
        ip: isIp(a.ip) ? a.ip : null,
        user_agent: nonEmpty(a.userAgent),
        changes: a.changes ? JSON.stringify(a.changes) : null,
        metadata: a.metadata ? JSON.stringify(a.metadata) : null,
      };
    }));
  if (badIp) planned('audit_logs', '-', `${badIp} gia tri ip khong phai dia chi hop le -> NULL`);
}

await insert('outbox_jobs', ['id', 'type', 'idempotency_key', 'status', 'payload',
  'attempts', 'max_attempts', 'next_run_at', 'locked_by', 'processing_started_at',
  'last_error', 'created_at', 'updated_at'],
  [...outboxJobs].map(([id, o]) => ({
    id, type: str(o.type), idempotency_key: str(o.idempotencyKey ?? id),
    status: ['pending', 'processing', 'done', 'failed', 'dead'].includes(o.status) ? o.status : 'pending',
    payload: JSON.stringify(o.payload ?? {}),
    attempts: o.attempts ?? 0, max_attempts: o.maxAttempts ?? 3,
    next_run_at: ts(o.nextRunAt) || new Date().toISOString(),
    locked_by: nonEmpty(o.lockedBy),
    processing_started_at: o.lockedBy ? ts(o.processingStartedAt) : null,
    last_error: nonEmpty(o.lastError),
    created_at: ts(o.createdAt) || new Date().toISOString(),
    updated_at: ts(o.updatedAt) || new Date().toISOString(),
  })));

await insert('jobs', ['id', 'kind', 'name', 'status', 'params', 'result', 'error', 'attempts',
  'requested_by_id', 'requested_by_role', 'started_at', 'completed_at', 'duration_ms',
  'schema_version', 'created_at', 'updated_at'],
  [...jobsC].map(([id, j]) => ({
    id, kind: str(j.kind), name: str(j.name),
    status: ['queued', 'running', 'completed', 'failed', 'skipped'].includes(j.status) ? j.status : 'completed',
    params: JSON.stringify(j.params ?? {}), result: JSON.stringify(j.result ?? {}),
    error: j.error ? JSON.stringify(j.error) : null,
    attempts: j.attempts ?? 0,
    requested_by_id: liveUser(j.requestedBy?.uid) ? j.requestedBy.uid : null,
    requested_by_role: nonEmpty(j.requestedBy?.role),
    started_at: ts(j.startedAt), completed_at: ts(j.completedAt),
    duration_ms: j.durationMs ?? null, schema_version: j.schemaVersion ?? 1,
    created_at: ts(j.createdAt) || new Date().toISOString(),
    updated_at: ts(j.updatedAt) || new Date().toISOString(),
  })));

await insert('job_runs', ['job_name', 'status', 'started_at', 'finished_at', 'checked',
  'changed', 'cursor', 'error_code', 'error_message', 'updated_at'],
  [...jobRuns].map(([id, r]) => ({
    job_name: str(r.jobName ?? id),
    status: ['running', 'success', 'failed'].includes(r.status) ? r.status : 'success',
    started_at: ts(r.startedAt), finished_at: ts(r.finishedAt),
    checked: r.checked ?? 0, changed: r.changed ?? 0, cursor: nonEmpty(r.cursor),
    error_code: str(r.errorCode ?? ''), error_message: str(r.errorMessage ?? ''),
    updated_at: ts(r.updatedAt) || new Date().toISOString(),
  })));

await insert('finance_idempotency_keys', ['id', 'uid', 'idempotency_key', 'type', 'status',
  'request_fingerprint', 'ledger_ids', 'response', 'created_at', 'updated_at'],
  [...finIdem].map(([id, f]) => ({
    id, uid: str(f.uid), idempotency_key: str(f.idempotencyKey), type: str(f.type),
    status: ['in_progress', 'completed', 'failed'].includes(f.status) ? f.status : 'completed',
    request_fingerprint: nonEmpty(f.requestFingerprint),
    ledger_ids: Array.isArray(f.ledgerIds) ? f.ledgerIds : [],
    response: f.response ? JSON.stringify(f.response) : null,
    created_at: ts(f.createdAt) || new Date().toISOString(),
    updated_at: ts(f.updatedAt) || new Date().toISOString(),
  })));

await insert('finance_monthly_aggregates', ['month', 'range_start', 'range_end',
  'total_income', 'total_expenses', 'income_by_level', 'expenses_by_category',
  'source_counts', 'schema_version', 'generated_at'],
  [...finMonthly].map(([id, m]) => ({
    month: str(m.month ?? id),
    range_start: date(m.range?.startDate), range_end: date(m.range?.endDate),
    total_income: m.totalIncome ?? 0, total_expenses: m.totalExpenses ?? 0,
    income_by_level: JSON.stringify(m.incomeByLevel ?? []),
    expenses_by_category: JSON.stringify(m.expensesByCategory ?? []),
    source_counts: JSON.stringify(m.sourceCounts ?? {}),
    schema_version: m.schemaVersion ?? 1,
    generated_at: ts(m.generatedAt) || new Date().toISOString(),
  })));

await insert('payment_order_codes', ['order_code', 'provider', 'status', 'ledger_id',
  'student_id', 'class_id', 'parent_uid', 'amount', 'created_at', 'updated_at'],
  [...orderCodes].map(([id, o]) => ({
    order_code: o.orderCode ?? Number(id),
    provider: 'payos',
    status: ['reserved', 'used', 'released'].includes(o.status) ? o.status : 'reserved',
    ledger_id: loadedLedger.has(o.ledgerId) ? o.ledgerId : null,
    student_id: liveStudent(o.studentId) ? o.studentId : null,
    class_id: liveClass(o.classId) ? o.classId : null,
    parent_uid: nonEmpty(o.parentUid), amount: o.amount ?? null,
    created_at: ts(o.createdAt) || new Date().toISOString(),
    updated_at: ts(o.updatedAt) || new Date().toISOString(),
  })));

await insert('student_enrollment_migration_journal', ['id', 'migration_id', 'run_id',
  'student_id', 'document_id', 'digest', 'payload_fingerprint', 'target_project_id',
  'target_database_id', 'created_at'],
  [...enrollJournal].map(([id, j]) => ({
    id, migration_id: str(j.migrationId), run_id: str(j.runId),
    student_id: str(j.studentId), document_id: str(j.documentId),
    digest: str(j.digest), payload_fingerprint: str(j.payloadFingerprint),
    target_project_id: str(j.target?.projectId ?? ''),
    target_database_id: str(j.target?.databaseId ?? ''),
    created_at: ts(j.createdAt) || new Date().toISOString(),
  })));


console.log('\nBat lai bat bien tai chinh va kiem tra toan bo...');
let guardsOk = false;
try {
  const r = await pg.query('SELECT * FROM app_enable_finance_guards()');
  console.log(`  OK: kiem ${r.rows[0].checked_receipts} bien lai, ${r.rows[0].checked_ledgers} ledger — khong hang nao vi pham.`);
  guardsOk = true;
} catch (e) {
  console.log(`  FAIL: ${e.message.split('\n')[0]}`);
}

// ---------------------------------------------------------------- doi chieu
console.log('\nDOI CHIEU SO TIEN (Postgres vs Firestore)');
const q = async (sql) => (await pg.query(sql)).rows[0];

const pgPaid = await q('SELECT coalesce(sum(paid_total),0) AS v FROM v_ledger_totals');
let fsPaid = 0;
for (const [id, l] of ledgers) if (loadedLedger.has(id)) fsPaid += l.paidTotal || 0;
console.log(`  Tong da thu:      Postgres ${Number(pgPaid.v).toLocaleString('vi-VN')}  |  Firestore ${fsPaid.toLocaleString('vi-VN')}  ${Number(pgPaid.v) === fsPaid ? 'KHOP' : 'LECH'}`);

const pgWallet = await q('SELECT coalesce(sum(balance),0) AS v FROM v_student_wallet_balance');
let fsWallet = 0;
for (const [id, s] of students) if (!retired.has(id) && s.walletBalance !== undefined) fsWallet += s.walletBalance;
{
  // Lech o day KHONG phai loi cua ban nap: cot students.walletBalance tren
  // Firestore la cache cu, khong duoc cap nhat sau giao dich 2026-08-10.
  // Xem staleCachesNotImported trong db/normalization/decisions.json.
  const delta = Number(pgWallet.v) - fsWallet;
  const known = (decisions.staleCachesNotImported || [])
    .some(c => c.field === 'students.walletBalance');
  const verdict = delta === 0
    ? 'KHOP'
    : (known
      ? `lech ${delta.toLocaleString('vi-VN')} — cache cu cua Firestore, so cua Postgres moi dung`
      : `LECH ${delta.toLocaleString('vi-VN')} — CHUA GIAI THICH DUOC`);
  console.log(`  Tong so du vi:    Postgres ${Number(pgWallet.v).toLocaleString('vi-VN')}  |  Firestore ${fsWallet.toLocaleString('vi-VN')}  ${verdict}`);
}

const pgRecv = await q("SELECT coalesce(sum(amount_received),0) AS v FROM receipts WHERE status='posted'");
let fsRecv = 0;
for (const [id, r] of receipts) if (loadedReceipt.has(id) && r.status === 'posted') fsRecv += r.amountReceived || 0;
console.log(`  Tong bien lai:    Postgres ${Number(pgRecv.v).toLocaleString('vi-VN')}  |  Firestore ${fsRecv.toLocaleString('vi-VN')}  ${Number(pgRecv.v) === fsRecv ? 'KHOP' : 'LECH'}`);

const neg = await q('SELECT count(*) AS v FROM v_student_wallet_balance WHERE balance < 0');
console.log(`  Vi am:            ${neg.v}`);

const cnt = await q(`
  SELECT (SELECT count(*) FROM v_class_student_counts WHERE active < 0 OR total < 0) AS v`);
console.log(`  Bo dem lop am:    ${cnt.v}   (tren Firestore: co, thap nhat -16)`);

// ------------------------------------------------------------------- bo qua
console.log(`\nHANG BI BO QUA: ${skipped.length}`);
const byReason = new Map();
for (const s of skipped) {
  const k = `${s.table}: ${s.why.replace(/"[^"]*"/g, '"..."').slice(0, 110)}`;
  if (!byReason.has(k)) byReason.set(k, []);
  byReason.get(k).push(s.id);
}
for (const [k, ids] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(ids.length).padStart(4)}x  ${k}`);
  console.log(`         vd: ${ids.slice(0, 3).join(', ')}`);
}

// ------------------------------------------------------------------ xuat SQL
// File chi duoc viet ra khi lan chay nay SACH. Mot file du lieu sinh ra tu mot
// lan nap co hang bi tu choi la mot file thieu du lieu ma khong ai nhin thay —
// dung loai file ma sau cutover moi phat hien la mat.
if (emitAt) {
  if (skipped.length > 0) {
    console.log(`\nKHONG XUAT SQL: con ${skipped.length} hang bi bo ngoai du kien (xem muc tren).`);
    await raw.close();
    process.exit(1);
  }
  if (!guardsOk) {
    console.log('\nKHONG XUAT SQL: bat bien tai chinh khong qua.');
    await raw.close();
    process.exit(1);
  }
  const sql = recorder.render({
    sourceDatabase: dbId,
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries([...loadedCount].sort()),
  });
  writeFileSync(emitAt, sql, 'utf8');
  const mb = (Buffer.byteLength(sql, 'utf8') / 1048576).toFixed(1);
  console.log(`\nDA XUAT: ${emitAt}  (${recorder.count} cau lenh, ${mb} MB)`);
  console.log('Kiem lai bang:  node 05-verify-dump.mjs ../migrations ' + emitAt);
}

await raw.close();
process.exitCode = 0;
