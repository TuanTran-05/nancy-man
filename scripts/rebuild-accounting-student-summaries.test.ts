import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  parseAccountingSummaryRebuildArgs,
  rebuildAllAccountingStudentSummaries,
  type FullSummaryRebuildDependencies,
  type SummaryRebuildResult,
} from './rebuild-accounting-student-summaries.js';

function page(overrides: Partial<SummaryRebuildResult>): SummaryRebuildResult {
  return {
    scanned: 0,
    rebuilt: 0,
    queued: 0,
    failed: 0,
    nextCursor: null,
    complete: true,
    pruned: 0,
    dryRun: false,
    ...overrides,
  };
}

describe('full accounting summary rebuild', () => {
  it('keeps health incomplete when an earlier page queued a repair', async () => {
    const calls: Array<{ cursor?: string; writeHealth?: boolean }> = [];
    const healthWrites: Array<Record<string, unknown>> = [];
    const pages = [
      page({ scanned: 100, rebuilt: 98, queued: 2, nextCursor: 'student-100', complete: false }),
      page({ scanned: 50, rebuilt: 50, queued: 0, nextCursor: null, complete: true }),
    ];
    const deps: FullSummaryRebuildDependencies = {
      rebuildPage: async (input) => {
        calls.push({ cursor: input.cursor, writeHealth: input.writeHealth });
        return pages.shift()!;
      },
      audit: async () => ({
        studentCount: 150,
        summaryCount: 150,
        missingStudentIds: [],
        orphanSummaryIds: [],
        staleSummaryIds: [],
        valid: true,
      }),
      writeHealth: async (_db, health) => {
        healthWrites.push(health);
      },
    };

    const result = await rebuildAllAccountingStudentSummaries({
      db: {} as DocumentStore,
      apply: true,
      batchSize: 100,
      deps,
    });

    expect(calls).toEqual([
      { cursor: undefined, writeHealth: false },
      { cursor: 'student-100', writeHealth: false },
    ]);
    expect(result).toEqual({
      pages: 2,
      scanned: 150,
      rebuilt: 148,
      queued: 2,
      failed: 0,
      pruned: 0,
      complete: false,
      dryRun: false,
      studentCount: 150,
      summaryCount: 150,
      missingStudentIds: [],
      orphanSummaryIds: [],
      staleSummaryIds: [],
      valid: true,
    });
    expect(healthWrites).toEqual([
      {
        studentCount: 150,
        summaryCount: 150,
        repairBacklog: 2,
        failedCount: 0,
        missingSummaryCount: 0,
        orphanSummaryCount: 0,
        staleSummaryCount: 0,
        complete: false,
      },
    ]);
  });

  it('marks health complete only when every page succeeds and counts match', async () => {
    const healthWrites: Array<Record<string, unknown>> = [];
    const deps: FullSummaryRebuildDependencies = {
      rebuildPage: async () => page({ scanned: 2, rebuilt: 2 }),
      audit: async () => ({
        studentCount: 2,
        summaryCount: 2,
        missingStudentIds: [],
        orphanSummaryIds: [],
        staleSummaryIds: [],
        valid: true,
      }),
      writeHealth: async (_db, health) => {
        healthWrites.push(health);
      },
    };
    const result = await rebuildAllAccountingStudentSummaries({
      db: {} as DocumentStore,
      apply: true,
      deps,
    });
    expect(result.complete).toBe(true);
    expect(result.queued).toBe(0);
    expect(healthWrites).toEqual([
      {
        studentCount: 2,
        summaryCount: 2,
        repairBacklog: 0,
        failedCount: 0,
        missingSummaryCount: 0,
        orphanSummaryCount: 0,
        staleSummaryCount: 0,
        complete: true,
      },
    ]);
  });

  it('does not write health during a dry-run', async () => {
    let wroteHealth = false;
    const deps: FullSummaryRebuildDependencies = {
      rebuildPage: async () => page({ scanned: 2, dryRun: true }),
      audit: async () => ({
        studentCount: 2,
        summaryCount: 2,
        missingStudentIds: [],
        orphanSummaryIds: [],
        staleSummaryIds: [],
        valid: true,
      }),
      writeHealth: async () => {
        wroteHealth = true;
      },
    };
    const result = await rebuildAllAccountingStudentSummaries({
      db: {} as DocumentStore,
      apply: false,
      deps,
    });
    expect(result).toMatchObject({ dryRun: true, complete: true });
    expect(wroteHealth).toBe(false);
  });

  it('keeps health incomplete when counts match but a summary source version is stale', async () => {
    const healthWrites: Array<Record<string, unknown>> = [];
    const deps: FullSummaryRebuildDependencies = {
      rebuildPage: async () => page({ scanned: 2, rebuilt: 2 }),
      audit: async () => ({
        studentCount: 2,
        summaryCount: 2,
        missingStudentIds: [],
        orphanSummaryIds: [],
        staleSummaryIds: ['student-2'],
        valid: false,
      }),
      writeHealth: async (_db, health) => {
        healthWrites.push(health);
      },
    };
    const result = await rebuildAllAccountingStudentSummaries({
      db: {} as DocumentStore,
      apply: true,
      deps,
    });
    expect(result.complete).toBe(false);
    expect(result.staleSummaryIds).toEqual(['student-2']);
    expect(healthWrites[0]).toMatchObject({ complete: false, staleSummaryCount: 1 });
  });
});

describe('accounting summary rebuild CLI arguments', () => {
  it('parses one-process full rebuild and rejects a cursor combination', () => {
    expect(
      parseAccountingSummaryRebuildArgs([
        '--apply',
        '--all',
        '--batch-size',
        '100',
        '--actor',
        'ops@edutrack',
      ])
    ).toEqual({
      apply: true,
      all: true,
      batchSize: 100,
      pruneOrphans: false,
      actor: 'ops@edutrack',
    });
    expect(() => parseAccountingSummaryRebuildArgs(['--all', '--cursor', 'student-100'])).toThrow(
      'ACCOUNTING_SUMMARY_ALL_CURSOR_CONFLICT'
    );
  });

  it('requires a named operator before it will write, and carries it as the actor', () => {
    expect(() => parseAccountingSummaryRebuildArgs(['--apply', '--all'])).toThrow(
      'ACCOUNTING_SUMMARY_ACTOR_REQUIRED'
    );
    expect(parseAccountingSummaryRebuildArgs(['--apply', '--all', '--actor', 'ops@edutrack']))
      .toMatchObject({ apply: true, actor: 'ops@edutrack' });
  });
});
