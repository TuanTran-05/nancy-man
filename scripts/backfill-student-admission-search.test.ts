import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  parseAdmissionSearchBackfillArgs,
  runAdmissionSearchBackfill,
} from './backfill-student-admission-search.js';

type FakeDoc = { id: string; value: Record<string, unknown> };
type Write = { id: string; patch: Record<string, unknown> };

function fakeDocumentStore(students: FakeDoc[]): { db: DocumentStore; writes: Write[]; commits: number } {
  const writes: Write[] = [];
  const state = { commits: 0 };
  const db = {
    collection() {
      return {
        async get() {
          return {
            docs: students.map((doc) => ({
              id: doc.id,
              data: () => structuredClone(doc.value),
              ref: { id: doc.id },
            })),
          };
        },
      };
    },
    batch() {
      return {
        update(ref: { id: string }, patch: Record<string, unknown>) {
          writes.push({ id: ref.id, patch });
        },
        async commit() {
          state.commits += 1;
        },
      };
    },
  };
  return {
    db: db as unknown as DocumentStore,
    writes,
    get commits() {
      return state.commits;
    },
  } as { db: DocumentStore; writes: Write[]; commits: number };
}

const complete = { name: 'Quách Hoàng Minh', dob: '2014-05-02', contact: '0900000000' };

const fixture: FakeDoc[] = [
  { id: 'cloned', value: { ...complete } },
  {
    id: 'stale',
    value: {
      ...complete,
      contact: '0911111111',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
    },
  },
  { id: 'no-dob', value: { name: 'A B', contact: '0900000000' } },
  { id: 'retired', value: { ...complete, mergedIntoStudentId: 'canonical-1' } },
];

describe('admission search backfill CLI arguments', () => {
  it('defaults to a dry run', () => {
    expect(parseAdmissionSearchBackfillArgs([])).toEqual({ apply: false, repairDrift: false });
  });

  it('rejects drift repair without an explicit apply', () => {
    expect(() => parseAdmissionSearchBackfillArgs(['--repair-drift'])).toThrow(
      'ADMISSION_SEARCH_BACKFILL_REPAIR_REQUIRES_APPLY'
    );
  });

  it('rejects unknown flags rather than ignoring them', () => {
    expect(() => parseAdmissionSearchBackfillArgs(['--aply'])).toThrow(
      'ADMISSION_SEARCH_BACKFILL_UNKNOWN_FLAG:--aply'
    );
  });
});

describe('admission search backfill run', () => {
  it('writes nothing during a dry run but still reports what it would do', async () => {
    const { db, writes } = fakeDocumentStore(fixture);

    const result = await runAdmissionSearchBackfill({ apply: false, repairDrift: false }, { db });

    expect(writes).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.plan.counts).toMatchObject({
      missing_fields: 1,
      drifted: 1,
      incomplete_source: 1,
      skipped_retired: 1,
    });
  });

  it('applies only additive missing-field patches by default', async () => {
    const { db, writes } = fakeDocumentStore(fixture);

    const result = await runAdmissionSearchBackfill({ apply: true, repairDrift: false }, { db });

    expect(writes).toEqual([
      {
        id: 'cloned',
        patch: {
          admissionSearchName: 'quach hoang minh',
          admissionSearchDob: '2014-05-02',
          admissionSearchContact: '84900000000',
        },
      },
    ]);
    expect(result.applied).toBe(1);
    expect(result.skippedDrift).toBe(1);
  });

  it('repairs stale denormalized values only when drift repair is requested', async () => {
    const { db, writes } = fakeDocumentStore(fixture);

    const result = await runAdmissionSearchBackfill({ apply: true, repairDrift: true }, { db });

    expect(writes.map((write) => write.id).sort()).toEqual(['cloned', 'stale']);
    expect(writes.find((write) => write.id === 'stale')?.patch).toEqual({
      admissionSearchContact: '84911111111',
    });
    expect(result.applied).toBe(2);
    expect(result.skippedDrift).toBe(0);
  });

  it('never writes to a retired profile or one whose source identity is incomplete', async () => {
    const { db, writes } = fakeDocumentStore(fixture);

    await runAdmissionSearchBackfill({ apply: true, repairDrift: true }, { db });

    expect(writes.map((write) => write.id)).not.toContain('retired');
    expect(writes.map((write) => write.id)).not.toContain('no-dob');
  });

  it('reports the residual coverage gap that the guard must treat as a known exclusion', async () => {
    const { db } = fakeDocumentStore(fixture);

    const result = await runAdmissionSearchBackfill({ apply: true, repairDrift: true }, { db });

    expect(result.plan.residualCoverageGapProfileIds).toEqual(['no-dob']);
    expect(result.coverageComplete).toBe(false);
  });

  it('does not call coverage complete while a stale value still blinds the guard', async () => {
    const staleOnly = [fixture[1]];
    const { db } = fakeDocumentStore(staleOnly);

    const unrepaired = await runAdmissionSearchBackfill({ apply: true, repairDrift: false }, { db });
    expect(unrepaired.coverageComplete).toBe(false);

    const repaired = await runAdmissionSearchBackfill({ apply: true, repairDrift: true }, { db });
    expect(repaired.coverageComplete).toBe(true);
  });

  it('does not call coverage complete for a dry run that wrote nothing', async () => {
    const { db } = fakeDocumentStore([fixture[0]]);

    const dry = await runAdmissionSearchBackfill({ apply: false, repairDrift: false }, { db });
    expect(dry.coverageComplete).toBe(false);

    const applied = await runAdmissionSearchBackfill({ apply: true, repairDrift: false }, { db });
    expect(applied.coverageComplete).toBe(true);
  });
});
