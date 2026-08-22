/**
 * Dry run only:
 * npx tsx scripts/audit-attendance-session-eligibility.ts \
 *   --output scratch/attendance-session-eligibility-audit.json
 *
 * This script performs DocumentStore reads and one local JSON write. It never mutates DocumentStore.
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import { getScheduledClassDatesInRange } from '../shared/classSchedule.js';
import { isApiDateOnly } from '../shared/dateTimeFormat.js';
import { readCourseJoins, readLeavePeriods } from '../shared/studentEnrollmentWindows.js';
import { buildClassTerms } from '../shared/studentEnrollmentTimeline.js';
import { createEligibilityResolver } from '../shared/studentSessionEligibility.js';
import type { StudentCourseEnrollment } from '../shared/studentCourseEnrollment.js';
import type { AttendanceRecord } from '../shared/studentAttendanceReport.js';
import { readStoredStudentCourseEnrollment } from '../server/api/lib/student/courseEnrollmentRepository.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type AttendanceEligibilityAuditManifest = {
  generatedAt: string;
  target: AttendanceEligibilityAuditTarget;
  writeCount: 0;
  malformedEnrollments: Array<{
    enrollmentId: string;
    studentId: string;
    error: string;
    rawValue: unknown;
  }>;
  malformedCourseJoins: Array<{ studentId: string; rawValue: unknown }>;
  malformedLeavePeriods: Array<{ studentId: string; rawValue: unknown }>;
  missingCourseEvidence: Array<{ studentId: string; classId: string; termStart: string }>;
  returnBoundarySessions: Array<{
    studentId: string;
    classId: string;
    date: string;
    attendanceStatus: string | null;
  }>;
  realAttendanceAgainstIneligibility: Array<{
    studentId: string;
    classId: string;
    date: string;
    eligibility: 'not_enrolled' | 'on_leave';
    attendanceStatus: string;
  }>;
};

export type AttendanceEligibilityAuditInput = {
  students: Array<Record<string, unknown> & { id: string }>;
  enrollments: StudentCourseEnrollment[];
  attendance: Array<AttendanceRecord & { studentId: string }>;
  scheduledSessions: Array<{ classId: string; date: string }>;
  terms: Array<{ classId: string; termStart: string; termEnd: string }>;
  malformedEnrollments?: AttendanceEligibilityAuditManifest['malformedEnrollments'];
};

export type AttendanceEligibilityAuditTarget = {
  projectId: string;
  databaseId: string;
};

export function classifyAttendanceEligibilityAudit(
  input: AttendanceEligibilityAuditInput,
  generatedAt: string,
  target: AttendanceEligibilityAuditTarget = {
    projectId: 'unspecified',
    databaseId: 'unspecified',
  }
): AttendanceEligibilityAuditManifest {
  const realAttendance = input.attendance.filter(
    (row) =>
      row.isVoided !== true &&
      (row.status === 'present' || row.status === 'absent' || row.status === 'late')
  );
  const attendanceByStudentDate = new Map(
    realAttendance.map((row) => [`${row.studentId}|${row.classId}|${row.date}`, row])
  );
  const returnBoundarySessions: AttendanceEligibilityAuditManifest['returnBoundarySessions'] = [];
  const realAttendanceAgainstIneligibility:
    AttendanceEligibilityAuditManifest['realAttendanceAgainstIneligibility'] = [];
  const malformedCourseJoins: AttendanceEligibilityAuditManifest['malformedCourseJoins'] = [];
  const malformedLeavePeriods: AttendanceEligibilityAuditManifest['malformedLeavePeriods'] = [];
  const missingCourseEvidence: AttendanceEligibilityAuditManifest['missingCourseEvidence'] = [];

  for (const student of input.students) {
    const studentId = student.id;
    const courseJoins = readCourseJoins(student.courseJoins);
    const leavePeriods = readLeavePeriods(student.leavePeriods);
    if (
      student.courseJoins !== undefined &&
      (!Array.isArray(student.courseJoins) || courseJoins.length !== student.courseJoins.length)
    ) {
      malformedCourseJoins.push({ studentId, rawValue: student.courseJoins });
    }
    if (
      student.leavePeriods !== undefined &&
      (!Array.isArray(student.leavePeriods) || leavePeriods.length !== student.leavePeriods.length)
    ) {
      malformedLeavePeriods.push({ studentId, rawValue: student.leavePeriods });
    }

    const canonicalCourseEnrollments = input.enrollments
      .filter((row) => row.studentId === studentId)
      .map(({ classId, termStart, joinedAt, endedAt }) => ({
        classId,
        termStart,
        joinedAt: joinedAt.slice(0, 10),
        endedAt: endedAt?.slice(0, 10) ?? null,
      }));
    const enrollmentDate = readAuditDate(student.enrollmentDate);
    const resolveTermStart = (classId: string, date: string) =>
      input.terms.find(
        (term) =>
          term.classId === classId && date >= term.termStart && date <= term.termEnd
      )?.termStart ?? null;
    const resolveEligibility = createEligibilityResolver({
      canonicalCourseEnrollments,
      courseJoins,
      leavePeriods,
      enrollmentDate,
      resolveTermStart,
    });

    const relevantClassIds = new Set([
      String(student.classId || ''),
      ...courseJoins.map((row) => row.classId),
      ...canonicalCourseEnrollments.map((row) => row.classId),
    ]);
    for (const term of input.terms.filter((row) => relevantClassIds.has(row.classId))) {
      const hasExactEvidence = [...canonicalCourseEnrollments, ...courseJoins].some(
        (row) => row.classId === term.classId && row.termStart === term.termStart
      );
      if (!hasExactEvidence && !enrollmentDate) {
        missingCourseEvidence.push({ studentId, classId: term.classId, termStart: term.termStart });
      }
    }

    for (const period of leavePeriods.filter((row) => row.until !== null)) {
      const date = period.until as string;
      if (!input.scheduledSessions.some((row) => row.classId === period.classId && row.date === date)) {
        continue;
      }
      const attendance = attendanceByStudentDate.get(`${studentId}|${period.classId}|${date}`);
      returnBoundarySessions.push({
        studentId,
        classId: period.classId,
        date,
        attendanceStatus: attendance?.status ?? null,
      });
    }

    for (const attendance of realAttendance.filter((row) => row.studentId === studentId)) {
      const eligibility = resolveEligibility(attendance.date, attendance.classId);
      if (eligibility === 'eligible') continue;
      realAttendanceAgainstIneligibility.push({
        studentId,
        classId: attendance.classId,
        date: attendance.date,
        eligibility,
        attendanceStatus: attendance.status ?? 'unmarked',
      });
    }
  }

  return {
    generatedAt,
    target,
    writeCount: 0,
    malformedEnrollments: input.malformedEnrollments || [],
    malformedCourseJoins,
    malformedLeavePeriods,
    missingCourseEvidence,
    returnBoundarySessions,
    realAttendanceAgainstIneligibility,
  };
}

function readAuditDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return isApiDateOnly(date) ? date : null;
}

export function parseAttendanceEligibilityAuditArgs(argv: string[]): { outputPath: string } {
  let outputPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--output') {
      outputPath = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (value.startsWith('--output=')) {
      outputPath = value.slice('--output='.length).trim();
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!outputPath) throw new Error('Missing required --output <path>');
  return { outputPath };
}

type StoredRecord = Record<string, unknown> & { id: string };
type StoredClassSession = { classId: string; date: string; status: string };

function snapshotRows(snapshot: {
  docs: Array<{ id: string; data(): Record<string, unknown> }>;
}): StoredRecord[] {
  return snapshot.docs.map((doc) => ({ ...(doc.data() || {}), id: doc.id }));
}

function buildAuditCalendar(
  classes: StoredRecord[],
  classSessions: StoredClassSession[],
  systemHolidays: string[]
): Pick<AttendanceEligibilityAuditInput, 'terms' | 'scheduledSessions'> {
  const terms: AttendanceEligibilityAuditInput['terms'] = [];
  const scheduledSessionKeys = new Set<string>();
  const cancelled = new Set(
    classSessions
      .filter((session) => session.status === 'cancelled')
      .map((session) => `${session.classId}|${session.date}`)
  );

  for (const classData of classes) {
    for (const term of buildClassTerms({ id: classData.id, ...classData })) {
      if (!term.startDate || !term.endDate) continue;
      terms.push({
        classId: classData.id,
        termStart: term.startDate,
        termEnd: term.endDate,
      });
      if (!term.schedule) continue;

      const daysOfWeek = term.schedule.weeklySessions.length
        ? term.schedule.weeklySessions
            .map((session) => Number((session as { dayOfWeek?: unknown }).dayOfWeek))
            .filter(Number.isFinite)
        : term.schedule.daysOfWeek;
      const holidays = new Set([...term.schedule.holidays, ...systemHolidays]);
      for (const date of getScheduledClassDatesInRange(
        {
          startDate: term.startDate,
          endDate: term.endDate,
          daysOfWeek,
          weeklySessions: term.schedule.weeklySessions,
        },
        term.startDate,
        term.endDate
      )) {
        const key = `${classData.id}|${date}`;
        if (!holidays.has(date) && !cancelled.has(key)) scheduledSessionKeys.add(key);
      }

      for (const session of classSessions) {
        if (
          session.classId === classData.id &&
          session.status === 'makeup' &&
          session.date >= term.startDate &&
          session.date <= term.endDate &&
          !holidays.has(session.date)
        ) {
          scheduledSessionKeys.add(`${session.classId}|${session.date}`);
        }
      }
    }
  }

  return {
    terms: [...new Map(terms.map((term) => [`${term.classId}|${term.termStart}`, term])).values()]
      .sort((left, right) =>
        left.classId.localeCompare(right.classId) || left.termStart.localeCompare(right.termStart)
      ),
    scheduledSessions: [...scheduledSessionKeys]
      .sort()
      .map((key) => {
        const separator = key.indexOf('|');
        return { classId: key.slice(0, separator), date: key.slice(separator + 1) };
      }),
  };
}

export async function loadAttendanceEligibilityAuditInput(
  db: DocumentStore
): Promise<AttendanceEligibilityAuditInput> {
  const [studentsSnap, enrollmentsSnap, attendanceSnap, classesSnap, sessionsSnap, holidaysSnap] =
    await Promise.all([
      db.collection('students').get(),
      db.collection('student_course_enrollments').get(),
      db.collection('attendance').get(),
      db.collection('classes').get(),
      db.collection('class_sessions').get(),
      db.collection('system_settings').doc('holidays').get(),
    ]);

  const students = snapshotRows(studentsSnap) as AttendanceEligibilityAuditInput['students'];
  const enrollments: StudentCourseEnrollment[] = [];
  const malformedEnrollments: AttendanceEligibilityAuditManifest['malformedEnrollments'] = [];
  for (const doc of enrollmentsSnap.docs) {
    try {
      enrollments.push(readStoredStudentCourseEnrollment(doc));
    } catch (error) {
      const rawValue = doc.data() || {};
      malformedEnrollments.push({
        enrollmentId: doc.id,
        studentId: String(rawValue.studentId || ''),
        error: error instanceof Error ? error.message : String(error),
        rawValue,
      });
    }
  }
  const attendance = snapshotRows(attendanceSnap) as unknown as Array<
    AttendanceRecord & { studentId: string }
  >;
  const classes = snapshotRows(classesSnap);
  const classSessions = snapshotRows(sessionsSnap).map((session) => ({
    classId: String(session.classId || ''),
    date: String(session.date || ''),
    status: String(session.status || ''),
  }));
  const systemHolidays =
    holidaysSnap.exists && Array.isArray(holidaysSnap.data()?.dates)
      ? (holidaysSnap.data()?.dates as unknown[]).map(String).filter(isApiDateOnly)
      : [];
  const calendar = buildAuditCalendar(classes, classSessions, systemHolidays);

  return { students, enrollments, attendance, malformedEnrollments, ...calendar };
}

export async function runAttendanceEligibilityAudit(input: {
  db: DocumentStore;
  generatedAt: string;
  outputPath: string;
  target: AttendanceEligibilityAuditTarget;
  writeText?: (outputPath: string, contents: string) => Promise<void>;
}): Promise<AttendanceEligibilityAuditManifest> {
  const auditInput = await loadAttendanceEligibilityAuditInput(input.db);
  const manifest = classifyAttendanceEligibilityAudit(
    auditInput,
    input.generatedAt,
    input.target
  );
  const writeText = input.writeText ?? ((outputPath, contents) => writeFile(outputPath, contents));
  await writeText(input.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function resolveAttendanceEligibilityAuditTarget(
  env: Record<string, string | undefined>
): AttendanceEligibilityAuditTarget {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new Error('Missing required environment variable: FIREBASE_PROJECT_ID');
  const databaseId = env.FIRESTORE_DATABASE_ID?.trim();
  if (!databaseId) {
    throw new Error('Missing required environment variable: FIRESTORE_DATABASE_ID');
  }
  return { projectId, databaseId };
}

function normalizePrivateKey(value: string): string {
  const unquoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;
  return unquoted.replace(/\\n/g, '\n');
}

function initFirebase(target: AttendanceEligibilityAuditTarget): App {
  if (getApps().length > 0) {
    const app = getApps()[0];
    const existingProjectId = app.options.projectId;
    if (existingProjectId && existingProjectId !== target.projectId) {
      throw new Error(
        `Firebase app project mismatch: expected ${target.projectId}, got ${existingProjectId}`
      );
    }
    return app;
  }
  const serviceAccountPath = path.join(projectRoot, 'service-account-key.json');
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as ServiceAccount & {
      project_id?: string;
    };
    const serviceAccountProjectId = serviceAccount.projectId || serviceAccount.project_id;
    if (serviceAccountProjectId !== target.projectId) {
      throw new Error(
        `Service account project mismatch: expected ${target.projectId}, got ${String(serviceAccountProjectId || '')}`
      );
    }
    return initializeApp({
      projectId: target.projectId,
      credential: cert(serviceAccount),
    });
  }
  return initializeApp({
    projectId: target.projectId,
    credential: cert({
      projectId: target.projectId,
      clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: normalizePrivateKey(requiredEnv('FIREBASE_PRIVATE_KEY')),
    }),
  });
}

async function main() {
  const { outputPath } = parseAttendanceEligibilityAuditArgs(process.argv.slice(2));
  loadLocalEnv();
  const target = resolveAttendanceEligibilityAuditTarget(process.env);
  const manifest = await runAttendanceEligibilityAudit({
    db: getDocumentStore(initFirebase(target), target.databaseId),
    generatedAt: new Date().toISOString(),
    outputPath,
    target,
  });
  console.log(
    JSON.stringify(
      {
        outputPath,
        target: manifest.target,
        writeCount: manifest.writeCount,
        counts: {
          malformedEnrollments: manifest.malformedEnrollments.length,
          malformedCourseJoins: manifest.malformedCourseJoins.length,
          malformedLeavePeriods: manifest.malformedLeavePeriods.length,
          missingCourseEvidence: manifest.missingCourseEvidence.length,
          returnBoundarySessions: manifest.returnBoundarySessions.length,
          realAttendanceAgainstIneligibility:
            manifest.realAttendanceAgainstIneligibility.length,
        },
      },
      null,
      2
    )
  );
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
