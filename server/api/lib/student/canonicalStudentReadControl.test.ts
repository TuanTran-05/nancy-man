import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertCanonicalStudentReadModeActivatable,
  buildCanonicalReadDiscrepancy,
  getBootstrapCanonicalStudentReadMode,
  readCanonicalStudentReadControl,
  resetCanonicalStudentReadControlCacheForTests,
  shouldWriteLegacyStudentProjections,
  STUDENT_IDENTITY_READ_MODEL_PATH,
  transitionCanonicalStudentReadMode,
} from './canonicalStudentReadControl.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../maintenance/studentIdentityMaintenance.js';

function makeDb(record?: Record<string, unknown>, options: { throws?: boolean } = {}) {
  return {
    doc: (path: string) => ({
      path,
      get: async () => {
        if (options.throws) throw new Error('documentStore unavailable');
        return { exists: record !== undefined, data: () => record };
      },
    }),
  } as never;
}

const VALID = {
  schemaVersion: 1,
  mode: 'canonical_preferred',
  generation: 4,
  activatedAt: '2026-08-08T00:00:00.000Z',
  activatedBy: 'admin:tt',
  normalizationRunId: 'run-1',
  planDigest: 'a'.repeat(64),
  approvalDigest: 'b'.repeat(64),
};

describe('bootstrap mode', () => {
  it('defaults to legacy_compare when nothing is configured', () => {
    expect(getBootstrapCanonicalStudentReadMode({})).toBe('legacy_compare');
  });

  it.each(['legacy_compare', 'canonical_preferred'])('accepts %s from the environment', (mode) => {
    expect(getBootstrapCanonicalStudentReadMode({ CANONICAL_STUDENT_READ_MODE: mode })).toBe(mode);
  });

  it('refuses to bootstrap straight into canonical_required', () => {
    // Required mode rejects any profile whose canonical relationships are
    // incomplete. Reaching it from an environment variable on a cold deploy
    // would mean the strictest mode activates with nobody having checked the
    // blocker count -- that transition belongs to Workstream D's audited CLI.
    expect(
      getBootstrapCanonicalStudentReadMode({ CANONICAL_STUDENT_READ_MODE: 'canonical_required' })
    ).toBe('legacy_compare');
  });

  it('ignores an unrecognised value rather than guessing', () => {
    expect(getBootstrapCanonicalStudentReadMode({ CANONICAL_STUDENT_READ_MODE: 'canonical' })).toBe(
      'legacy_compare'
    );
  });
});

describe('readCanonicalStudentReadControl', () => {
  beforeEach(() => resetCanonicalStudentReadControlCacheForTests());
  afterEach(() => {
    delete process.env.CANONICAL_STUDENT_READ_MODE;
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('returns the stored record when it is well formed', async () => {
    const control = await readCanonicalStudentReadControl(makeDb(VALID));

    expect(control).toMatchObject({ mode: 'canonical_preferred', generation: 4 });
  });

  it('reads the control document from the maintenance path', async () => {
    const paths: string[] = [];
    const db = {
      doc: (path: string) => {
        paths.push(path);
        return { path, get: async () => ({ exists: true, data: () => VALID }) };
      },
    } as never;

    await readCanonicalStudentReadControl(db);

    expect(paths).toEqual([STUDENT_IDENTITY_READ_MODEL_PATH]);
  });

  it('falls back to the environment bootstrap only while the document is absent', async () => {
    process.env.CANONICAL_STUDENT_READ_MODE = 'canonical_preferred';

    const control = await readCanonicalStudentReadControl(makeDb(undefined));

    expect(control).toMatchObject({ mode: 'canonical_preferred', generation: 0 });
  });

  it('ignores environment drift once the document exists', async () => {
    // The document is the cutover switch. If an env var could still override
    // it, a redeploy with a stale value would silently roll the mode back.
    process.env.CANONICAL_STUDENT_READ_MODE = 'canonical_preferred';

    const control = await readCanonicalStudentReadControl(
      makeDb({ ...VALID, mode: 'legacy_compare' })
    );

    expect(control.mode).toBe('legacy_compare');
  });

  it.each([
    ['an unknown mode', { ...VALID, mode: 'canonical' }],
    ['a future schema version', { ...VALID, schemaVersion: 2 }],
    ['a missing generation', { ...VALID, generation: undefined }],
    ['a non-object', 'nonsense'],
  ])('fails closed to legacy_compare on %s', async (_label, record) => {
    const control = await readCanonicalStudentReadControl(makeDb(record as never));

    expect(control.mode).toBe('legacy_compare');
    expect(control.malformed).toBe(true);
  });

  it('fails closed to legacy_compare when DocumentStore is unavailable', async () => {
    const control = await readCanonicalStudentReadControl(makeDb(undefined, { throws: true }));

    expect(control.mode).toBe('legacy_compare');
  });

  it('never rolls back to a weaker mode after a stricter one has been observed', async () => {
    // A malformed or unreadable document mid-rollout must not quietly reopen
    // the legacy path for a process that has already served canonical reads.
    await readCanonicalStudentReadControl(makeDb({ ...VALID, mode: 'canonical_required' }));

    const control = await readCanonicalStudentReadControl(makeDb(undefined, { throws: true }));

    expect(control.mode).toBe('canonical_required');
    expect(control.degraded).toBe(true);
  });

  it('accepts a forward generation but refuses to go backwards', async () => {
    await readCanonicalStudentReadControl(makeDb({ ...VALID, generation: 7 }));

    const rolledBack = await readCanonicalStudentReadControl(
      makeDb({ ...VALID, generation: 3, mode: 'legacy_compare' })
    );

    expect(rolledBack.mode).toBe('canonical_preferred');
    expect(rolledBack.generation).toBe(7);
  });
});

describe('legacy projection write policy', () => {
  it.each([
    ['legacy_compare', true],
    ['canonical_preferred', true],
    ['canonical_required', false],
  ] as const)('writes legacy projections in %s: %s', (mode, expected) => {
    expect(shouldWriteLegacyStudentProjections(mode)).toBe(expected);
  });
});

describe('required-mode activation', () => {
  it('activates when nothing is blocking', () => {
    expect(() =>
      assertCanonicalStudentReadModeActivatable('canonical_required', {
        requiredModeBlockerCount: 0,
        sameHumanHoldCount: 0,
        unresolvedDifferentCodeCandidateCount: 0,
        quarantinedProfileCount: 0,
        evaluatedAt: '2026-08-08T00:00:00.000Z',
      })
    ).not.toThrow();
  });

  it.each([
    'requiredModeBlockerCount',
    'sameHumanHoldCount',
    'unresolvedDifferentCodeCandidateCount',
    'quarantinedProfileCount',
  ])('refuses activation while %s is non-zero', (field) => {
    expect(() =>
      assertCanonicalStudentReadModeActivatable('canonical_required', {
        requiredModeBlockerCount: 0,
        sameHumanHoldCount: 0,
        unresolvedDifferentCodeCandidateCount: 0,
        quarantinedProfileCount: 0,
        evaluatedAt: '2026-08-08T00:00:00.000Z',
        [field]: 1,
      } as never)
    ).toThrow('CANONICAL_READ_REQUIRED_MODE_BLOCKED');
  });

  it('does not gate the weaker modes on the blocker count', () => {
    // legacy_compare and canonical_preferred are how the blockers get found in
    // the first place; gating them on zero blockers would be circular.
    for (const mode of ['legacy_compare', 'canonical_preferred'] as const) {
      expect(() =>
        assertCanonicalStudentReadModeActivatable(mode, {
          requiredModeBlockerCount: 12,
          sameHumanHoldCount: 3,
          unresolvedDifferentCodeCandidateCount: 5,
          quarantinedProfileCount: 1,
          evaluatedAt: '2026-08-08T00:00:00.000Z',
        })
      ).not.toThrow();
    }
  });
});

describe('discrepancy records', () => {
  it('carries only ids, counts, and a reason code', () => {
    const record = buildCanonicalReadDiscrepancy({
      surface: 'wallet_balances',
      reasonCode: 'LEGACY_PHYSICAL_DUPLICATE',
      canonicalProfileIds: ['canonical-1'],
      legacyProfileIds: ['legacy-1', 'canonical-1'],
      legacyCount: 2,
      canonicalCount: 1,
    });

    expect(record).toEqual({
      surface: 'wallet_balances',
      reasonCode: 'LEGACY_PHYSICAL_DUPLICATE',
      canonicalProfileIds: ['canonical-1'],
      legacyProfileIds: ['canonical-1', 'legacy-1'],
      legacyCount: 2,
      canonicalCount: 1,
    });
  });

  it('refuses to carry anything that could be student data', () => {
    // Discrepancies are logged in bulk during legacy_compare. A name, a phone
    // number, or a credential fingerprint reaching a log line is a data leak
    // that no amount of later redaction undoes.
    expect(() =>
      buildCanonicalReadDiscrepancy({
        surface: 'wallet_balances',
        reasonCode: 'LEGACY_PHYSICAL_DUPLICATE',
        canonicalProfileIds: ['canonical-1'],
        legacyProfileIds: ['legacy-1'],
        legacyCount: 2,
        canonicalCount: 1,
        name: 'Quách Hoàng Minh',
      } as never)
    ).toThrow('CANONICAL_READ_DISCREPANCY_FIELD_FORBIDDEN');
  });
});

describe('transitionCanonicalStudentReadMode', () => {
  const PLAN = 'p'.repeat(64);
  const APPROVAL = 'q'.repeat(64);
  const READY = {
    requiredModeBlockerCount: 0,
    sameHumanHoldCount: 0,
    unresolvedDifferentCodeCandidateCount: 0,
    quarantinedProfileCount: 0,
    evaluatedAt: '2026-08-09T10:00:00.000Z',
  };

  function control(mode: string, generation: number) {
    return {
      [STUDENT_IDENTITY_READ_MODEL_PATH]: {
        schemaVersion: 1,
        mode,
        generation,
        activatedAt: '2026-08-09T09:00:00.000Z',
        activatedBy: 'operator',
        normalizationRunId: null,
        planDigest: null,
        approvalDigest: null,
      },
    };
  }

  function window(mode: 'normal' | 'read_only', runId = 'run-1') {
    return {
      '_maintenance/student_identity': {
        mode,
        activeRunId: mode === 'read_only' ? runId : null,
        migrationActorId: mode === 'read_only' ? 'migration' : null,
        updatedAt: '2026-08-09T09:00:00.000Z',
        updatedBy: 'operator',
      },
    };
  }

  const base = {
    runId: 'run-1',
    actorId: 'migration',
    planDigest: PLAN,
    approvalDigest: APPROVAL,
  };

  it('advances the generation so a concurrent transition loses', async () => {
    // Two operators who both read `canonical_preferred` would otherwise each
    // believe they performed the switch, and only one of them checked the
    // blocker count that mattered.
    const { db } = createInMemoryDocumentStore({ ...control('legacy_compare', 3) });

    const next = await transitionCanonicalStudentReadMode(db, {
      ...base,
      expectedMode: 'legacy_compare',
      targetMode: 'canonical_preferred',
      expectedGeneration: 3,
    });

    expect(next).toMatchObject({ mode: 'canonical_preferred', generation: 4 });
  });

  it('refuses when the served mode is not the one the operator believed', async () => {
    const { db } = createInMemoryDocumentStore({ ...control('canonical_preferred', 4) });

    await expect(
      transitionCanonicalStudentReadMode(db, {
        ...base,
        expectedMode: 'legacy_compare',
        targetMode: 'canonical_preferred',
        expectedGeneration: 4,
      })
    ).rejects.toThrow('CANONICAL_READ_MODE_UNEXPECTED');
  });

  it('refuses a stale generation', async () => {
    const { db } = createInMemoryDocumentStore({ ...control('legacy_compare', 5) });

    await expect(
      transitionCanonicalStudentReadMode(db, {
        ...base,
        expectedMode: 'legacy_compare',
        targetMode: 'canonical_preferred',
        expectedGeneration: 3,
      })
    ).rejects.toThrow('CANONICAL_READ_GENERATION_UNEXPECTED');
  });

  it('refuses canonical_required while any blocker remains', async () => {
    const { db } = createInMemoryDocumentStore({
      ...control('canonical_preferred', 4),
      ...window('read_only'),
      'student_profile_merge_runs/run-1': {
        runId: 'run-1',
        planDigest: PLAN,
        approvalDigest: APPROVAL,
      },
    });

    await expect(
      transitionCanonicalStudentReadMode(db, {
        ...base,
        expectedMode: 'canonical_preferred',
        targetMode: 'canonical_required',
        expectedGeneration: 4,
        readiness: { ...READY, requiredModeBlockerCount: 2 },
      })
    ).rejects.toThrow('CANONICAL_READ_REQUIRED_MODE_BLOCKED');
  });

  it('refuses canonical_required with no readiness evidence at all', async () => {
    const { db } = createInMemoryDocumentStore({
      ...control('canonical_preferred', 4),
      ...window('read_only'),
      'student_profile_merge_runs/run-1': {
        runId: 'run-1',
        planDigest: PLAN,
        approvalDigest: APPROVAL,
      },
    });

    await expect(
      transitionCanonicalStudentReadMode(db, {
        ...base,
        expectedMode: 'canonical_preferred',
        targetMode: 'canonical_required',
        expectedGeneration: 4,
      })
    ).rejects.toThrow('CANONICAL_READ_REQUIRED_MODE_BLOCKED');
  });

  it('refuses canonical_required outside a maintenance window for the same run', async () => {
    // That mode refuses any profile whose canonical relationships are
    // incomplete, so switching into it while the center serves traffic turns
    // an ordinary read into an error for whoever is on the page.
    const { db } = createInMemoryDocumentStore({
      ...control('canonical_preferred', 4),
      ...window('normal'),
      'student_profile_merge_runs/run-1': {
        runId: 'run-1',
        planDigest: PLAN,
        approvalDigest: APPROVAL,
      },
    });

    await expect(
      transitionCanonicalStudentReadMode(db, {
        ...base,
        expectedMode: 'canonical_preferred',
        targetMode: 'canonical_required',
        expectedGeneration: 4,
        readiness: READY,
      })
    ).rejects.toThrow('CANONICAL_READ_REQUIRED_MODE_NEEDS_MAINTENANCE');
  });

  it('activates canonical_required inside the window that owns the run', async () => {
    const { db } = createInMemoryDocumentStore({
      ...control('canonical_preferred', 4),
      ...window('read_only'),
      'student_profile_merge_runs/run-1': {
        runId: 'run-1',
        planDigest: PLAN,
        approvalDigest: APPROVAL,
      },
    });

    const next = await transitionCanonicalStudentReadMode(db, {
      ...base,
      expectedMode: 'canonical_preferred',
      targetMode: 'canonical_required',
      expectedGeneration: 4,
      readiness: READY,
    });

    expect(next).toMatchObject({
      mode: 'canonical_required',
      generation: 5,
      normalizationRunId: 'run-1',
    });
  });

  it('lets a pre-release rollback restore the run\u2019s prior mode', async () => {
    const { db } = createInMemoryDocumentStore({
      ...control('canonical_required', 5),
      ...window('read_only'),
    });

    const next = await transitionCanonicalStudentReadMode(db, {
      ...base,
      expectedMode: 'canonical_required',
      targetMode: 'canonical_preferred',
      expectedGeneration: 5,
    });

    expect(next).toMatchObject({ mode: 'canonical_preferred', generation: 6 });
  });
});
