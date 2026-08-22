/** READ-ONLY: Mai Ly có để lại dấu vết nào ở lớp G6-Quỳnh không? Nếu có điểm
 * danh hay đánh giá thì em ấy có đi học thật, và enrollment phải được đóng lại
 * chứ không phải xóa đi. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const SID = 'b9C4QhZ1h7qQEFp8ChId';
const CLASS = 'XXTe0dcLydenBbhXkIHF';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const out: Record<string, unknown> = {};
for (const name of ['attendance', 'evaluations', 'course_closing_records', 'student_class_history']) {
  try {
    const byStudent = await db.collection(name).where('studentId', '==', SID).get();
    const inClass = byStudent.docs.filter((d) => String((d.data() as any).classId || '') === CLASS);
    out[name] = {
      totalForStudent: byStudent.size,
      inG6Quynh: inClass.length,
      sample: inClass.slice(0, 3).map((d) => ({ id: d.id, ...(d.data() as any) })),
    };
  } catch (error) {
    out[name] = `không đọc được: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// lớp này còn ai khác đang học không, để biết nó có thật hay chỉ là lớp rỗng
const others = await db.collection('student_course_enrollments').where('classId', '==', CLASS).get();
out.classEnrollmentCount = others.size;
out.classEnrollmentStatuses = others.docs.reduce((a: any, d) => {
  const s = String((d.data() as any).status || '?');
  a[s] = (a[s] || 0) + 1;
  return a;
}, {});

console.log(JSON.stringify(out, null, 2));
