import { deriveStudentLifecycle, isCurrentLifecycle } from './studentLifecycle.js';

export type StudentIdentityRecord = {
  id?: string;
  studentId?: string;
  classId?: string;
  studentLifecycle?: string;
  enrollmentStatus?: string;
  isRevoked?: boolean;
  deletedAt?: unknown;
  name?: string;
  dob?: string;
  contact?: string;
};

/**
 * Canonical display form for a student name: uppercase, with internal
 * whitespace collapsed. Diacritics are preserved (unlike normalizeStudentText,
 * which strips them for fuzzy identity matching) since this is what gets
 * stored and shown on rosters, reports, and profiles.
 */
export function formatStudentDisplayName(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeStudentText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeContact(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function enrollmentStatusOf(student: StudentIdentityRecord): string {
  return student.enrollmentStatus || 'active';
}

function currentRecordRank(student: StudentIdentityRecord): number {
  const status = enrollmentStatusOf(student);
  const lifecycle = deriveStudentLifecycle(student);
  if (lifecycle === 'enrolled' && status === 'active') return 0;
  if (lifecycle === 'trial') return 1;
  if (lifecycle === 'enrolled' && status === 'on_leave') return 2;
  if (lifecycle === 'enrolled') return 3;
  if (lifecycle === 'lead') return 4;
  return 5;
}

function shouldReplaceCurrentRecord(
  existing: StudentIdentityRecord,
  candidate: StudentIdentityRecord
): boolean {
  const existingRank = currentRecordRank(existing);
  const candidateRank = currentRecordRank(candidate);
  if (candidateRank !== existingRank) return candidateRank < existingRank;

  const existingId = String(existing.studentId || '');
  const candidateId = String(candidate.studentId || '');
  return Boolean(candidateId && (!existingId || candidateId.localeCompare(existingId) < 0));
}

export function getStudentIdentityKey(student: StudentIdentityRecord): string | null {
  const name = normalizeStudentText(student.name);
  const dob = String(student.dob || '').trim();
  const contact = normalizeContact(student.contact);

  if (name && dob && contact) return `profile:${name}|${dob}|${contact}`;
  if (name && dob) return `profile:${name}|${dob}`;
  return null;
}

export function isHistoricalPromotedStudentRecord(
  student: StudentIdentityRecord,
  activeStudentCodes: ReadonlySet<string>,
  activeStudentIdentityKeys: ReadonlySet<string>
): boolean {
  if (enrollmentStatusOf(student) !== 'promoted') return false;

  const studentId = String(student.studentId || '').trim();
  if (studentId && activeStudentCodes.has(studentId)) return true;

  const identityKey = getStudentIdentityKey(student);
  return Boolean(identityKey && activeStudentIdentityKeys.has(identityKey));
}

/**
 * @deprecated Legacy and anomaly-detection use only. Not an identity source.
 *
 * This collapses physical student rows by guessing: matching student codes and
 * a name/dob/contact key. The guess is wrong in both directions — two cousins
 * sharing a phone number look like one child, and one child whose code was
 * reissued looks like two. Every one of the fifty-nine doubly-owned codes in
 * production was invisible to it, because both rows agreed.
 *
 * Identity now comes from `student_profile_aliases` and the canonical read
 * repository, which record a decision a human made instead of inferring one.
 * These helpers stay because they are still useful for *finding* suspected
 * duplicates, and Workstream D removes them once nothing serves from them.
 */
export function getCurrentStudentRecords<T extends StudentIdentityRecord>(students: T[]): T[] {
  const activeStudents = students.filter(
    (student) => isCurrentLifecycle(student) && enrollmentStatusOf(student) === 'active'
  );
  const activeStudentCodes = new Set(
    activeStudents.map((student) => String(student.studentId || '').trim()).filter(Boolean)
  );
  const activeStudentIdentityKeys = new Set(
    activeStudents.map(getStudentIdentityKey).filter((key): key is string => Boolean(key))
  );

  const withoutHistoricalPromotedRecords = students.filter(
    (student) =>
      !isHistoricalPromotedStudentRecord(student, activeStudentCodes, activeStudentIdentityKeys)
  );
  const selectedByIdentity = new Map<string, T>();

  for (const student of withoutHistoricalPromotedRecords) {
    const identityKey = getStudentIdentityKey(student);
    if (!identityKey) continue;

    const existing = selectedByIdentity.get(identityKey);
    if (!existing || shouldReplaceCurrentRecord(existing, student)) {
      selectedByIdentity.set(identityKey, student);
    }
  }

  return withoutHistoricalPromotedRecords.filter((student) => {
    const identityKey = getStudentIdentityKey(student);
    return !identityKey || selectedByIdentity.get(identityKey) === student;
  });
}

/**
 * The canonical student roster, and the single definition of "total students".
 *
 * `getCurrentStudentRecords` only collapses duplicate identities - it still
 * returns archived, revoked and dropped records. The roster additionally keeps
 * only students who are actually enrolled right now:
 *   - lifecycle is `enrolled` or `trial` (drops archived / revoked / deleted)
 *   - enrollment status is `active` or `on_leave` (drops dropped / promoted)
 *
 * Every surface that reports a headcount must derive it from this function so
 * the admin dashboard and the students directory cannot disagree.
 */
/** @deprecated Legacy-mode only — see {@link getCurrentStudentRecords}. */
export function getCurrentStudentRoster<T extends StudentIdentityRecord>(students: T[]): T[] {
  return getCurrentStudentRecords(students).filter((student) => {
    if (!isCurrentLifecycle(student)) return false;
    const status = enrollmentStatusOf(student);
    return status !== 'dropped' && status !== 'promoted';
  });
}

/** @deprecated Legacy-mode only — see {@link getCurrentStudentRecords}. */
export function getCurrentStudentHeadcount<T extends StudentIdentityRecord>(students: T[]) {
  const roster = getCurrentStudentRoster(students);
  return roster.reduce(
    (counts, student) => {
      const lifecycle = deriveStudentLifecycle(student);
      const status = enrollmentStatusOf(student);
      if (lifecycle === 'trial') counts.trial += 1;
      else if (lifecycle === 'enrolled' && status === 'active') counts.active += 1;
      else if (lifecycle === 'enrolled' && status === 'on_leave') counts.onLeave += 1;
      return counts;
    },
    { total: roster.length, active: 0, trial: 0, onLeave: 0 }
  );
}

export function getCurrentClassStudentRecords<T extends StudentIdentityRecord>(
  students: T[],
  classId?: string
): T[] {
  const scopedStudents = classId
    ? students.filter((student) => student.classId === classId)
    : students;

  return getCurrentStudentRoster(scopedStudents);
}

export function countCurrentStudents(students: StudentIdentityRecord[]): number {
  return getCurrentStudentRoster(students).length;
}

/**
 * Currently-enrolled rows, with no opinion about who is who.
 *
 * `getCurrentStudentRoster` answers two questions at once: which rows are the
 * same human, and which of them are enrolled right now. Serving code needs
 * only the second. Taking both means every list that wanted a status filter
 * also silently re-decided identity from name, code, and date of birth — a
 * guess the server now makes properly, and one that was wrong for every one of
 * the fifty-nine doubly-owned codes in production.
 *
 * Two rows for the same human therefore both survive here. If that is visible
 * on a screen, the duplicate is real and belongs in the normalization run, not
 * hidden by the page that happens to render it.
 */
export function selectEnrolledStudentRows<T extends StudentIdentityRecord>(
  students: T[],
  classId?: string
): T[] {
  const scoped = classId ? students.filter((student) => student.classId === classId) : students;
  return scoped.filter((student) => {
    if (!isCurrentLifecycle(student)) return false;
    const status = enrollmentStatusOf(student);
    return status !== 'dropped' && status !== 'promoted';
  });
}
