import { FieldPath, type DocumentStore } from '@/server/db/documentStore.js';
import type { DashboardReadModelV3 } from '../../../../shared/dashboardReadModel.js';
import {
  deriveCanonicalStudentPlacementStatus,
  type CanonicalStudentEnrollmentView,
  type CanonicalStudentPlacementStatus,
  type CanonicalStudentReadRow,
} from '../../../../shared/canonicalStudentReadModel.js';
import {
  isOpenStudentCourseEnrollmentStatus,
  type StudentCourseEnrollmentStatus,
} from '../../../../shared/studentCourseEnrollment.js';
import {
  isCanonicalStudentProfile,
  isStudentProfileAlias,
} from '../../../../shared/studentIdentity.js';
import { normalizeAdmissionName } from '../admissions/matching.js';
import {
  buildCanonicalReadDiscrepancy,
  type CanonicalReadDiscrepancy,
} from './canonicalStudentReadControl.js';
import { resolveCanonicalStudentId } from './studentIdentityResolver.js';

/**
 * Reads a student the way the rest of the system will come to mean it: one
 * canonical profile, with its current situation derived from its enrollments.
 *
 * Two rules define everything here.
 *
 * Identity comes from the resolver, never from a document id a caller happened
 * to hold. Historical records all over this codebase store profile ids that
 * were correct when written and may since have been aliased away; reading them
 * literally is what makes a merged student reappear as two people.
 *
 * Class, teacher, and status come from the enrollment, never from
 * `students.classId`/`teacherId`/`enrollmentStatus`. Those three are
 * compatibility projections. They go stale the moment anything writes an
 * enrollment without refreshing them, and the reason production has fifty-nine
 * doubly-owned codes is that the old promotion path trusted them.
 *
 * A third rule governs failure, and it differs by shape of read. Asking about
 * one student and getting a wrong answer is worse than getting an error, so the
 * single-student read refuses anything ambiguous. Asking for a roster or a
 * directory is different: one broken record must not take the page down with
 * it, because that is a teacher who cannot take attendance for twenty-nine
 * healthy students. List reads therefore report the fault and keep going.
 */

export const STUDENT_COURSE_ENROLLMENTS_COLLECTION = 'student_course_enrollments';
const STUDENT_PROFILE_ALIASES_COLLECTION = 'student_profile_aliases';

/**
 * Scope of a roster request.
 *
 * There is deliberately no `courseId`. Enrollment records identify a course by
 * `classId` and `termStart`; nothing writes a separate course id. Accepting one
 * would mean accepting a filter that silently matches everything, which for a
 * historical roster means quietly returning current students.
 */
export type CanonicalClassRosterScope = {
  classId: string;
  termStart?: string;
  /** Restricts to enrollments whose membership window contains this date. */
  atDate?: string;
  includeStatuses?: StudentCourseEnrollmentStatus[];
  onAnomaly?: (anomaly: CanonicalStudentReadAnomaly) => void;
};

/**
 * A row that could not be produced, named without naming the human.
 *
 * These travel into shadow-mode telemetry beside the discrepancy records, so
 * they carry ids and a code and nothing else — no name, contact, or class.
 */
export type CanonicalStudentReadAnomaly = {
  requestedProfileId: string;
  canonicalProfileId: string | null;
  code:
    | 'UNRESOLVABLE_ID'
    | 'MULTIPLE_OPEN_ENROLLMENTS'
    | 'PLACEMENT_UNDERIVABLE';
};

export type CanonicalStudentDirectoryQuery = {
  classId?: string;
  lifecycle?: string;
  placementStatus?: CanonicalStudentPlacementStatus;
  search?: string;
  limit: number;
  cursor?: string;
};

export type CanonicalStudentDirectoryPage = {
  rows: CanonicalStudentReadRow[];
  nextCursor: string | null;
  anomalies: CanonicalStudentReadAnomaly[];
};

/**
 * The centre-wide canonical counts, deliberately not part of a page.
 *
 * A page can only count what it matched, and "twenty students matched this
 * filter" is a different answer from "this centre has twenty students".
 * Carrying both through one field is how a filtered directory came to report a
 * centre total. Asking for these is now a separate call, which also keeps a
 * missing projection from failing a page that never wanted them.
 */
export type CanonicalStudentDirectoryCounts = {
  canonicalProfiles: number;
  trial: number;
  studying: number;
  onLeave: number;
  waitingForPlacement: number;
};

const OPEN_STATUSES: readonly StudentCourseEnrollmentStatus[] = ['trial', 'active', 'on_leave'];

type QuerySnapshot = { docs?: Array<{ id: string; data: () => Record<string, unknown> }> };
type Queryable = {
  where: (field: string, op: string, value: unknown) => Queryable;
  orderBy: (field: unknown) => Queryable;
  startAfter: (value: unknown) => Queryable;
  limit: (take: number) => Queryable;
  get: () => Promise<QuerySnapshot>;
};

/**
 * DocumentStore's ceiling on an `in` filter, and the reason enrichment is chunked
 * rather than issued as one query per page.
 */
const CANONICAL_READ_IN_LIMIT = 30;

/**
 * How many profile documents one candidate scan reads at a time.
 *
 * Aliases and filters remove candidates after they are read, so a page of two
 * rows may need several candidate pages. Small enough that an ordinary request
 * does not pay for the whole centre; large enough that a filtered directory
 * does not turn into a round trip per row.
 */
const CANONICAL_CANDIDATE_PAGE = 100;

/**
 * The program's cap on a complete canonical traversal.
 *
 * Matches the students index endpoint's existing limit. A centre past it needs
 * a different read shape, and finding that out through a stable error beats
 * discovering it as a timeout.
 */
export const CANONICAL_DIRECTORY_MAX = 3000;

function chunks<T>(values: readonly T[], size = CANONICAL_READ_IN_LIMIT): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function collection(db: DocumentStore, name: string): Queryable {
  return db.collection(name) as never as Queryable;
}

function docsOf(snapshot: QuerySnapshot): Array<{ id: string; data: Record<string, unknown> }> {
  return (snapshot.docs ?? []).map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function toEnrollmentView(doc: {
  id: string;
  data: Record<string, unknown>;
}): CanonicalStudentEnrollmentView {
  const data = doc.data || {};
  return {
    id: doc.id,
    classId: String(data.classId || ''),
    termStart: String(data.termStart || ''),
    termEnd: typeof data.termEnd === 'string' ? data.termEnd : null,
    joinedAt: String(data.joinedAt || ''),
    endedAt: typeof data.endedAt === 'string' ? data.endedAt : null,
    status: String(data.status || '') as StudentCourseEnrollmentStatus,
  };
}

/**
 * Latest wins, ties broken by id.
 *
 * The tie-break is not cosmetic: without it, two enrollments sharing a
 * termStart would order by whatever DocumentStore returned first, and "which class
 * did this student most recently finish" would change between reads.
 */
function sortByRecency(
  left: CanonicalStudentEnrollmentView,
  right: CanonicalStudentEnrollmentView
): number {
  if (left.termStart !== right.termStart) return left.termStart < right.termStart ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function canonicalError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Class documents, read once each per request.
 *
 * Every roster row needs a teacher and the teacher lives on the class, so a
 * naive implementation fetches one document once per student in it.
 */
function makeClassTeacherCache(db: DocumentStore) {
  const cache = new Map<string, Promise<string | null>>();
  return (classId: string): Promise<string | null> => {
    if (!classId) return Promise.resolve(null);
    const cached = cache.get(classId);
    if (cached) return cached;
    const pending = (async () => {
      const snapshot = (await db.collection('classes').doc(classId).get()) as unknown as {
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
      };
      if (!snapshot.exists) return null;
      const teacherId = (snapshot.data() || {}).teacherId;
      return typeof teacherId === 'string' && teacherId ? teacherId : null;
    })();
    cache.set(classId, pending);
    return pending;
  };
}

async function readEnrollmentsFor(
  db: DocumentStore,
  profileId: string
): Promise<CanonicalStudentEnrollmentView[]> {
  const snapshot = await collection(db, STUDENT_COURSE_ENROLLMENTS_COLLECTION)
    .where('studentId', '==', profileId)
    .get();
  return docsOf(snapshot).map(toEnrollmentView);
}

function selectOpen(
  enrollments: CanonicalStudentEnrollmentView[]
): CanonicalStudentEnrollmentView[] {
  return enrollments.filter((row) => isOpenStudentCourseEnrollmentStatus(row.status));
}

function latestOf(
  enrollments: CanonicalStudentEnrollmentView[]
): CanonicalStudentEnrollmentView | null {
  return [...enrollments].sort(sortByRecency).at(-1) ?? null;
}

type RowInput = {
  requestedId: string;
  canonicalProfileId: string;
  profile: Record<string, unknown>;
  enrollments: CanonicalStudentEnrollmentView[];
  /**
   * The enrollment that answers the caller's question, when the caller asked a
   * scoped one. A roster row's context is the enrollment that put the student
   * on that roster; without it, a student with a second open enrollment
   * elsewhere would be unanswerable on a roster where nothing is in doubt.
   */
  scopedEnrollment?: CanonicalStudentEnrollmentView | null;
};

/**
 * Which enrollment is this student's *current* one.
 *
 * A scoped enrollment only qualifies while it is open. A historical roster —
 * attendance for a term that ended — scopes to a closed enrollment, and calling
 * that "current" would claim the student is still in a course that finished.
 * When the scope is historical, the answer falls back to whatever is genuinely
 * open now, which is how a past roster can still say where the student went.
 */
function pickCurrentEnrollment(
  enrollments: CanonicalStudentEnrollmentView[],
  scoped: CanonicalStudentEnrollmentView | null | undefined
): CanonicalStudentEnrollmentView | null {
  if (scoped && isOpenStudentCourseEnrollmentStatus(scoped.status)) return scoped;
  const open = selectOpen(enrollments);
  return open.length === 1 ? open[0] : null;
}

function assembleRow(
  input: RowInput,
  currentTeacherId: string | null
): CanonicalStudentReadRow {
  const current = pickCurrentEnrollment(input.enrollments, input.scopedEnrollment);
  const redirected = input.canonicalProfileId !== input.requestedId;

  const placementStatus: CanonicalStudentPlacementStatus = deriveCanonicalStudentPlacementStatus({
    lifecycle: String(input.profile.studentLifecycle || ''),
    currentEnrollment: current,
    lastEnrollment: latestOf(input.enrollments),
  });

  return {
    id: input.canonicalProfileId,
    canonicalProfileId: input.canonicalProfileId,
    ...(redirected ? { requestedProfileId: input.requestedId } : {}),
    redirected,
    profile: input.profile,
    currentEnrollment: current,
    lastEnrollment: latestOf(input.enrollments),
    currentClassId: current ? current.classId : null,
    currentTeacherId,
    placementStatus,
    // Only include scopedEnrollment when the caller supplied a scope (different from current).
    ...(input.scopedEnrollment != null ? { scopedEnrollment: input.scopedEnrollment } : {}),
  };
}

async function readProfile(
  db: DocumentStore,
  profileId: string
): Promise<Record<string, unknown> | null> {
  const snapshot = (await db.collection('students').doc(profileId).get()) as unknown as {
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  };
  return snapshot.exists ? snapshot.data() || {} : null;
}

export async function readCanonicalStudentContext(
  db: DocumentStore,
  requestedId: string
): Promise<CanonicalStudentReadRow> {
  const { canonicalProfileId } = await resolveCanonicalStudentId(db, requestedId);
  const [profile, enrollments] = await Promise.all([
    readProfile(db, canonicalProfileId),
    readEnrollmentsFor(db, canonicalProfileId),
  ]);
  if (!profile) {
    throw canonicalError(`CANONICAL_STUDENT_PROFILE_MISSING: ${canonicalProfileId}`, 404);
  }

  const open = selectOpen(enrollments);
  if (open.length > 1) {
    // Unscoped, so there is no honest way to choose. Picking one would put the
    // student on the wrong class page and hide the other course entirely.
    throw canonicalError(
      `CANONICAL_STUDENT_MULTIPLE_OPEN_ENROLLMENTS: ${canonicalProfileId} has ${open.length} open enrollments`,
      409
    );
  }

  const readTeacher = makeClassTeacherCache(db);
  const currentTeacherId = open[0] ? await readTeacher(open[0].classId) : null;
  return assembleRow({ requestedId, canonicalProfileId, profile, enrollments }, currentTeacherId);
}

/**
 * Keyed by the id the caller asked for, not the canonical one.
 *
 * Callers hold legacy ids in attendance rows, evaluations, ledgers, and
 * receipts. A map keyed on the canonical id would compile, run, and silently
 * miss every one of those lookups.
 */
export async function readCanonicalStudentsByIds(
  db: DocumentStore,
  requestedIds: readonly string[],
  onAnomaly?: (anomaly: CanonicalStudentReadAnomaly) => void
): Promise<Map<string, CanonicalStudentReadRow>> {
  const unique = [...new Set(requestedIds.filter(Boolean))];
  const readTeacher = makeClassTeacherCache(db);

  const resolved = await Promise.all(
    unique.map(async (requestedId) => {
      try {
        const { canonicalProfileId } = await resolveCanonicalStudentId(db, requestedId);
        return { requestedId, canonicalProfileId };
      } catch {
        // One broken historical reference must not blank an entire roster. The
        // caller sees a missing key, which is the honest answer for that id.
        onAnomaly?.({ requestedProfileId: requestedId, canonicalProfileId: null, code: 'UNRESOLVABLE_ID' });
        return null;
      }
    })
  );

  const canonicalIds = [
    ...new Set(resolved.filter((entry) => entry !== null).map((entry) => entry!.canonicalProfileId)),
  ];
  const loaded = new Map<
    string,
    { profile: Record<string, unknown>; enrollments: CanonicalStudentEnrollmentView[] }
  >();
  await Promise.all(
    canonicalIds.map(async (canonicalProfileId) => {
      const [profile, enrollments] = await Promise.all([
        readProfile(db, canonicalProfileId),
        readEnrollmentsFor(db, canonicalProfileId),
      ]);
      if (profile) loaded.set(canonicalProfileId, { profile, enrollments });
    })
  );

  const rows = new Map<string, CanonicalStudentReadRow>();
  for (const entry of resolved) {
    if (!entry) continue;
    const record = loaded.get(entry.canonicalProfileId);
    if (!record) {
      onAnomaly?.({
        requestedProfileId: entry.requestedId,
        canonicalProfileId: entry.canonicalProfileId,
        code: 'UNRESOLVABLE_ID',
      });
      continue;
    }
    const open = selectOpen(record.enrollments);
    if (open.length > 1) {
      // Nothing here scopes the question, so there is no honest current
      // enrollment. Deriving anyway lands on `inactive` — a student in two
      // courses reported as attending none — and a wrong row is worse than an
      // absent one because only the absence is visible.
      onAnomaly?.({
        requestedProfileId: entry.requestedId,
        canonicalProfileId: entry.canonicalProfileId,
        code: 'MULTIPLE_OPEN_ENROLLMENTS',
      });
      continue;
    }
    try {
      rows.set(
        entry.requestedId,
        assembleRow(
          {
            requestedId: entry.requestedId,
            canonicalProfileId: entry.canonicalProfileId,
            profile: record.profile,
            enrollments: record.enrollments,
          },
          open[0] ? await readTeacher(open[0].classId) : null
        )
      );
    } catch {
      onAnomaly?.({
        requestedProfileId: entry.requestedId,
        canonicalProfileId: entry.canonicalProfileId,
        code: 'PLACEMENT_UNDERIVABLE',
      });
    }
  }

  return rows;
}

function withinWindow(view: CanonicalStudentEnrollmentView, atDate: string): boolean {
  if (view.joinedAt && view.joinedAt > atDate) return false;
  const end = view.termEnd;
  return !end || end >= atDate;
}

function compareByDisplayOrder(left: CanonicalStudentReadRow, right: CanonicalStudentReadRow) {
  const leftName = normalizeAdmissionName(left.profile.name);
  const rightName = normalizeAdmissionName(right.profile.name);
  if (leftName !== rightName) return leftName < rightName ? -1 : 1;
  return left.canonicalProfileId.localeCompare(right.canonicalProfileId);
}

/**
 * A class roster, defined by enrollments.
 *
 * The default scope is the open statuses only. A historical caller —
 * attendance for a past date, a course-closing record, a ledger rebuild — has
 * to say so explicitly by passing a term or a date, because a roster request
 * without a time context has exactly one safe reading: right now.
 */
export async function listCanonicalClassRoster(
  db: DocumentStore,
  scope: CanonicalClassRosterScope
): Promise<CanonicalStudentReadRow[]> {
  if (!scope.classId) return [];
  const statuses = scope.includeStatuses ?? [...OPEN_STATUSES];

  let query = collection(db, STUDENT_COURSE_ENROLLMENTS_COLLECTION)
    .where('classId', '==', scope.classId)
    .where('status', 'in', statuses);
  if (scope.termStart) query = query.where('termStart', '==', scope.termStart);

  const enrollmentsInClass = docsOf(await query.get())
    .map((doc) => ({ studentId: String(doc.data.studentId || ''), view: toEnrollmentView(doc) }))
    .filter((entry) => entry.studentId !== '')
    .filter((entry) => !scope.atDate || withinWindow(entry.view, scope.atDate));

  const resolved = await Promise.all(
    [...new Set(enrollmentsInClass.map((entry) => entry.studentId))].map(async (studentId) => {
      try {
        const { canonicalProfileId } = await resolveCanonicalStudentId(db, studentId);
        return { studentId, canonicalProfileId };
      } catch {
        scope.onAnomaly?.({
          requestedProfileId: studentId,
          canonicalProfileId: null,
          code: 'UNRESOLVABLE_ID',
        });
        return null;
      }
    })
  );

  // One row per canonical profile: a student who repeated a course has two
  // enrollments in the same class and is still one person on the roster.
  const scopedByCanonicalId = new Map<string, CanonicalStudentEnrollmentView>();
  const requestedByCanonicalId = new Map<string, string>();
  for (const entry of resolved) {
    if (!entry) continue;
    requestedByCanonicalId.set(entry.canonicalProfileId, entry.studentId);
    for (const row of enrollmentsInClass.filter((item) => item.studentId === entry.studentId)) {
      const existing = scopedByCanonicalId.get(entry.canonicalProfileId);
      if (!existing || sortByRecency(existing, row.view) < 0) {
        scopedByCanonicalId.set(entry.canonicalProfileId, row.view);
      }
    }
  }

  const readTeacher = makeClassTeacherCache(db);
  const rows = await Promise.all(
    [...scopedByCanonicalId.entries()].map(async ([canonicalProfileId, scopedEnrollment]) => {
      const requestedId = requestedByCanonicalId.get(canonicalProfileId) ?? canonicalProfileId;
      const [profile, enrollments] = await Promise.all([
        readProfile(db, canonicalProfileId),
        readEnrollmentsFor(db, canonicalProfileId),
      ]);
      if (!profile) {
        scope.onAnomaly?.({ requestedProfileId: requestedId, canonicalProfileId, code: 'UNRESOLVABLE_ID' });
        return null;
      }
      if (selectOpen(enrollments).length > 1) {
        // Reported, not thrown: the enrollment that put this student on this
        // roster is not the ambiguous part.
        scope.onAnomaly?.({
          requestedProfileId: requestedId,
          canonicalProfileId,
          code: 'MULTIPLE_OPEN_ENROLLMENTS',
        });
      }
      try {
        const current = pickCurrentEnrollment(enrollments, scopedEnrollment);
        return assembleRow(
          { requestedId, canonicalProfileId, profile, enrollments, scopedEnrollment },
          current ? await readTeacher(current.classId) : null
        );
      } catch {
        scope.onAnomaly?.({
          requestedProfileId: requestedId,
          canonicalProfileId,
          code: 'PLACEMENT_UNDERIVABLE',
        });
        return null;
      }
    })
  );

  return rows.filter((row): row is CanonicalStudentReadRow => row !== null).sort(compareByDisplayOrder);
}

/**
 * Cursor paging over rows already sorted for display.
 *
 * The cursor is a profile id and nothing else. Encoding the sort key would put
 * a student's name into a token that ends up in URLs and access logs, and no
 * later redaction takes it back out.
 */
export function paginateCanonicalRows(
  rows: readonly CanonicalStudentReadRow[],
  limit: number,
  cursor?: string
): { page: CanonicalStudentReadRow[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const index = rows.findIndex((row) => row.canonicalProfileId === cursor);
    if (index < 0) {
      // The row the cursor named is gone from the matched set. Continuing would
      // silently repeat or skip students; restarting the page is the only
      // honest option, and the caller has to know that is what happened.
      throw canonicalError(
        `CANONICAL_STUDENT_DIRECTORY_CURSOR_STALE: ${cursor} is no longer in this result set`,
        409
      );
    }
    start = index + 1;
  }

  const page = rows.slice(start, start + limit);
  return {
    page,
    nextCursor: start + page.length < rows.length ? (page.at(-1)?.canonicalProfileId ?? null) : null,
  };
}

/** Aliased-away ids among a candidate chunk, read by document id, never queried. */
async function readAliasedAwayIds(db: DocumentStore, ids: readonly string[]): Promise<Set<string>> {
  const aliased = new Set<string>();
  const getAll = (db as unknown as {
    getAll?: (...refs: unknown[]) => Promise<Array<{ id: string; exists: boolean; data: () => unknown }>>;
  }).getAll;
  for (const group of chunks(ids)) {
    const refs = group.map((id) => db.collection(STUDENT_PROFILE_ALIASES_COLLECTION).doc(id));
    const snapshots = getAll
      ? await getAll.call(db, ...refs)
      : await Promise.all(
          refs.map((ref) => ref.get() as unknown as Promise<{ id: string; exists: boolean; data: () => unknown }>)
        );
    for (const snapshot of snapshots) {
      if (snapshot.exists && isStudentProfileAlias(snapshot.data())) aliased.add(snapshot.id);
    }
  }
  return aliased;
}

/** Enrollments for a bounded set of canonical ids, in `in` chunks. */
async function readEnrollmentsForIds(
  db: DocumentStore,
  ids: readonly string[]
): Promise<Map<string, CanonicalStudentEnrollmentView[]>> {
  const byProfile = new Map<string, CanonicalStudentEnrollmentView[]>();
  for (const group of chunks(ids)) {
    if (group.length === 0) continue;
    const snapshot = await collection(db, STUDENT_COURSE_ENROLLMENTS_COLLECTION)
      .where('studentId', 'in', group)
      .get();
    for (const doc of docsOf(snapshot)) {
      const profileId = String(doc.data.studentId || '');
      if (!profileId) continue;
      const bucket = byProfile.get(profileId);
      if (bucket) bucket.push(toEnrollmentView(doc));
      else byProfile.set(profileId, [toEnrollmentView(doc)]);
    }
  }
  return byProfile;
}

type CanonicalRowScan = {
  rows: CanonicalStudentReadRow[];
  anomalies: CanonicalStudentReadAnomaly[];
  /** The last candidate document actually read, which is what a cursor resumes from. */
  lastScannedId: string | null;
  exhausted: boolean;
};

/**
 * Walks candidate profiles in bounded pages until `want` rows match.
 *
 * The cursor is the last *candidate* id rather than the last returned row.
 * Aliases and filters remove candidates after they are read, so resuming from
 * the last row would re-read — and re-skip — everything the filter dropped at
 * the tail of the previous page.
 */
async function scanCanonicalRows(
  db: DocumentStore,
  options: {
    after?: string;
    want: number;
    matches?: (row: CanonicalStudentReadRow) => boolean;
    readTeacher: (classId: string) => Promise<string | null>;
  }
): Promise<CanonicalRowScan> {
  const rows: CanonicalStudentReadRow[] = [];
  const anomalies: CanonicalStudentReadAnomaly[] = [];
  let after = options.after;
  let lastScannedId: string | null = after ?? null;
  let exhausted = false;
  let full = false;

  while (rows.length < options.want && !exhausted && !full) {
    let candidateQuery = collection(db, 'students').orderBy(FieldPath.documentId());
    if (after !== undefined) candidateQuery = candidateQuery.startAfter(after);
    const snapshot = await candidateQuery.limit(CANONICAL_CANDIDATE_PAGE).get();
    const candidates = docsOf(snapshot);
    if (candidates.length < CANONICAL_CANDIDATE_PAGE) exhausted = true;
    if (candidates.length === 0) break;

    const scannedId = candidates.at(-1)?.id ?? null;
    if (scannedId !== null && scannedId === after) {
      // The cursor did not advance. Continuing would spin forever on a page
      // that keeps returning the same tail.
      break;
    }
    after = scannedId ?? undefined;
    lastScannedId = scannedId;

    const canonical = candidates.filter((doc) => isCanonicalStudentProfile(doc.data));
    const aliasedAway = await readAliasedAwayIds(db, canonical.map((doc) => doc.id));
    const live = canonical.filter((doc) => !aliasedAway.has(doc.id));
    const enrollmentsByProfile = await readEnrollmentsForIds(db, live.map((doc) => doc.id));

    for (const doc of live) {
      const enrollments = enrollmentsByProfile.get(doc.id) ?? [];
      const open = selectOpen(enrollments);
      if (open.length > 1) {
        // Same reasoning as the batch read: unscoped, two open courses have no
        // honest single answer, and the derived one would read `inactive`.
        anomalies.push({
          requestedProfileId: doc.id,
          canonicalProfileId: doc.id,
          code: 'MULTIPLE_OPEN_ENROLLMENTS',
        });
        continue;
      }
      let row: CanonicalStudentReadRow;
      try {
        row = assembleRow(
          { requestedId: doc.id, canonicalProfileId: doc.id, profile: doc.data, enrollments },
          open[0] ? await options.readTeacher(open[0].classId) : null
        );
      } catch {
        // A profile whose situation cannot be stated. Reported rather than
        // thrown, because one of these must not close the directory to everyone.
        anomalies.push({
          requestedProfileId: doc.id,
          canonicalProfileId: doc.id,
          code: 'PLACEMENT_UNDERIVABLE',
        });
        continue;
      }
      if (options.matches && !options.matches(row)) continue;
      rows.push(row);
      if (rows.length >= options.want) {
        // Stop at the row that fills the page, and resume from it. Reporting
        // the last candidate *read* instead would silently drop every row
        // between it and this one.
        lastScannedId = doc.id;
        exhausted = false;
        full = true;
        break;
      }
    }
  }

  return { rows, anomalies, lastScannedId, exhausted };
}

/**
 * The centre-wide canonical counts, read rather than recomputed.
 *
 * Counting the rows a page happened to match answers "how big is this filter",
 * not "how many students does this centre have", and reporting the first as
 * the second is how a filtered directory came to claim the centre had one
 * student. The projection that does answer it is version 3 of the dashboard
 * read model, rebuilt by the dashboard aggregate and by
 * `repair:student-identity-projections`.
 */
export async function readCanonicalDirectoryCounts(
  db: DocumentStore
): Promise<CanonicalStudentDirectoryCounts> {
  const snapshot = (await db.collection('read_models').doc('dashboard_global').get()) as unknown as {
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  };
  const model = (snapshot.exists ? snapshot.data()?.canonicalHeadcount : null) as
    | DashboardReadModelV3
    | null
    | undefined;

  if (!model || model.schemaVersion !== 3 || model.complete !== true) {
    throw canonicalError(
      'CANONICAL_STUDENT_DIRECTORY_COUNTS_INCOMPLETE: no complete version-3 canonical headcount; ' +
        'rebuild it with repair:student-identity-projections before serving canonical counts',
      503
    );
  }

  return {
    canonicalProfiles: model.canonicalProfileCount,
    trial: model.trialCanonicalCount,
    studying: model.studyingCanonicalCount,
    onLeave: model.onLeaveCanonicalCount,
    waitingForPlacement: model.waitingForPlacementCanonicalCount,
  };
}

/**
 * Every canonical row, assembled through bounded pages.
 *
 * The complete traversal the dashboard, the wallet, and the students index
 * need. It is a separate, named function rather than a `limit` large enough to
 * mean "everything", because those two look identical at a call site and only
 * one of them is a decision somebody made.
 */
export async function collectCanonicalStudentDirectoryProjection(
  db: DocumentStore
): Promise<{ rows: CanonicalStudentReadRow[]; anomalies: CanonicalStudentReadAnomaly[] }> {
  const readTeacher = makeClassTeacherCache(db);
  const scan = await scanCanonicalRows(db, {
    want: CANONICAL_DIRECTORY_MAX + 1,
    readTeacher,
  });

  if (scan.rows.length > CANONICAL_DIRECTORY_MAX) {
    throw canonicalError(
      `CANONICAL_STUDENT_DIRECTORY_LIMIT_EXCEEDED: more than ${CANONICAL_DIRECTORY_MAX} canonical profiles`,
      409
    );
  }

  scan.rows.sort(compareByDisplayOrder);
  return { rows: scan.rows, anomalies: scan.anomalies };
}

/**
 * The student directory, one bounded page at a time.
 *
 * Candidates are read in pages ordered by document id, aliases are resolved by
 * document id, and enrollments arrive in `in` chunks — so a page of twenty
 * costs a page of twenty rather than the whole centre. Ordering is by document
 * id for the same reason the cursor is: a name in a cursor is a name in a URL
 * and an access log, and no later redaction takes it back out. Clients that
 * display this list sort it themselves.
 */
export async function listCanonicalStudentDirectory(
  db: DocumentStore,
  query: CanonicalStudentDirectoryQuery
): Promise<CanonicalStudentDirectoryPage> {
  const readTeacher = makeClassTeacherCache(db);
  const search = query.search ? normalizeAdmissionName(query.search) : '';
  const matches = (row: CanonicalStudentReadRow) => {
    if (query.classId && row.currentClassId !== query.classId) return false;
    if (query.lifecycle && String(row.profile.studentLifecycle || '') !== query.lifecycle) {
      return false;
    }
    if (query.placementStatus && row.placementStatus !== query.placementStatus) return false;
    if (search && !normalizeAdmissionName(row.profile.name).includes(search)) return false;
    return true;
  };

  const limit = Math.min(query.limit, CANONICAL_DIRECTORY_MAX);
  // One row past the page. A full page is not evidence of a next one — every
  // remaining candidate may be an alias or fail the filter — and a cursor
  // handed out on that assumption produces an empty final page.
  const scan = await scanCanonicalRows(db, {
    after: query.cursor,
    want: limit + 1,
    matches,
    readTeacher,
  });

  const hasMore = scan.rows.length > limit;
  // Sliced in scan order, so the cursor is the id the next scan resumes after.
  // Sorting first would hand out the alphabetically-last id and skip everyone
  // between it and the true page boundary.
  const page = scan.rows.slice(0, limit);
  const nextCursor = hasMore ? (page.at(-1)?.canonicalProfileId ?? null) : null;

  return {
    rows: [...page].sort(compareByDisplayOrder),
    nextCursor,
    anomalies: scan.anomalies,
  };
}

/**
 * What shadow mode compares.
 *
 * The legacy side is a list of raw profile ids, because that is what the old
 * reads returned: physical documents, one per row, with no notion that two of
 * them could be the same child. Resolving each one is the whole job — the
 * canonical rows cannot supply that mapping themselves, since a canonical row
 * only knows the single id it was asked by, not every retired id that also
 * names the same human.
 */
export async function compareCanonicalStudentReadSets(
  db: DocumentStore,
  surface: string,
  legacyProfileIds: readonly string[],
  canonicalRows: readonly CanonicalStudentReadRow[]
): Promise<CanonicalReadDiscrepancy[]> {
  const canonicalIds = new Set(canonicalRows.map((row) => row.canonicalProfileId));
  const legacy = [...new Set(legacyProfileIds.filter(Boolean))];

  // The rows already carry a mapping for every id they were fetched by, so a
  // caller that built them from these same ids pays nothing here. Only ids the
  // canonical answer does not account for reach the resolver.
  const legacyToCanonical = new Map<string, string>();
  for (const row of canonicalRows) {
    legacyToCanonical.set(row.canonicalProfileId, row.canonicalProfileId);
    if (row.requestedProfileId) {
      legacyToCanonical.set(row.requestedProfileId, row.canonicalProfileId);
    }
  }
  await Promise.all(
    legacy
      .filter((legacyId) => !legacyToCanonical.has(legacyId))
      .map(async (legacyId) => {
        try {
          const { canonicalProfileId } = await resolveCanonicalStudentId(db, legacyId);
          legacyToCanonical.set(legacyId, canonicalProfileId);
        } catch {
          // Unresolvable: reported below as a legacy row canonical has no
          // answer for, which is exactly what it is.
        }
      })
  );

  const discrepancies: CanonicalReadDiscrepancy[] = [];

  // Several legacy rows collapsing into one canonical row is the duplicate
  // pattern itself, so it is reported per canonical profile rather than in bulk.
  const collapsedBy = new Map<string, string[]>();
  const unmatched: string[] = [];
  for (const legacyId of legacy) {
    const canonicalId = legacyToCanonical.get(legacyId);
    // Resolving to something the canonical answer does not contain is still a
    // miss: the legacy read returned a student canonical says is not here.
    if (!canonicalId || !canonicalIds.has(canonicalId)) {
      unmatched.push(legacyId);
      continue;
    }
    const bucket = collapsedBy.get(canonicalId);
    if (bucket) bucket.push(legacyId);
    else collapsedBy.set(canonicalId, [legacyId]);
  }

  for (const [canonicalId, legacyIds] of collapsedBy) {
    if (legacyIds.length < 2) continue;
    discrepancies.push(
      buildCanonicalReadDiscrepancy({
        surface,
        reasonCode: 'LEGACY_PHYSICAL_DUPLICATE',
        canonicalProfileIds: [canonicalId],
        legacyProfileIds: legacyIds,
        legacyCount: legacyIds.length,
        canonicalCount: 1,
      })
    );
  }

  if (unmatched.length > 0) {
    discrepancies.push(
      buildCanonicalReadDiscrepancy({
        surface,
        reasonCode: 'CANONICAL_ROW_MISSING',
        canonicalProfileIds: [],
        legacyProfileIds: unmatched,
        legacyCount: unmatched.length,
        canonicalCount: 0,
      })
    );
  }

  const missedByLegacy = [...canonicalIds].filter(
    (canonicalId) => !collapsedBy.has(canonicalId)
  );
  if (missedByLegacy.length > 0) {
    discrepancies.push(
      buildCanonicalReadDiscrepancy({
        surface,
        reasonCode: 'LEGACY_ROW_MISSING',
        canonicalProfileIds: missedByLegacy,
        legacyProfileIds: [],
        legacyCount: 0,
        canonicalCount: missedByLegacy.length,
      })
    );
  }

  return discrepancies;
}
