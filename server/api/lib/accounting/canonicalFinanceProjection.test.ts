import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_FINANCE_SOURCE_VERSION,
  buildAccountingProjectionHealth,
  isAccountingProjectionHealthIncomplete,
} from './studentFinanceProjectionRepository.js';

/**
 * The health record Workstream D reads before it will let anyone activate
 * `canonical_required`. Every counter is separate on purpose: "incomplete" is
 * useless to an operator who cannot see which of the four ways it is
 * incomplete.
 */
describe('accounting projection health', () => {
  const healthy = {
    eligibleCanonicalProfiles: 10,
    physicalStudentDocumentCount: 14,
    canonicalProfileCount: 10,
    aliasCount: 4,
    tombstoneCount: 4,
    summaryCount: 10,
    aliasOrTombstoneSummaryCount: 0,
    orphanSummaryCount: 0,
    repairBacklog: 0,
    computedAt: '2026-08-08T00:00:00.000Z',
  };

  it('is version 3, because version 2 counted physical documents', () => {
    expect(ACCOUNTING_FINANCE_SOURCE_VERSION).toBe(3);
  });

  it('is complete when every canonical profile has exactly one summary', () => {
    const health = buildAccountingProjectionHealth(healthy);
    expect(health).toMatchObject({ sourceVersion: 3, complete: true });
  });

  it('tolerates more physical documents than canonical profiles', () => {
    // Tombstones are retained deliberately, so the physical count exceeding
    // the canonical count is the expected steady state, not a fault.
    expect(buildAccountingProjectionHealth(healthy).physicalStudentDocumentCount).toBe(14);
    expect(buildAccountingProjectionHealth({ ...healthy, physicalStudentDocumentCount: 99 }))
      .toMatchObject({ complete: true });
  });

  it.each([
    ['a missing summary', { summaryCount: 9 }],
    ['a summary on an alias or tombstone', { aliasOrTombstoneSummaryCount: 1 }],
    ['a summary with no profile behind it', { orphanSummaryCount: 1 }],
    ['work still queued', { repairBacklog: 1 }],
  ])('is incomplete for %s', (_label, patch) => {
    expect(buildAccountingProjectionHealth({ ...healthy, ...patch }).complete).toBe(false);
  });

  it('is incomplete when there are more summaries than canonical profiles', () => {
    // Extra summaries mean one human is counted twice somewhere, which is the
    // exact fault this projection exists to remove.
    expect(buildAccountingProjectionHealth({ ...healthy, summaryCount: 11 }).complete).toBe(false);
  });

  it('ignores the legacy physical student count on a complete v3 health record', () => {
    const health = {
      ...buildAccountingProjectionHealth(healthy),
      // This field can survive the v2 -> v3 transition because the old writer
      // merged the singleton. It is observability only in v3.
      studentCount: 14,
    };

    expect(isAccountingProjectionHealthIncomplete(health)).toBe(false);
  });

  it.each([
    ['an old source version', { sourceVersion: 2 }],
    ['an explicit incomplete marker', { complete: false }],
    ['queued repairs', { repairBacklog: 1 }],
    ['a missing canonical summary', { summaryCount: 9 }],
    ['a summary on a retired profile', { aliasOrTombstoneSummaryCount: 1 }],
    ['an orphan summary', { orphanSummaryCount: 1 }],
  ])('keeps the workspace warning for %s', (_label, patch) => {
    const health = { ...buildAccountingProjectionHealth(healthy), ...patch };
    expect(isAccountingProjectionHealthIncomplete(health)).toBe(true);
  });
});
