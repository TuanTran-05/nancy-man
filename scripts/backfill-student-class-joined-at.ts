import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import {
  FieldPath,
  FieldValue,
  getDocumentStore,
  type DocumentData,
  type DocumentStore,
  type Query,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from '@/server/db/documentStore.js';
import {
  buildClassTerms,
  findTermForDate,
  type ClassLike,
} from '../shared/studentEnrollmentTimeline.js';
import { getScheduledClassDatesInRange, getVietnamTodayStr } from '../shared/classSchedule.js';
import {
  readCourseJoins,
  readLeavePeriods,
  type StudentCourseJoin,
  type StudentLeavePeriod,
} from '../shared/studentEnrollmentWindows.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type BackfillInput = {
  students: { id: string; courseJoins?: unknown }[];
  attendance: { studentId: string; classId: string; date: string; isVoided?: boolean }[];
  classes: ClassLike[];
  /** First scheduled session of a course, or null when unknown. */
  firstScheduledDate: (classId: string, termStart: string) => string | null;
};

export type BackfillPlan = {
  studentId: string;
  joins: StudentCourseJoin[];
};

/**
 * Infer each student's join date per course from their earliest attendance row.
 *
 * Two deliberate conservatisms:
 *  - An existing entry is never overwritten. Written data beats inference.
 *  - A student whose first row IS the course's first session gets no entry.
 *    Writing one would be a no-op at best and, if the class schedule is later
 *    corrected, a spurious not_enrolled band at worst.
 *
 * Known limitation: a student absent on their real first session is inferred
 * one session late. Their sessions before the first attended one show as
 * "not enrolled" rather than "absent". Spec D5 keeps this from destroying data —
 * any session with a real record still renders from that record.
 */
export function planCourseJoinBackfill(input: BackfillInput): BackfillPlan[] {
  const termsByClass = new Map<string, ReturnType<typeof buildClassTerms>>();
  for (const classData of input.classes) {
    termsByClass.set(classData.id, buildClassTerms(classData));
  }

  // studentId -> "classId|termStart" -> earliest attendance date
  const earliest = new Map<string, Map<string, string>>();
  for (const row of input.attendance) {
    // A voided row is a retracted claim. Inferring a join date from one would
    // manufacture a not_enrolled band out of data the office already withdrew.
    if (row.isVoided) continue;
    const terms = termsByClass.get(row.classId);
    if (!terms) continue;
    const term = findTermForDate(terms, row.date);
    if (!term || !term.startDate) continue;

    const key = `${row.classId}|${term.startDate}`;
    const perStudent = earliest.get(row.studentId) ?? new Map<string, string>();
    const current = perStudent.get(key);
    if (current === undefined || row.date < current) perStudent.set(key, row.date);
    earliest.set(row.studentId, perStudent);
  }

  const plans: BackfillPlan[] = [];
  for (const student of input.students) {
    const perStudent = earliest.get(student.id);
    if (!perStudent) continue;

    const already = new Set(
      readCourseJoins(student.courseJoins).map((j) => `${j.classId}|${j.termStart}`)
    );

    const joins: StudentCourseJoin[] = [];
    for (const [key, firstAttended] of perStudent) {
      if (already.has(key)) continue;
      const separator = key.lastIndexOf('|');
      const classId = key.slice(0, separator);
      const termStart = key.slice(separator + 1);

      const courseStart = input.firstScheduledDate(classId, termStart);
      // No usable course start = no evidence. The "were they here from the
      // start?" test cannot run, so writing an entry would be a guess made in
      // exactly the case with the least information behind it. The D3 fallback
      // already handles a missing entry safely; write nothing.
      if (courseStart === null) continue;
      if (firstAttended <= courseStart) continue;

      joins.push({ classId, termStart, joinedAt: firstAttended });
    }

    if (joins.length > 0) {
      joins.sort((a, b) => a.termStart.localeCompare(b.termStart));
      plans.push({ studentId: student.id, joins });
    }
  }

  return plans;
}

/**
 * First session a student could actually have attended.
 *
 * Holidays AND cancelled sessions are excluded. Using the raw generated schedule
 * makes a course whose opening date was later cancelled look like it started
 * earlier — so every student in it appears to have joined late, and the whole
 * roster gets a spurious not_enrolled band.
 */
export function makeFirstScheduledDate(
  classes: ClassLike[],
  cancelledKeys: Set<string> // `${classId}|${date}`
): (classId: string, termStart: string) => string | null {
  const termsByClass = new Map(classes.map((c) => [c.id, buildClassTerms(c)]));
  return (classId, termStart) => {
    const term = (termsByClass.get(classId) ?? []).find((t) => t.startDate === termStart);
    if (!term || !term.endDate) return null; // open-ended course: no known bound, no entry
    const schedule = term.schedule;
    if (!schedule) return null; // pre-snapshot course: no evidence, no entry
    const dates = getScheduledClassDatesInRange(
      { startDate: term.startDate, endDate: term.endDate, ...schedule } as any,
      term.startDate,
      term.endDate
    );
    const holidays = new Set(schedule.holidays ?? []);
    return dates.find((d) => !holidays.has(d) && !cancelledKeys.has(`${classId}|${d}`)) ?? null;
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts a date or a timestamp string; returns '' when unusable. */
function dateText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, 10);
  return ISO_DATE_RE.test(trimmed) ? trimmed : '';
}

/**
 * One open period per currently-on-leave student. `until` is null per D4: they
 * have not returned. The office's planned return date rides along as
 * plannedUntil, which is reference-only and never calculated on.
 */
export function planOpenLeavePeriod(
  student: {
    enrollmentStatus?: unknown;
    statusChangedAt?: unknown;
    leaveUntil?: unknown;
    classId?: unknown;
    leavePeriods?: unknown;
  },
  today: string
): StudentLeavePeriod | null {
  if (student.enrollmentStatus !== 'on_leave') return null;
  // Never a second open period — the student may already have been migrated.
  if (readLeavePeriods(student.leavePeriods).some((p) => p.until === null)) return null;

  const from = dateText(student.statusChangedAt) || today;
  const plannedUntil = dateText(student.leaveUntil) || undefined;
  return {
    from,
    until: null,
    ...(plannedUntil ? { plannedUntil } : {}),
    classId: typeof student.classId === 'string' ? student.classId : '',
  };
}

// ---------------------------------------------------------------------------
// DocumentStore runner
// ---------------------------------------------------------------------------

type Manifest = {
  generatedAt: string;
  mode: 'dry-run' | 'apply';
  counts: {
    studentsScanned: number;
    studentsWithNewJoins: number;
    joinEntriesWritten: number;
    leavePeriodsOpened: number;
    skippedNoCourseStart: number;
    skippedAlreadyRecorded: number;
  };
  students: {
    studentId: string;
    joins: StudentCourseJoin[];
    leavePeriod?: StudentLeavePeriod;
  }[];
};

async function readAllDocuments(query: Query<DocumentData>, pageSize = 500) {
  const documents: QueryDocumentSnapshot<DocumentData>[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;

  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    documents.push(...snapshot.docs);
    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }

  return documents;
}

export async function backfillStudentCourseJoins({
  db,
  apply,
  maxBatchWrites = 450,
  today = getVietnamTodayStr(),
  log = console.log,
}: {
  db: DocumentStore;
  apply: boolean;
  maxBatchWrites?: number;
  today?: string;
  log?: (message: string) => void;
}): Promise<Manifest> {
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 450) {
    throw new Error('maxBatchWrites must be an integer between 1 and 450');
  }

  const [studentDocs, classDocs, attendanceDocs, cancelledSessionDocs] = await Promise.all([
    readAllDocuments(db.collection('students')),
    readAllDocuments(db.collection('classes')),
    readAllDocuments(db.collection('attendance')),
    readAllDocuments(db.collection('class_sessions').where('status', '==', 'cancelled')),
  ]);

  const classes: ClassLike[] = classDocs.map((doc) => ({ id: doc.id, ...doc.data() }) as ClassLike);
  const students = studentDocs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const attendance = attendanceDocs.map((doc) => {
    const d = doc.data();
    return {
      studentId: String(d.studentId || ''),
      classId: String(d.classId || ''),
      date: String(d.date || ''),
      isVoided: d.isVoided === true,
    };
  });

  const cancelledKeys = new Set<string>();
  for (const doc of cancelledSessionDocs) {
    const d = doc.data();
    const cid = String(d.classId || '');
    const date = String(d.date || '');
    if (cid && date) cancelledKeys.add(`${cid}|${date}`);
  }

  const firstScheduledDate = makeFirstScheduledDate(classes, cancelledKeys);
  const joinPlans = planCourseJoinBackfill({
    students: students.map((s) => ({ id: s.id, courseJoins: (s as any).courseJoins })),
    attendance,
    classes,
    firstScheduledDate,
  });
  const joinPlanByStudentId = new Map(joinPlans.map((p) => [p.studentId, p.joins]));

  const manifestStudents: Manifest['students'] = [];
  let joinEntriesWritten = 0;
  let leavePeriodsOpened = 0;

  for (const student of students) {
    const joins = joinPlanByStudentId.get(student.id) ?? [];
    const leavePeriod = planOpenLeavePeriod(student as any, today);

    if (joins.length === 0 && !leavePeriod) continue;

    if (joins.length > 0) joinEntriesWritten += joins.length;
    if (leavePeriod) leavePeriodsOpened += 1;

    manifestStudents.push({
      studentId: student.id,
      joins,
      ...(leavePeriod ? { leavePeriod } : {}),
    });
  }

  // Conservative-skip accounting, for the user to sanity-check the run.
  let skippedNoCourseStart = 0;
  let skippedAlreadyRecorded = 0;
  {
    const termsByClass = new Map(classes.map((c) => [c.id, buildClassTerms(c)]));
    const earliestByStudent = new Map<string, Map<string, string>>();
    for (const row of attendance) {
      if (row.isVoided) continue;
      const terms = termsByClass.get(row.classId);
      if (!terms) continue;
      const term = findTermForDate(terms, row.date);
      if (!term || !term.startDate) continue;
      const key = `${row.classId}|${term.startDate}`;
      const perStudent = earliestByStudent.get(row.studentId) ?? new Map<string, string>();
      const current = perStudent.get(key);
      if (current === undefined || row.date < current) perStudent.set(key, row.date);
      earliestByStudent.set(row.studentId, perStudent);
    }
    for (const student of students) {
      const perStudent = earliestByStudent.get(student.id);
      if (!perStudent) continue;
      const already = new Set(
        readCourseJoins((student as any).courseJoins).map((j) => `${j.classId}|${j.termStart}`)
      );
      for (const [key, firstAttended] of perStudent) {
        if (already.has(key)) {
          skippedAlreadyRecorded += 1;
          continue;
        }
        const separator = key.lastIndexOf('|');
        const classId = key.slice(0, separator);
        const termStart = key.slice(separator + 1);
        const courseStart = firstScheduledDate(classId, termStart);
        if (courseStart === null) {
          skippedNoCourseStart += 1;
          continue;
        }
        if (firstAttended <= courseStart) skippedAlreadyRecorded += 1;
      }
    }
  }

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    counts: {
      studentsScanned: students.length,
      studentsWithNewJoins: joinPlans.length,
      joinEntriesWritten,
      leavePeriodsOpened,
      skippedNoCourseStart,
      skippedAlreadyRecorded,
    },
    students: manifestStudents,
  };

  if (apply) {
    let batch: WriteBatch = db.batch();
    let batchWrites = 0;
    for (const entry of manifestStudents) {
      const student = students.find((s) => s.id === entry.studentId);
      if (!student) continue;

      // FieldValue.arrayUnion, not a read-modify-write from the initial scan.
      // `students`/`student` above are a snapshot taken at the START of this
      // run; for a large roster the apply phase can run long after that scan,
      // and a transfer or status change landing on this student in between
      // would be silently overwritten by a plain array write computed from the
      // stale snapshot. arrayUnion is atomic at the DocumentStore level — it reads
      // and appends server-side, so a concurrent write can never be clobbered.
      const update: Record<string, unknown> = {};
      if (entry.joins.length > 0) {
        update.courseJoins = FieldValue.arrayUnion(...entry.joins);
      }
      if (entry.leavePeriod) {
        update.leavePeriods = FieldValue.arrayUnion(entry.leavePeriod);
      }

      batch.update(db.collection('students').doc(entry.studentId), update);
      batchWrites += 1;
      if (batchWrites >= maxBatchWrites) {
        await batch.commit();
        batch = db.batch();
        batchWrites = 0;
      }
    }
    if (batchWrites > 0) await batch.commit();
  }

  const manifestPath = path.join(
    projectRoot,
    `migration-manifest-student-course-joins-${manifest.generatedAt.replace(/[:.]/g, '-')}.json`
  );
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  log(
    JSON.stringify(
      { ...manifest, students: process.argv.includes('--verbose') ? manifest.students : undefined },
      null,
      2
    )
  );
  log(`Manifest written to ${manifestPath}`);

  return manifest;
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
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
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function initFirebase(): App {
  if (getApps().length) return getApps()[0];
  const servicePath = path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    return initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
  }
  return initializeApp({
    credential: cert({
      projectId: requiredEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: normalizePrivateKey(requiredEnv('FIREBASE_PRIVATE_KEY')),
    }),
  });
}

async function main() {
  loadLocalEnv();
  const app = initFirebase();
  await backfillStudentCourseJoins({
    db: getDocumentStore(app, requiredEnv('FIRESTORE_DATABASE_ID')),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
