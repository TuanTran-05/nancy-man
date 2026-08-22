/** READ-ONLY: sổ trùng dạng khó — cùng học sinh, cùng lớp, ngày term KHÁC nhau
 * nhưng CHỒNG LẤN nhau.
 *
 * Khóa liên tiếp thì không chồng lấn: khóa trước kết thúc rồi khóa sau mới bắt
 * đầu. Hai sổ mô tả hai giai đoạn trùng nhau của cùng một lớp thì chỉ có thể là
 * cùng một khóa bị ghi hai lần với ngày term đã bị sửa. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const [ledgerSnap, studentsSnap, classesSnap, enrollSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('students').get(),
  db.collection('classes').get(),
  db.collection('student_course_enrollments').get(),
]);
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const className = (id: string) =>
  String((classesSnap.docs.find((d) => d.id === id)?.data() as any)?.name || id);
const enrollTerms = new Map<string, Set<string>>();
for (const d of enrollSnap.docs) {
  const e = d.data() as any;
  const k = `${e.studentId}|${e.classId}`;
  if (!enrollTerms.has(k)) enrollTerms.set(k, new Set());
  enrollTerms.get(k)!.add(String(e.termStart || ''));
}

const byPair = new Map<string, any[]>();
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ...(d.data() as any) };
  const k = `${l.studentId}|${l.classId}`;
  if (!byPair.has(k)) byPair.set(k, []);
  byPair.get(k)!.push(l);
}

const overlaps: any[] = [];
for (const [pair, rows] of byPair) {
  if (rows.length < 2) continue;
  const [studentId, classId] = pair.split('|');
  const terms = enrollTerms.get(pair) || new Set();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const aS = String(a.termStart || ''), aE = String(a.termEnd || '');
      const bS = String(b.termStart || ''), bE = String(b.termEnd || '');
      if (!aS || !bS || !aE || !bE) continue;
      if (aS <= bE && bS <= aE) {
        overlaps.push({
          student: studentById.get(studentId)?.name || '(không có hồ sơ)',
          studentId,
          class: className(classId),
          enrollmentTermStarts: [...terms],
          a: { id: a.id, term: `${aS}→${aE}`, amount: m(a.amount), paid: m(a.paidTotal), matchesEnrollment: terms.has(aS) },
          b: { id: b.id, term: `${bS}→${bE}`, amount: m(b.amount), paid: m(b.paidTotal), matchesEnrollment: terms.has(bS) },
          bothHaveMoney: m(a.paidTotal) > 0 && m(b.paidTotal) > 0,
          phantomBilled: Math.min(m(a.amount), m(b.amount)),
        });
      }
    }
  }
}

console.log(JSON.stringify({
  overlappingPairs: overlaps.length,
  bothHaveMoney: overlaps.filter((o) => o.bothHaveMoney).length,
  phantomBilledTotal: overlaps.reduce((s, o) => s + o.phantomBilled, 0),
  detail: overlaps,
}, null, 2));
