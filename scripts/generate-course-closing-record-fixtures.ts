import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  COURSE_CLOSING_DOCX_MIME,
  type CourseClosingRecord,
} from '../shared/courseClosingRecords.js';
import { renderCourseClosingDocument } from '../server/api/classes/records/courseClosingRecordDocuments.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let outDir = resolve(process.cwd(), 'scratch');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out-dir' && args[i + 1]) {
      outDir = resolve(args[i + 1]);
      i++;
    }
  }
  return { outDir };
}

const sampleRecord: CourseClosingRecord = {
  id: 'course-101__student-202',
  recordVersion: 1,
  closingMonth: '2026-07',
  courseId: 'course-101',
  classId: 'class-55',
  className: 'Lớp Tiếng Anh Giao Tiếp K12',
  classNameNormalized: 'lop tieng anh giao tiep k12',
  courseStartDate: '2026-03-15',
  courseEndDate: '2026-07-15',
  studentId: 'student-202',
  studentName: 'Nguyễn Thị Hoàng Yến',
  studentNameNormalized: 'nguyen thi hoang yen',
  studentCode: 'HV2026-088',
  teacherId: 'teacher-10',
  teacherName: 'Lê Hoàng Nam',
  evaluationSnapshot: {
    evaluationId: 'eval-final-88',
    evaluationVersion: '2026-07-15T15:30:00.000Z',
    evaluationDate: '2026-07-15',
    scores: {
      attendance: 100,
      effort: 90,
      pronunciation: 85,
      homework: 92,
      behavior: 95,
    },
    finalExamScore: 89,
    totalScore: 91,
    classification: 'excellent',
    positivePoints: [
      'Phát âm chuẩn và tự nhiên',
      'Tích cực xây dựng bài',
      'Hoàn thành 100% bài tập về nhà',
    ],
    improvementPoints: 'Cần tự tin hơn khi giao tiếp với người bản xứ',
    midterm: {
      evaluationId: 'eval-mid-44',
      evaluationDate: '2026-05-15',
      examScore: 84,
    },
  },
  tuitionSnapshot: {
    noticeDate: '2026-07-15',
    amount: 3200000,
    paymentWindowStart: '2026-07-15',
    paymentDueDate: '2026-07-29',
    previousCourseStartDate: '2026-03-15',
    previousCourseEndDate: '2026-07-15',
    finalExamDate: '2026-07-15',
    finalExamScore: 89,
    nextCourseStartDate: '2026-08-01',
    nextCourseEndDate: '2026-11-30',
    ledgerId: 'ledger-99',
  },
  evaluationDocument: {
    type: 'evaluation',
    status: 'ready',
    templateVersion: 1,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 1,
  },
  tuitionDocument: {
    type: 'tuition',
    status: 'ready',
    templateVersion: 1,
    mimeType: COURSE_CLOSING_DOCX_MIME,
    attempts: 1,
  },
  createdAt: '2026-07-15T15:30:00.000Z',
  updatedAt: '2026-07-15T15:30:00.000Z',
};

async function main() {
  const { outDir } = parseArgs();
  await mkdir(outDir, { recursive: true });

  const evalBuf = await renderCourseClosingDocument(sampleRecord, 'evaluation');
  const evalPath = resolve(outDir, 'evaluation-v1-fixture.docx');
  await writeFile(evalPath, evalBuf);
  console.log(`Generated evaluation fixture: ${evalPath}`);

  const tuitionBuf = await renderCourseClosingDocument(sampleRecord, 'tuition');
  const tuitionPath = resolve(outDir, 'tuition-v1-fixture.docx');
  await writeFile(tuitionPath, tuitionBuf);
  console.log(`Generated tuition fixture: ${tuitionPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
