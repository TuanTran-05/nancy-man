import { describe, expect, it } from 'vitest';
import {
  readConsecutiveGreenStudentIdentityAudits,
  writeStudentIdentityHealthReport,
} from './studentIdentityHealthRepository.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import type { StudentIdentityHealthReport } from './studentIdentityHealthTypes.js';

/**
 * The green streak decides when tombstones and credentials may be deleted.
 * That is the one irreversible step in the whole program, so the records it
 * counts have to be impossible to rewrite after the fact: a red day that
 * quietly becomes green later is exactly how a center deletes data it still
 * needed.
 */

function report(overrides: Partial<StudentIdentityHealthReport> = {}): StudentIdentityHealthReport {
  const digest = String(overrides.digest || 'a'.repeat(64));
  return {
    schemaVersion: 2,
    auditId: `${overrides.vietnamDate || '2026-08-09'}_daily_${digest.slice(0, 12)}`,
    mode: 'daily',
    target: { projectId: 'edutrack', databaseId: '(default)' },
    runId: null,
    planDigest: null,
    approvalDigest: null,
    sourceCommitSha: 'abc1234',
    exportOperationId: null,
    canonicalReadMode: 'legacy_compare',
    startedAt: '2026-08-09T10:00:00.000Z',
    checkedAt: '2026-08-09T10:00:00.000Z',
    vietnamDate: '2026-08-09',
    status: 'green',
    counts: {} as never,
    operationCounts: { planned: 0, applied: 0, verified: 0, failed: 0 },
    pendingJobs: {} as never,
    projectionHealth: {} as never,
    invariants: {
      aliasesOneHopAndAcyclic: true,
      monetaryTotalsMatchReviewedPlan: null,
      projectionRebuildComplete: true,
      authenticationPathsCanonical: true,
    },
    blockers: [],
    sources: {},
    digest,
    ...overrides,
  };
}

function markerPath(date: string) {
  return `student_identity_health/daily_${date}`;
}

describe('writeStudentIdentityHealthReport', () => {
  it('stores the full report immutably and points `current` at it', async () => {
    const { db, store } = createInMemoryDocumentStore({});
    const record = report();

    await writeStudentIdentityHealthReport(db, record);

    expect(store.get(`student_identity_health_runs/${record.auditId}`)?.digest).toBe(record.digest);
    expect(store.get('student_identity_health/current')?.auditId).toBe(record.auditId);
    expect(store.get(markerPath('2026-08-09'))?.status).toBe('green');
  });

  it('is an idempotent success when the same audit is written twice', async () => {
    // Cron retries. A retry that failed would page somebody for a job that
    // already did its work.
    const { db } = createInMemoryDocumentStore({});
    const record = report();

    await writeStudentIdentityHealthReport(db, record);
    const second = await writeStudentIdentityHealthReport(db, record);

    expect(second.markerOutcome).toBe('unchanged');
    expect(second.conflict).toBeNull();
  });

  it('never lets a red day become green later that day', async () => {
    // This is the whole point. The streak gates deletion, and a day that was
    // red is a day the data was not safe, whatever a later run says.
    const { db, store } = createInMemoryDocumentStore({});
    const red = report({ status: 'red', digest: 'b'.repeat(64), blockers: [{ code: 'X', detail: 'x' }] });
    const green = report({ status: 'green', digest: 'c'.repeat(64) });

    await writeStudentIdentityHealthReport(db, red);
    const outcome = await writeStudentIdentityHealthReport(db, green);

    expect(store.get(markerPath('2026-08-09'))?.status).toBe('red');
    expect(outcome.markerOutcome).toBe('conflict');
  });

  it('records a conflict alert rather than losing the disagreement', async () => {
    const { db, store } = createInMemoryDocumentStore({});
    await writeStudentIdentityHealthReport(db, report({ digest: 'b'.repeat(64) }));
    const outcome = await writeStudentIdentityHealthReport(db, report({ digest: 'c'.repeat(64) }));

    expect(outcome.conflict).not.toBeNull();
    const conflictPaths = [...store.keys()].filter((path) =>
      path.startsWith('student_identity_health_conflicts/')
    );
    expect(conflictPaths).toHaveLength(1);
  });

  it('deduplicates a repeated conflict instead of alerting on every retry', async () => {
    const { db, store } = createInMemoryDocumentStore({});
    await writeStudentIdentityHealthReport(db, report({ digest: 'b'.repeat(64) }));
    await writeStudentIdentityHealthReport(db, report({ digest: 'c'.repeat(64) }));
    await writeStudentIdentityHealthReport(db, report({ digest: 'c'.repeat(64) }));

    const conflictPaths = [...store.keys()].filter((path) =>
      path.startsWith('student_identity_health_conflicts/')
    );
    expect(conflictPaths).toHaveLength(1);
  });

  it('files a cutover audit under its run rather than as a day', async () => {
    // A cutover audit is evidence about one run, not about a calendar day, and
    // counting it toward the streak would let a maintenance window substitute
    // for a day of normal operation.
    const { db, store } = createInMemoryDocumentStore({});
    const record = report({ mode: 'cutover', runId: 'run-1', digest: 'd'.repeat(64) });

    await writeStudentIdentityHealthReport(db, record);

    expect(store.has('student_identity_health/cutover_run-1')).toBe(true);
    expect(store.has(markerPath('2026-08-09'))).toBe(false);
  });

  it('stores no name, contact, or credential material', async () => {
    const { db, store } = createInMemoryDocumentStore({});
    await writeStudentIdentityHealthReport(db, report());

    const serialized = JSON.stringify([...store.values()]);
    expect(serialized).not.toContain('contact');
    expect(serialized).not.toContain('password');
  });
});

describe('readConsecutiveGreenStudentIdentityAudits', () => {
  async function seedDays(entries: Array<{ date: string; status: 'green' | 'red'; mode?: string }>) {
    const { db } = createInMemoryDocumentStore({});
    for (const entry of entries) {
      await writeStudentIdentityHealthReport(
        db,
        report({
          vietnamDate: entry.date,
          status: entry.status,
          mode: (entry.mode ?? 'daily') as never,
          runId: entry.mode === 'cutover' ? `run-${entry.date}` : null,
          digest: `${entry.date}`.padEnd(64, '0'),
          auditId: `${entry.date}_${entry.mode ?? 'daily'}`,
          blockers: entry.status === 'red' ? [{ code: 'X', detail: 'x' }] : [],
        })
      );
    }
    return db;
  }

  const week = [
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
    '2026-08-08',
    '2026-08-09',
  ];

  it('accepts seven consecutive green days ending on the requested date', async () => {
    const db = await seedDays(week.map((date) => ({ date, status: 'green' as const })));

    const streak = await readConsecutiveGreenStudentIdentityAudits({
      db,
      endingVietnamDate: '2026-08-09',
      requiredDays: 7,
    });

    expect(streak.valid).toBe(true);
    expect(streak.auditIds).toHaveLength(7);
    expect(streak.missingDates).toEqual([]);
  });

  it('rejects a week with a gap, however many green documents exist', async () => {
    // Seven green records is not seven green days. A missing day is a day
    // nobody checked, which is not evidence that anything was healthy.
    const db = await seedDays(
      ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-08', '2026-08-09'].map(
        (date) => ({ date, status: 'green' as const })
      )
    );

    const streak = await readConsecutiveGreenStudentIdentityAudits({
      db,
      endingVietnamDate: '2026-08-09',
      requiredDays: 7,
    });

    expect(streak.valid).toBe(false);
    expect(streak.missingDates).toContain('2026-08-07');
  });

  it('rejects the streak when any day in it was red', async () => {
    const db = await seedDays(
      week.map((date) => ({ date, status: date === '2026-08-06' ? 'red' : 'green' }))
    );

    const streak = await readConsecutiveGreenStudentIdentityAudits({
      db,
      endingVietnamDate: '2026-08-09',
      requiredDays: 7,
    });

    expect(streak.valid).toBe(false);
  });

  it('does not let a cutover audit stand in for a daily one', async () => {
    const db = await seedDays([
      ...week.slice(0, 6).map((date) => ({ date, status: 'green' as const })),
      { date: '2026-08-09', status: 'green', mode: 'cutover' },
    ]);

    const streak = await readConsecutiveGreenStudentIdentityAudits({
      db,
      endingVietnamDate: '2026-08-09',
      requiredDays: 7,
    });

    expect(streak.valid).toBe(false);
    expect(streak.missingDates).toContain('2026-08-09');
  });

  it('must end on the requested date, not merely include it', async () => {
    const db = await seedDays(week.map((date) => ({ date, status: 'green' as const })));

    const streak = await readConsecutiveGreenStudentIdentityAudits({
      db,
      endingVietnamDate: '2026-08-10',
      requiredDays: 7,
    });

    expect(streak.valid).toBe(false);
    expect(streak.missingDates).toContain('2026-08-10');
  });
});

describe('writeStudentIdentityHealthReport keeps a stored run immutable', () => {
  it('refuses to replace a stored run whose audit id already holds different evidence', async () => {
    const { db } = createInMemoryDocumentStore({});
    const first = report({ status: 'red', digest: 'c'.repeat(64) });
    await writeStudentIdentityHealthReport(db, first);

    // Same audit id, different verdict. Nothing may make the stored record say
    // the day was green after the fact.
    const forged = report({ status: 'green', digest: 'd'.repeat(64) });
    const outcome = await writeStudentIdentityHealthReport(db, {
      ...forged,
      auditId: first.auditId,
    });

    expect(outcome.runOutcome).toBe('conflict');
    const reader = db as never as {
      collection: (name: string) => {
        doc: (id: string) => { get: () => Promise<{ data: () => unknown }> };
      };
    };
    const stored = await reader.collection('student_identity_health_runs').doc(first.auditId).get();
    expect(stored.data()).toMatchObject({ status: 'red', digest: 'c'.repeat(64) });
  });

  it('treats an identical re-write of the same run as unchanged', async () => {
    const { db } = createInMemoryDocumentStore({});
    const only = report({ digest: 'e'.repeat(64) });
    await writeStudentIdentityHealthReport(db, only);

    const outcome = await writeStudentIdentityHealthReport(db, only);
    expect(outcome.runOutcome).toBe('unchanged');
  });
});
