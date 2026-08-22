import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  isCanonicalStudentProfile,
  isStudentProfileAlias,
} from '../shared/studentIdentity.js';
import {
  ACCOUNTING_STUDENT_SUMMARIES_COLLECTION,
  buildAccountingProjectionHealth,
  type AccountingStudentFinanceProjectionHealthV3,
} from '../server/api/lib/accounting/studentFinanceProjectionRepository.js';
import { buildAccountingStudentSummary } from '../server/api/lib/services/accountingStudentSummaryService.js';

/**
 * Rebuilds the accounting finance projection onto canonical profiles.
 *
 * Version 2 of this projection wrote one summary per physical `students`
 * document. A merged child therefore had two, each holding part of their
 * money, and the finance list showed both. This walks canonical profiles
 * instead and writes exactly one summary each.
 *
 * It is resumable rather than atomic on purpose: a few hundred profiles is
 * more than one transaction can hold, and a rebuild that has to start over
 * after a timeout never finishes. Each profile's write is idempotent, so a
 * resumed or repeated run converges on the same result.
 *
 * Deleting stale summaries is gated behind `repair` because a stale summary is
 * ambiguous: it is either a leftover from the old projection or a profile this
 * page has not reached yet. Deleting on sight would erase live rows during a
 * partial run.
 */

export type RebuildProjectionOptions = {
  pageSize?: number;
  cursor?: string | null;
  repair?: boolean;
  now?: Date;
};

export type RebuildProjectionResult = {
  processed: number;
  written: number;
  skippedNonCanonical: number;
  repaired: number;
  cursor: string | null;
  hasMore: boolean;
  health: AccountingStudentFinanceProjectionHealthV3 | null;
};

const DEFAULT_PAGE_SIZE = 100;

type DocLike = { id: string; data: () => Record<string, unknown> | undefined };

async function readAliasedAwayIds(db: DocumentStore): Promise<Set<string>> {
  const snapshot = (await db.collection('student_profile_aliases').get()) as unknown as {
    docs?: DocLike[];
  };
  const aliased = new Set<string>();
  for (const doc of snapshot.docs ?? []) {
    if (isStudentProfileAlias(doc.data() || {})) aliased.add(doc.id);
  }
  return aliased;
}

export async function rebuildAccountingStudentFinanceProjections(
  db: DocumentStore,
  options: RebuildProjectionOptions = {}
): Promise<RebuildProjectionResult> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const now = options.now ?? new Date();
  const aliasedAway = await readAliasedAwayIds(db);

  let query = (db.collection('students') as never as {
    orderBy: (field: string) => never;
  }).orderBy('__name__') as never as {
    startAfter: (value: string) => never;
    limit: (n: number) => never;
    get: () => Promise<{ docs?: DocLike[] }>;
  };
  if (options.cursor) query = query.startAfter(options.cursor) as never;
  // One extra row answers "is there another page" without a second query.
  query = query.limit(pageSize + 1) as never;

  const docs = (await query.get()).docs ?? [];
  const hasMore = docs.length > pageSize;
  const page = docs.slice(0, pageSize);

  let written = 0;
  let skippedNonCanonical = 0;
  for (const doc of page) {
    const data = doc.data() || {};
    if (aliasedAway.has(doc.id) || !isCanonicalStudentProfile({ id: doc.id, ...data })) {
      skippedNonCanonical += 1;
      continue;
    }
    const summary = await buildAccountingStudentSummary(db, doc.id, now);
    await db
      .collection(ACCOUNTING_STUDENT_SUMMARIES_COLLECTION)
      .doc(doc.id)
      .set(summary as never, { merge: true });
    written += 1;
  }

  let repaired = 0;
  if (options.repair) {
    const summaries = (await db
      .collection(ACCOUNTING_STUDENT_SUMMARIES_COLLECTION)
      .get()) as unknown as { docs?: DocLike[] };
    let removableSummaryIds = aliasedAway;
    if (!hasMore) {
      const allStudents = (await db.collection('students').get()) as unknown as {
        docs?: DocLike[];
      };
      const canonicalIds = new Set(
        (allStudents.docs ?? [])
          .filter((student) => {
            const data = student.data() || {};
            return (
              !aliasedAway.has(student.id) &&
              isCanonicalStudentProfile({ id: student.id, ...data })
            );
          })
          .map((student) => student.id)
      );
      removableSummaryIds = new Set(
        (summaries.docs ?? [])
          .filter((summary) => !canonicalIds.has(summary.id))
          .map((summary) => summary.id)
      );
    }
    for (const summary of summaries.docs ?? []) {
      if (!removableSummaryIds.has(summary.id)) continue;
      // Before the final page, only a registered alias is unambiguously stale.
      // Once the walk is complete, every non-canonical or orphan summary is a
      // leftover derived row and can be pruned safely.
      await db.collection(ACCOUNTING_STUDENT_SUMMARIES_COLLECTION).doc(summary.id).delete();
      repaired += 1;
    }
  }

  const health = hasMore ? null : await computeProjectionHealth(db, aliasedAway, now);

  return {
    processed: page.length,
    written,
    skippedNonCanonical,
    repaired,
    cursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    hasMore,
    health,
  };
}

/**
 * Computed only on the final page: a health record from a partial walk would
 * report a rebuild in progress as a broken projection.
 */
async function computeProjectionHealth(
  db: DocumentStore,
  aliasedAway: Set<string>,
  now: Date
): Promise<AccountingStudentFinanceProjectionHealthV3> {
  const [studentSnap, summarySnap] = await Promise.all([
    db.collection('students').get() as unknown as Promise<{ docs?: DocLike[] }>,
    db.collection(ACCOUNTING_STUDENT_SUMMARIES_COLLECTION).get() as unknown as Promise<{
      docs?: DocLike[];
    }>,
  ]);

  const students = studentSnap.docs ?? [];
  const canonicalIds = new Set<string>();
  let tombstoneCount = 0;
  for (const doc of students) {
    const data = doc.data() || {};
    if (data.studentProfileState === 'merged_tombstone') tombstoneCount += 1;
    if (aliasedAway.has(doc.id) || !isCanonicalStudentProfile({ id: doc.id, ...data })) continue;
    canonicalIds.add(doc.id);
  }

  const summaries = summarySnap.docs ?? [];
  let aliasOrTombstoneSummaryCount = 0;
  let orphanSummaryCount = 0;
  const knownIds = new Set(students.map((doc) => doc.id));
  for (const summary of summaries) {
    if (aliasedAway.has(summary.id)) aliasOrTombstoneSummaryCount += 1;
    else if (!knownIds.has(summary.id)) orphanSummaryCount += 1;
    else if (!canonicalIds.has(summary.id)) aliasOrTombstoneSummaryCount += 1;
  }

  return buildAccountingProjectionHealth({
    eligibleCanonicalProfiles: canonicalIds.size,
    physicalStudentDocumentCount: students.length,
    canonicalProfileCount: canonicalIds.size,
    aliasCount: aliasedAway.size,
    tombstoneCount,
    summaryCount: summaries.length,
    aliasOrTombstoneSummaryCount,
    orphanSummaryCount,
    repairBacklog: aliasOrTombstoneSummaryCount + orphanSummaryCount,
    computedAt: now.toISOString(),
  });
}
