import type {
  DocumentSnapshot,
  DocumentStore,
  QueryDocumentSnapshot,
  Transaction,
} from '@/server/db/documentStore.js';

export const COURSE_TERM_ROSTER_STATUSES = [
  'trial',
  'active',
  'on_leave',
  'completed',
] as const;

const COURSE_TERM_ROSTER_STATUS_SET = new Set<string>(COURSE_TERM_ROSTER_STATUSES);

export type CourseTermRosterScope = { classId: string; termStart?: string };

export type CourseTermRosterMember = {
  studentDoc: DocumentSnapshot;
  enrollmentDoc: QueryDocumentSnapshot | null;
  source: 'enrollment' | 'legacy_profile';
};

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readTarget<T>(target: { get: () => Promise<T> }, transaction?: Transaction) {
  return transaction ? ((await transaction.get(target as never)) as T) : target.get();
}

function normalizeCourseTermStart(value: string | undefined): string | undefined {
  const text = value?.trim();
  const match = text?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? text
    : undefined;
}

export async function loadCourseTermRosters(
  db: DocumentStore,
  scopes: CourseTermRosterScope[],
  options: { transaction?: Transaction } = {}
): Promise<Map<string, CourseTermRosterMember[]>> {
  const normalized = [...new Map(
    scopes
      .filter((scope) => scope.classId.trim())
      .map((scope) => [scope.classId, { classId: scope.classId, termStart: normalizeCourseTermStart(scope.termStart) }])
  ).values()];
  const result = new Map(normalized.map((scope) => [scope.classId, [] as CourseTermRosterMember[]]));
  const enrollmentScopes = normalized.filter((scope) => scope.termStart);
  const scopeByClass = new Map(enrollmentScopes.map((scope) => [scope.classId, scope]));
  const enrollmentDocs: QueryDocumentSnapshot[] = [];

  for (const classIds of chunks(enrollmentScopes.map((scope) => scope.classId), 30)) {
    const query = db.collection('student_course_enrollments').where('classId', 'in', classIds);
    const snapshot = await readTarget(query, options.transaction);
    enrollmentDocs.push(...snapshot.docs);
  }

  const selected = enrollmentDocs.filter((doc) => {
    const data = doc.data() || {};
    const scope = scopeByClass.get(String(data.classId || ''));
    return Boolean(
      scope &&
        String(data.termStart || '') === scope.termStart &&
        COURSE_TERM_ROSTER_STATUS_SET.has(String(data.status || ''))
    );
  });

  const profileIds = [
    ...new Set(selected.map((doc) => String(doc.data()?.studentId || '')).filter(Boolean)),
  ];
  const profileEntries = await Promise.all(
    profileIds.map(async (studentId) => [
      studentId,
      await readTarget(db.collection('students').doc(studentId), options.transaction),
    ] as const)
  );
  const profileById = new Map(profileEntries);
  const seenByClass = new Map<string, Set<string>>();

  for (const enrollmentDoc of selected) {
    const data = enrollmentDoc.data() || {};
    const classId = String(data.classId || '');
    const studentId = String(data.studentId || '');
    const studentDoc = profileById.get(studentId);
    if (!studentDoc?.exists) {
      console.warn('[course-term-roster-missing-profile]', {
        classId,
        termStart: String(data.termStart || ''),
        enrollmentId: enrollmentDoc.id,
        studentId,
      });
      continue;
    }
    const seen = seenByClass.get(classId) || new Set<string>();
    if (seen.has(studentId)) continue;
    seen.add(studentId);
    seenByClass.set(classId, seen);
    result.get(classId)?.push({ studentDoc, enrollmentDoc, source: 'enrollment' });
  }

  const legacyClassIds = normalized
    .filter((item) => !item.termStart)
    .map((item) => item.classId);

  for (const classIds of chunks(legacyClassIds, 30)) {
    const query = db.collection('students').where('classId', 'in', classIds);
    const snapshot = await readTarget(query, options.transaction);
    for (const studentDoc of snapshot.docs) {
      const classId = String(studentDoc.data()?.classId || '');
      const list = result.get(classId);
      if (list && !list.some((member) => member.studentDoc.id === studentDoc.id)) {
        list.push({
          studentDoc,
          enrollmentDoc: null,
          source: 'legacy_profile' as const,
        });
      }
    }
  }

  for (const members of result.values()) {
    members.sort((left, right) => left.studentDoc.id.localeCompare(right.studentDoc.id));
  }
  return result;
}
