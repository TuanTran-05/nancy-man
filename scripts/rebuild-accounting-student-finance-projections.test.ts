import { describe, expect, it } from 'vitest';
import { rebuildAccountingStudentFinanceProjections } from './rebuild-accounting-student-finance-projections.js';
import { createInMemoryDocumentStore } from '../test-utils/inMemoryDocumentStore.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';

type Seed = Record<string, Record<string, unknown>>;

function profile(id: string, overrides: Record<string, unknown> = {}): Seed {
  return {
    [`students/${id}`]: {
      name: `Học sinh ${id}`,
      studentId: id.toUpperCase(),
      studentLifecycle: 'enrolled',
      ...overrides,
    },
  };
}

function enrollment(profileId: string, classId = 'class-g7', termStart = '2026-07-01'): Seed {
  const id = makeStudentCourseEnrollmentId(profileId, classId, termStart);
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart,
      termEnd: '2026-12-31',
      status: 'active',
      joinedAt: termStart,
      endedAt: null,
      statusReason: null,
      source: 'system',
      confidence: 'confirmed',
      statusChangedAt: `${termStart}T00:00:00.000Z`,
      statusChangedBy: 'seed',
      confirmedAt: `${termStart}T00:00:00.000Z`,
      confirmedBy: 'seed',
      createdAt: `${termStart}T00:00:00.000Z`,
      updatedAt: `${termStart}T00:00:00.000Z`,
    },
  };
}

function alias(legacyId: string, canonicalId: string): Seed {
  return {
    [`student_profile_aliases/${legacyId}`]: {
      legacyProfileId: legacyId,
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: 't',
      createdBy: 'merge',
    },
  };
}

const NOW = new Date('2026-08-08T00:00:00.000Z');

function summaryIds(store: Map<string, Record<string, unknown>>): string[] {
  return [...store.keys()]
    .filter((path) => path.startsWith('accounting_student_summaries/'))
    .map((path) => path.split('/')[1])
    .sort();
}

describe('rebuildAccountingStudentFinanceProjections', () => {
  it('writes one summary per canonical profile and none for the retired twin', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...profile('canonical-1'),
      ...enrollment('canonical-1'),
      ...profile('legacy-1'),
      ...alias('legacy-1', 'canonical-1'),
      ...profile('solo'),
      ...enrollment('solo', 'class-g6'),
    });

    const result = await rebuildAccountingStudentFinanceProjections(db, { now: NOW });

    expect(summaryIds(store)).toEqual(['canonical-1', 'solo']);
    expect(result).toMatchObject({ written: 2, skippedNonCanonical: 1, hasMore: false });
  });

  it('skips a tombstone rather than projecting an empty wallet for it', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...profile('canonical-1'),
      ...enrollment('canonical-1'),
      ...profile('legacy-1', {
        studentProfileState: 'merged_tombstone',
        canonicalProfileId: 'canonical-1',
      }),
    });

    await rebuildAccountingStudentFinanceProjections(db, { now: NOW });

    expect(summaryIds(store)).toEqual(['canonical-1']);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const seed = { ...profile('canonical-1'), ...enrollment('canonical-1') };
    const { db, store } = createInMemoryDocumentStore(seed);

    await rebuildAccountingStudentFinanceProjections(db, { now: NOW });
    const afterFirst = JSON.stringify(store.get('accounting_student_summaries/canonical-1'));
    await rebuildAccountingStudentFinanceProjections(db, { now: NOW });

    expect(JSON.stringify(store.get('accounting_student_summaries/canonical-1'))).toBe(afterFirst);
    expect(summaryIds(store)).toEqual(['canonical-1']);
  });

  it('resumes from a cursor without redoing or skipping a profile', async () => {
    const seed: Seed = {};
    for (const id of ['p-a', 'p-b', 'p-c']) Object.assign(seed, profile(id), enrollment(id));
    const { db, store } = createInMemoryDocumentStore(seed);

    const first = await rebuildAccountingStudentFinanceProjections(db, { pageSize: 2, now: NOW });
    expect(first).toMatchObject({ processed: 2, hasMore: true, cursor: 'p-b' });
    expect(first.health).toBeNull();

    const second = await rebuildAccountingStudentFinanceProjections(db, {
      pageSize: 2,
      cursor: first.cursor,
      now: NOW,
    });

    expect(second).toMatchObject({ processed: 1, hasMore: false });
    expect(summaryIds(store)).toEqual(['p-a', 'p-b', 'p-c']);
  });

  it('reports health only on the final page', async () => {
    // A health record computed mid-walk would describe a rebuild in progress
    // as a broken projection, and Workstream D reads this to decide whether
    // canonical_required may be activated.
    const seed: Seed = {};
    for (const id of ['p-a', 'p-b']) Object.assign(seed, profile(id), enrollment(id));
    const { db } = createInMemoryDocumentStore(seed);

    const page = await rebuildAccountingStudentFinanceProjections(db, { pageSize: 1, now: NOW });
    expect(page.health).toBeNull();

    const last = await rebuildAccountingStudentFinanceProjections(db, {
      pageSize: 1,
      cursor: page.cursor,
      now: NOW,
    });
    expect(last.health).toMatchObject({
      sourceVersion: 3,
      eligibleCanonicalProfiles: 2,
      summaryCount: 2,
      complete: true,
    });
  });

  it('leaves a stale alias summary alone until repair is asked for', async () => {
    // Ambiguous on sight: it is either a leftover from the old projection or a
    // profile this page has not reached. Deleting it during a partial run would
    // erase a live row.
    const seed = {
      ...profile('canonical-1'),
      ...enrollment('canonical-1'),
      ...profile('legacy-1'),
      ...alias('legacy-1', 'canonical-1'),
      'accounting_student_summaries/legacy-1': { studentId: 'legacy-1', sourceVersion: 2 },
    };

    const plain = createInMemoryDocumentStore(seed);
    const observed = await rebuildAccountingStudentFinanceProjections(plain.db, { now: NOW });
    expect(summaryIds(plain.store)).toEqual(['canonical-1', 'legacy-1']);
    expect(observed.health).toMatchObject({ aliasOrTombstoneSummaryCount: 1, complete: false });

    const repairing = createInMemoryDocumentStore(seed);
    const repaired = await rebuildAccountingStudentFinanceProjections(repairing.db, {
      repair: true,
      now: NOW,
    });
    expect(summaryIds(repairing.store)).toEqual(['canonical-1']);
    expect(repaired).toMatchObject({ repaired: 1 });
    expect(repaired.health).toMatchObject({ complete: true });
  });

  it('prunes legacy soft-merge and orphan summaries after the final page', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...profile('canonical-1'),
      ...enrollment('canonical-1'),
      ...profile('legacy-1', { mergedIntoStudentId: 'canonical-1' }),
      'accounting_student_summaries/legacy-1': {
        studentId: 'legacy-1',
        sourceVersion: 2,
      },
      'accounting_student_summaries/orphan-1': {
        studentId: 'orphan-1',
        sourceVersion: 2,
      },
    });

    const repaired = await rebuildAccountingStudentFinanceProjections(db, {
      repair: true,
      now: NOW,
    });

    expect(summaryIds(store)).toEqual(['canonical-1']);
    expect(repaired).toMatchObject({ repaired: 2, hasMore: false });
    expect(repaired.health).toMatchObject({
      eligibleCanonicalProfiles: 1,
      summaryCount: 1,
      complete: true,
    });
  });
});
