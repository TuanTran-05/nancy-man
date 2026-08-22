import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';
import {
  buildAdmissionSearchFields,
  normalizeAdmissionContact,
  normalizeAdmissionName,
} from '../admissions/matching.js';
import {
  isCanonicalStudentProfile,
  isStudentProfileAlias,
  readLegacySoftMergePointer,
} from '../../../../shared/studentIdentity.js';
import { STUDENT_PROFILE_ALIASES_COLLECTION } from './studentIdentityResolver.js';

/**
 * The gate that stops a second profile being created for a human who already
 * has one.
 *
 * The subtle part is *how* it looks. Querying only the denormalized
 * `admissionSearch*` fields would be fast, indexed, and wrong: a DocumentStore
 * equality query silently omits documents that lack the queried field, and the
 * documents lacking it are precisely the ones this guard exists to catch. The
 * clone path in `studentImportHelper.ts` never wrote those fields, and a stale
 * value counts as a non-match for the same reason an absent one does.
 *
 * So the guard runs two queries and unions them:
 *
 * - the indexed denormalized lookup, which covers profiles created properly;
 * - a `dob` lookup whose results are re-normalized in memory, which covers the
 *   cloned, imported, and drifted profiles the first query cannot see.
 *
 * The second query is cheap because it is bounded by how many students share a
 * birthday, and it is the half that actually protects against the recurrence.
 *
 * Nothing here resolves a partial match. Siblings share a contact and twins
 * share a birthday, so name-only, dob-only, and contact-only matches are left
 * alone; auto-linking them would merge two real children.
 */

export type ExactHumanInput = { name: string; dob: string; contact: string };

export type ExactHumanConflict = {
  canonicalProfileId: string;
  matchedProfileIds: string[];
};

export type StudentCreationOverride = {
  decision: 'confirmed_distinct_person';
  candidateProfileIds: string[];
  reason: string;
};

export type StudentCreationCaller = {
  actorId: string;
  role: 'admin' | 'office' | 'teacher' | 'import' | 'admissions';
  override?: StudentCreationOverride;
};

export type StudentCreationOverrideAudit = {
  decision: 'confirmed_distinct_person';
  candidateProfileIds: string[];
  reason: string;
  actorId: string;
};

type StudentDoc = { id: string; data: Record<string, unknown> };

/**
 * How a read is performed, so the same rules run outside and inside a
 * transaction.
 *
 * Creation must use the transactional reader. A guard that decided from a
 * database read would be judging a snapshot the creation transaction never
 * validated, so two concurrent enrolments of the same child could each see no
 * conflict and each commit — the exact race the registry document ID already
 * closes for codes.
 */
type SnapshotReader = <T>(target: { get: () => Promise<T> }) => Promise<T>;

const databaseReader: SnapshotReader = (target) => target.get();

function transactionReader(tx: { get: (target: unknown) => Promise<unknown> }): SnapshotReader {
  return (target) => tx.get(target) as never;
}

function normalizedOf(data: Record<string, unknown>): {
  name: string;
  dob: string;
  contact: string;
} {
  // Recomputed from the raw fields rather than read from the denormalized
  // ones, so an absent or stale denormalized value cannot hide a match.
  return {
    name: normalizeAdmissionName(data.name),
    dob: String(data.dob ?? '').trim(),
    contact: normalizeAdmissionContact(data.contact),
  };
}

async function readStudents(
  read: SnapshotReader,
  db: DocumentStore,
  field: string,
  value: unknown,
  extra?: [string, unknown]
): Promise<StudentDoc[]> {
  let query = (db.collection('students') as never as {
    where: (f: string, o: string, v: unknown) => never;
  }).where(field, '==', value) as never as {
    where: (f: string, o: string, v: unknown) => never;
    limit: (n: number) => { get: () => Promise<{ docs?: Array<{ id: string; data: () => unknown }> }> };
  };
  if (extra) {
    query = query.where(extra[0], '==', extra[1]) as never;
  }
  const snapshot = await read(query.limit(25));
  return (snapshot.docs ?? []).map((doc) => ({
    id: doc.id,
    data: (doc.data() ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Maps a matched document to the canonical profile it represents, so a
 * tombstone and its surviving twin are not reported as two different humans.
 */
async function toCanonicalId(
  read: SnapshotReader,
  db: DocumentStore,
  doc: StudentDoc
): Promise<string | null> {
  // Alias first, matching resolveCanonicalStudentId. During a merge run the
  // alias is written before the tombstone, so a profile can look perfectly
  // canonical while an alias already points away from it. Checking shape
  // first would report that profile and its twin as two different humans.
  const alias = (await read(
    db.doc(`${STUDENT_PROFILE_ALIASES_COLLECTION}/${doc.id}`) as never
  )) as unknown as {
    exists: boolean;
    data: () => unknown;
  };
  if (alias.exists && isStudentProfileAlias(alias.data())) {
    return (alias.data() as { canonicalProfileId: string }).canonicalProfileId;
  }

  if (isCanonicalStudentProfile(doc.data)) return doc.id;

  const pointer = readLegacySoftMergePointer({ ...doc.data, id: doc.id });
  if (pointer) return pointer;

  // Retired with no forwarding address. Reporting it as a conflict would block
  // creation forever with no profile a human could act on.
  return null;
}

async function findExactHumanConflictWith(
  read: SnapshotReader,
  db: DocumentStore,
  input: ExactHumanInput
): Promise<ExactHumanConflict | null> {
  const search = buildAdmissionSearchFields(input);
  const wanted = {
    name: search.admissionSearchName,
    dob: search.admissionSearchDob,
    contact: search.admissionSearchContact,
  };

  const [denormalized, byDob] = await Promise.all([
    readStudents(read, db, 'admissionSearchName', wanted.name, ['admissionSearchDob', wanted.dob]),
    // The half that sees cloned, imported, and drifted profiles.
    readStudents(read, db, 'dob', input.dob.trim()),
  ]);

  const seen = new Map<string, StudentDoc>();
  for (const doc of [...denormalized, ...byDob]) seen.set(doc.id, doc);

  const matched: StudentDoc[] = [];
  for (const doc of seen.values()) {
    const actual = normalizedOf(doc.data);
    // All three, always. A partial match is a sibling or a twin, not a
    // duplicate, and linking those would merge two real children.
    if (
      actual.name === wanted.name &&
      actual.dob === wanted.dob &&
      actual.contact === wanted.contact
    ) {
      matched.push(doc);
    }
  }

  if (matched.length === 0) return null;

  const canonicalIds = new Set<string>();
  for (const doc of matched) {
    const canonicalId = await toCanonicalId(read, db, doc);
    if (canonicalId) canonicalIds.add(canonicalId);
  }

  if (canonicalIds.size === 0) return null;
  if (canonicalIds.size > 1) {
    // Two live humans indistinguishable on all three fields. A person has to
    // look at this; picking one would silently attach a child to the wrong
    // record.
    throw new Error(
      `STUDENT_IDENTITY_DATA_INCONSISTENT: matches resolve to ${[...canonicalIds].sort().join(', ')}`
    );
  }

  return {
    canonicalProfileId: [...canonicalIds][0],
    matchedProfileIds: matched.map((doc) => doc.id).sort(),
  };
}

export function findExactHumanConflict(
  db: DocumentStore,
  input: ExactHumanInput
): Promise<ExactHumanConflict | null> {
  return findExactHumanConflictWith(databaseReader, db, input);
}

export function findExactHumanConflictInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: ExactHumanInput
): Promise<ExactHumanConflict | null> {
  return findExactHumanConflictWith(
    transactionReader(tx as never as { get: (target: unknown) => Promise<unknown> }),
    db,
    input
  );
}

/**
 * The API error mapper reads `statusCode`. Without it these refusals reach the
 * operator as an opaque 500, which is indistinguishable from a bug and gives
 * them no way to tell "this child already exists" from "the server broke".
 */
function identityError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Turns a detected conflict into a decision. Pure, so the same rules apply
 * whichever reader found the conflict — there is no second copy of the override
 * policy that could drift from this one.
 */
function decideOnConflict(
  conflict: ExactHumanConflict | null,
  caller: StudentCreationCaller
): StudentCreationOverrideAudit | null {
  if (!conflict) return null;

  const override = caller.override;
  if (!override) {
    throw identityError(
      `STUDENT_IDENTITY_REVIEW_REQUIRED: ${conflict.canonicalProfileId} already describes this human`,
      409
    );
  }

  // Admin only. Import and admissions are the paths that produce duplicates in
  // bulk, so an override reachable from them would defeat the guard entirely.
  if (caller.role !== 'admin') {
    throw identityError(`STUDENT_IDENTITY_OVERRIDE_FORBIDDEN: ${caller.role} may not override`, 403);
  }
  if (override.decision !== 'confirmed_distinct_person') {
    throw identityError(
      `STUDENT_IDENTITY_OVERRIDE_INVALID: unknown decision ${override.decision}`,
      400
    );
  }
  if (override.candidateProfileIds.length === 0 || override.reason.trim() === '') {
    throw identityError(
      'STUDENT_IDENTITY_OVERRIDE_INVALID: a candidate profile and a reason are both required',
      400
    );
  }
  // The override must name the profile it is overriding. Without this it is a
  // blanket bypass rather than a decision about one specific pair of humans.
  if (!override.candidateProfileIds.includes(conflict.canonicalProfileId)) {
    throw identityError(
      `STUDENT_IDENTITY_OVERRIDE_INVALID: override does not name ${conflict.canonicalProfileId}`,
      400
    );
  }

  return {
    decision: override.decision,
    candidateProfileIds: [...override.candidateProfileIds].sort(),
    reason: override.reason.trim(),
    actorId: caller.actorId,
  };
}

export async function assertStudentCreationAllowed(
  db: DocumentStore,
  input: ExactHumanInput,
  caller: StudentCreationCaller
): Promise<StudentCreationOverrideAudit | null> {
  return decideOnConflict(await findExactHumanConflict(db, input), caller);
}

export async function assertStudentCreationAllowedInTransaction(
  tx: Transaction,
  db: DocumentStore,
  input: ExactHumanInput,
  caller: StudentCreationCaller
): Promise<StudentCreationOverrideAudit | null> {
  return decideOnConflict(await findExactHumanConflictInTransaction(tx, db, input), caller);
}
