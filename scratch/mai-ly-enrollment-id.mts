/** READ-ONLY: validator đọc trường `data.id` bên trong document, không phải doc id.
 * Kiểm tra xem đó có phải chỗ lệch không, và lớp G6-Quỳnh giờ ra sao. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';

const SID = 'b9C4QhZ1h7qQEFp8ChId';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const enrolls = await db.collection('student_course_enrollments').where('studentId', '==', SID).get();
const rows = [];
for (const d of enrolls.docs) {
  const e = d.data() as any;
  const expected = makeStudentCourseEnrollmentId(String(e.studentId), String(e.classId), String(e.termStart));
  const cls = await db.collection('classes').doc(String(e.classId)).get();
  const c = cls.data() as any;
  rows.push({
    docId: d.id,
    idFieldInsideDoc: e.id ?? '(KHÔNG CÓ TRƯỜNG id)',
    expectedId: expected,
    docIdMatches: d.id === expected,
    idFieldMatches: String(e.id || '') === expected,
    class: c?.name,
    classStatus: c?.status,
    classEndDate: c?.endDate ?? null,
    tuitionFee: c?.tuitionFee,
    enrollmentStatus: e.status,
    termStart: e.termStart,
    termEnd: e.termEnd,
    source: e.source,
    confidence: e.confidence,
  });
}
console.log(JSON.stringify(rows, null, 2));
