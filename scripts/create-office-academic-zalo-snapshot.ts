import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import {
  isCurrentAcademicCourseRecord,
  isCurrentAcademicStudent,
  isRequiredAcademicEvaluationStudent,
  selectFinalEvaluation,
} from '../shared/academic.js';
import {
  getEvaluationRankDiscount,
  getEvaluationRankTemplateLabel,
  isRankedEvaluation,
  normalizeEvaluationRank,
} from '../shared/evaluationRank.js';
import { normalizePhoneVN } from '../shared/phone.js';
import { formatDateForZalo } from '../server/api/lib/zalo/zaloFormat.js';
import { getNextCourseTuitionSchedule } from '../server/api/zalo/helpers/tuitionDates.js';
import {
  createSnapshot,
  verifySnapshot,
  type OfficeAcademicZaloSnapshotPayload,
} from './office-academic-zalo-snapshot.js';

export type DocumentStoreRow = Record<string, unknown> & { id: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function textFromValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join('; ');
  return String(value || '').trim();
}

function limitText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function scoreFromEvaluation(evaluation: DocumentStoreRow): string {
  return String(evaluation.finalScore ?? evaluation.totalScore ?? '');
}

export function buildFrozenPayload(input: {
  classData: DocumentStoreRow;
  students: DocumentStoreRow[];
  evaluations: DocumentStoreRow[];
  createdAt: string;
  resendBy: string;
}): OfficeAcademicZaloSnapshotPayload {
  const { classData } = input;
  const courseStartDate = String(classData.startDate || '');
  const courseEndDate = String(classData.endDate || '');
  const tuitionAmount = Number(classData.tuitionFee || 0);
  if (!courseStartDate || !courseEndDate) throw new Error('Class course dates are required');
  if (!Number.isSafeInteger(tuitionAmount) || tuitionAmount <= 0) {
    throw new Error('Class tuition must be a positive integer');
  }

  const currentStudents = input.students.filter(isCurrentAcademicStudent);
  const currentEvaluations = input.evaluations.filter((evaluation) =>
    isCurrentAcademicCourseRecord(evaluation, classData)
  );
  const byStudent = new Map<string, DocumentStoreRow[]>();
  for (const evaluation of currentEvaluations) {
    const studentId = String(evaluation.studentId || '');
    if (!studentId) continue;
    byStudent.set(studentId, [...(byStudent.get(studentId) || []), evaluation]);
  }
  const schedule = getNextCourseTuitionSchedule(courseEndDate, classData);
  const recipients: OfficeAcademicZaloSnapshotPayload['recipients'] = [];

  for (const student of currentStudents) {
    const evaluation = selectFinalEvaluation(
      (byStudent.get(student.id) || []) as unknown as Parameters<typeof selectFinalEvaluation>[0]
    ) as DocumentStoreRow | null;
    const studentCode = String(student.studentId || student.code || '');
    if (!evaluation) {
      if (isRequiredAcademicEvaluationStudent(student)) {
        throw new Error(`Active student ${studentCode || student.id} has no final evaluation`);
      }
      continue;
    }
    const phone = normalizePhoneVN(String(student.contact || ''));
    if (!/^84(?:3|5|7|8|9)\d{8}$/.test(phone)) {
      throw new Error(`Invalid normalized VN phone for ${studentCode || student.id}`);
    }
    const studentName = String(student.name || '');
    const rank = normalizeEvaluationRank(evaluation.rank);
    recipients.push({
      studentDocId: student.id,
      studentCode,
      studentName,
      phone,
      evaluation: {
        templateData: {
          student_name: studentName,
          student_code: studentCode,
          course_end_date: formatDateForZalo(courseEndDate),
          final_grade: scoreFromEvaluation(evaluation),
          good: limitText(textFromValue(evaluation.positivePoints), 200) || 'Chua co nhan xet',
          bad: limitText(textFromValue(evaluation.improvementPoints), 200) || 'Khong co',
        },
      },
      rank: isRankedEvaluation(rank)
        ? {
            templateData: {
              student_name: studentName,
              student_code: studentCode,
              rank: getEvaluationRankTemplateLabel(rank),
              discount: getEvaluationRankDiscount(rank),
            },
          }
        : null,
      tuition: {
        templateData: {
          student_name: studentName,
          student_code: studentCode,
          previous_end_date: schedule.previousEndDate,
          start_date: schedule.startDate,
          end_date: schedule.endDate,
          amount: tuitionAmount,
          due_date: schedule.dueDate,
        },
      },
    });
  }

  const rankCount = recipients.filter((recipient) => recipient.rank).length;
  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    classId: classData.id,
    className: String(classData.name || ''),
    courseStartDate,
    courseEndDate,
    tuitionAmount,
    resendBy: input.resendBy,
    expectedCounts: { evaluation: recipients.length, rank: rankCount, tuition: recipients.length },
    recipients,
  };
}

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).replace(/^"|"$/g, '');
}

function requiredArg(name: string): string {
  const value = getArg(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function requiredNumberArg(name: string): number {
  const value = Number(requiredArg(name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function loadDotEnv(): void {
  for (const envPath of [path.join(projectRoot, '.env'), path.join(projectRoot, '.vercel/.env.preview.local')]) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    }
  }
}

function initDb() {
  loadDotEnv();
  if (getApps().length === 0) {
    const servicePath = path.join(projectRoot, 'service-account-key.json');
    if (existsSync(servicePath)) {
      initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
    } else {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
  }
  const configPath = path.join(projectRoot, 'firebase-applet-config.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const databaseId = process.env.FIRESTORE_DATABASE_ID || config.documentStoreDatabaseId;
  return databaseId ? getDocumentStore(getApps()[0], databaseId) : getDocumentStore(getApps()[0]);
}

function rows(snapshot: AppDocumentStore.QuerySnapshot): DocumentStoreRow[] {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 2)}***${phone.slice(-3)}`;
}

async function main(): Promise<void> {
  const classId = requiredArg('--class-id');
  const output = path.resolve(projectRoot, requiredArg('--output'));
  const expectedTargetCount = requiredNumberArg('--expected-target-count');
  const expectedRankCount = requiredNumberArg('--expected-rank-count');
  const expectedTuition = requiredNumberArg('--expected-tuition');
  const resendBy = getArg('--by') || 'scheduled-resend-g3-huynh-le-2026-08-05';
  const db = initDb();
  const [classSnap, studentsSnap, evaluationsSnap] = await Promise.all([
    db.collection('classes').doc(classId).get(),
    db.collection('students').where('classId', '==', classId).get(),
    db.collection('evaluations').where('classId', '==', classId).get(),
  ]);
  if (!classSnap.exists) throw new Error(`Class ${classId} not found`);
  const payload = buildFrozenPayload({
    classData: { id: classSnap.id, ...(classSnap.data() || {}) },
    students: rows(studentsSnap),
    evaluations: rows(evaluationsSnap),
    createdAt: new Date().toISOString(),
    resendBy,
  });
  const snapshot = createSnapshot(payload);
  const counts = verifySnapshot(snapshot, {
    classId,
    tuitionAmount: expectedTuition,
    evaluationCount: expectedTargetCount,
    rankCount: expectedRankCount,
    tuitionCount: expectedTargetCount,
  });
  mkdirSync(path.dirname(output), { recursive: true });
  const tempPath = `${output}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(tempPath, output);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
  console.log(JSON.stringify({
    output,
    checksum: snapshot.checksum,
    class: { id: payload.classId, name: payload.className, startDate: payload.courseStartDate, endDate: payload.courseEndDate },
    tuitionAmount: payload.tuitionAmount,
    counts,
    recipients: payload.recipients.map((recipient) => ({ code: recipient.studentCode, phone: maskPhone(recipient.phone), hasRank: Boolean(recipient.rank) })),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
