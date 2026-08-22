/**
 * Sửa những enrollment mà trường `id` bên trong document còn nêu tên một
 * studentId đã nghỉ hưu, khiến `parseStudentCourseEnrollment` ném
 * "enrollment identity does not match its tuple" và chặn việc dựng lại summary.
 *
 * Chỉ ghi đúng một trường, và chỉ khi doc id đã đúng bộ ba của chính nó — tức
 * là danh tính thật nằm ở doc id, còn trường `id` mới là cái lạc hậu. Trường
 * hợp ngược lại (doc id sai) không được đụng tới: nó cần dời document, không
 * phải sửa một trường.
 *
 * Dry run mặc định. `--apply` mới ghi.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';

const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const manifestPath = `migration-manifest-fix-enrollment-id-field-${stamp}.json`;

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const snap = await db.collection('student_course_enrollments').get();

const repairs: any[] = [];
const skipped: any[] = [];
for (const d of snap.docs) {
  const e = d.data() as any;
  const expected = makeStudentCourseEnrollmentId(
    String(e.studentId || ''),
    String(e.classId || ''),
    String(e.termStart || '')
  );
  const idField = String(e.id || '');
  if (idField === expected) continue;

  if (d.id !== expected) {
    // Identity is ambiguous here: neither the doc id nor the field agrees with
    // the tuple, so a one-field patch would just pick a winner arbitrarily.
    skipped.push({ docId: d.id, idField, expected, reason: 'doc id cũng không khớp bộ ba' });
    continue;
  }
  repairs.push({ ref: d.ref, docId: d.id, studentId: String(e.studentId), from: idField, to: expected });
}

const manifest = {
  migration: 'fix_enrollment_id_field',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  databaseId,
  scanned: snap.size,
  repairCount: repairs.length,
  skippedCount: skipped.length,
  repairs: repairs.map(({ ref, ...r }) => r),
  skipped,
  summariesRebuilt: 0,
  summariesFailed: [] as string[],
};

if (APPLY && repairs.length) {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  let batch = db.batch();
  let writes = 0;
  for (const r of repairs) {
    batch.update(r.ref, { id: r.to });
    writes += 1;
    if (writes >= 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();

  const { rebuildAccountingStudentSummary } = await import(
    '../server/api/lib/services/accountingStudentSummaryService.js'
  );
  for (const studentId of new Set(repairs.map((r) => r.studentId))) {
    try {
      await rebuildAccountingStudentSummary(db, studentId);
      manifest.summariesRebuilt += 1;
    } catch (error) {
      manifest.summariesFailed.push(
        `${studentId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
