/**
 * READ-ONLY. Bằng chứng Phase 1: lần bấm "Tạo công nợ" KẾ TIẾP sẽ làm gì?
 *
 * Chạy đúng planner mà production chạy (`planClassLedgers`), trên dữ liệu thật,
 * với cùng cách nạp enrollment và ledger như `classHelpers.ts:643-666`. Không ghi.
 *
 * Ba câu hỏi:
 *   1. Planner sẽ tạo bao nhiêu sổ, và trong đó bao nhiêu là TRÙNG THẬT —
 *      tức học sinh đã có sổ ở đúng lớp đó rồi nhưng termStart khác nên
 *      tuple key không khớp.
 *   2. Doc id lệch với chính trường dữ liệu của nó còn bao nhiêu, và lệch ở
 *      phần termStart (ảnh hưởng danh tính) hay chỉ termEnd (vô hại).
 *   3. Có create nào trùng doc id đang tồn tại không — `batch.create` sẽ ném
 *      lỗi và cả chunk 100 sổ bị hủy.
 */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { planClassLedgers } from '../server/api/lib/accounting/courseLedgerPlanner.js';
import { readStoredStudentCourseEnrollment } from '../server/api/lib/student/courseEnrollmentRepository.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  databaseId
);

const [classSnap, enrollSnap, ledgerSnap, studentSnap] = await Promise.all([
  db.collection('classes').get(),
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
  db.collection('students').get(),
]);

const nameById = new Map(studentSnap.docs.map((d) => [d.id, String(d.data()?.name || '')]));
const classNameById = new Map(classSnap.docs.map((d) => [d.id, String(d.data()?.name || '')]));

// ---- 2. doc id có nói đúng về chính nó không? -------------------------------
const idDrift = { termStartDrift: [] as any[], termEndOnlyDrift: 0, unparseable: 0 };
for (const d of ledgerSnap.docs) {
  const row = d.data() || {};
  const sid = String(row.studentId || '');
  const cid = String(row.classId || '');
  const prefix = `${sid}_${cid}_`;
  if (!sid || !cid || !d.id.startsWith(prefix)) {
    idDrift.unparseable += 1;
    continue;
  }
  const rest = d.id.slice(prefix.length); // "<termStart>_<termEnd>"
  const cut = rest.indexOf('_');
  const idStart = cut < 0 ? rest : rest.slice(0, cut);
  const idEnd = cut < 0 ? '' : rest.slice(cut + 1);
  const fStart = String(row.termStart || '');
  const fEnd = String(row.termEnd || '');
  if (idStart !== fStart) {
    idDrift.termStartDrift.push({
      id: d.id,
      student: nameById.get(sid) || '(không hồ sơ)',
      class: classNameById.get(cid) || cid,
      idSaysStart: idStart,
      fieldSaysStart: fStart,
      paidTotal: Number(row.paidTotal || 0),
    });
  } else if (idEnd !== fEnd) {
    idDrift.termEndOnlyDrift += 1;
  }
}

// ---- 1 & 3. planner sẽ tạo gì ----------------------------------------------
const enrollByClass = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  let e: any;
  try {
    e = readStoredStudentCourseEnrollment(d as never);
  } catch {
    continue; // production cũng bỏ qua, có ghi vào errors
  }
  const bucket = enrollByClass.get(e.classId);
  if (bucket) bucket.push(e);
  else enrollByClass.set(e.classId, [e]);
}

const ledgersByClass = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const cid = String(d.data()?.classId || '');
  const row = { id: d.id, studentId: d.data()?.studentId, termStart: d.data()?.termStart };
  const bucket = ledgersByClass.get(cid);
  if (bucket) bucket.push(row);
  else ledgersByClass.set(cid, [row]);
}

const existingIds = new Set(ledgerSnap.docs.map((d) => d.id));
const genuineCreates: any[] = [];
const duplicateRiskCreates: any[] = [];
const idCollisions: any[] = [];
let plannedAmount = 0;

for (const c of classSnap.docs) {
  const classId = c.id;
  const plan = planClassLedgers({
    classId,
    classData: (c.data() || {}) as Record<string, unknown>,
    enrollments: enrollByClass.get(classId) || [],
    ledgers: ledgersByClass.get(classId) || [],
  });
  if (plan.skipReason) continue;

  const ledgersHere = ledgersByClass.get(classId) || [];
  for (const create of plan.creates) {
    plannedAmount += create.amount;
    if (existingIds.has(create.ledgerId)) {
      idCollisions.push({ ledgerId: create.ledgerId, class: plan.className });
    }
    // Học sinh này đã có sổ nào ở lớp này chưa? Nếu có, tuple không khớp chỉ vì
    // termStart khác — đó là nợ tính hai lần cho cùng một khóa.
    const priorForStudent = ledgersHere.filter((l) => l.studentId === create.studentId);
    const row = {
      student: nameById.get(create.studentId) || '(không hồ sơ)',
      studentId: create.studentId,
      class: plan.className,
      newTermStart: create.termStart,
      amount: create.amount,
      existingTermStarts: priorForStudent.map((l) => String(l.termStart || '')),
    };
    if (priorForStudent.length > 0) duplicateRiskCreates.push(row);
    else genuineCreates.push(row);
  }
}

console.log(
  JSON.stringify(
    {
      tongQuan: {
        ledgers: ledgerSnap.size,
        enrollments: enrollSnap.size,
        classes: classSnap.size,
      },
      lanBamKeTiep: {
        seTao: genuineCreates.length + duplicateRiskCreates.length,
        tongTien: plannedAmount,
        trungThat_hocSinhDaCoSoOLopNay: duplicateRiskCreates.length,
        moiThatSu_chuaCoSoNao: genuineCreates.length,
        vaChamDocId: idCollisions.length,
      },
      docIdLech: {
        lechPhanTermStart_anhHuongDanhTinh: idDrift.termStartDrift.length,
        lechChiPhanTermEnd_voHai: idDrift.termEndOnlyDrift,
        khongDocDuocId: idDrift.unparseable,
      },
      viDu_trungThat: duplicateRiskCreates.slice(0, 15),
      viDu_lechTermStart: idDrift.termStartDrift.slice(0, 15),
      viDu_moiThatSu: genuineCreates.slice(0, 5),
    },
    null,
    2
  )
);
