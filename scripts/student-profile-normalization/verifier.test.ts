import { describe, expect, it } from 'vitest';
import { verifyStudentProfileNormalization } from './verifier.js';

function input(overrides: Record<string, unknown> = {}) {
  const base = {
    runId: 'run-1',
    plannedOperationCount: 2,
    journal: [
      { runId: 'run-1', operationId: 'op-1', groupId: 'g-1', stage: 'move_finance_keys', status: 'applied' },
      { runId: 'run-1', operationId: 'op-2', groupId: 'g-1', stage: 'tombstone_legacy', status: 'applied' },
    ],
    observations: {
      profiles: [
        {
          id: 'canonical-1',
          name: 'Quách Hoàng Minh',
          dob: '2014-05-02',
          contact: '0900000000',
          admissionSearchName: 'quach hoang minh',
          admissionSearchDob: '2014-05-02',
          // normalizePhoneVN turns 0900000000 into 84900000000; using the raw
          // form here would be exactly the stale value the blocker catches.
          admissionSearchContact: '84900000000',
        },
        {
          id: 'legacy-1',
          studentProfileState: 'merged_tombstone',
          name: 'Quách Hoàng Minh',
          dob: '2014-05-02',
          contact: '0900000000',
        },
      ],
      aliases: [{ legacyProfileId: 'legacy-1', canonicalProfileId: 'canonical-1' }],
      codeOwners: [{ code: 'HS260167', profileId: 'canonical-1' }],
      mutableLegacyReferences: [],
      unknownReferences: [],
      openEnrollmentCountByProfile: { 'canonical-1': 1 },
      aliasOwnedUserIds: [],
      aliasOwnedCredentialIds: [],
      aliasOwnedSummaryIds: [],
      classCounts: [{ classId: 'c-1', rosterCount: 12, enrollmentCount: 12 }],
      money: { before: { ledgerAmounts: 1000 }, after: { ledgerAmounts: 1000 } },
      financeAnomalies: [],
    },
    baseline: { financeAnomalies: [] },
    ...overrides,
  };
  return base as Parameters<typeof verifyStudentProfileNormalization>[0];
}

describe('clean verification', () => {
  it('passes when every invariant holds', () => {
    const result = verifyStudentProfileNormalization(input());

    expect(result.valid).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.operationCounts).toEqual({ planned: 2, applied: 2, verified: 2, failed: 0 });
  });
});

describe('journal completeness', () => {
  it('fails when fewer operations applied than were planned', () => {
    const result = verifyStudentProfileNormalization(
      input({ journal: [{ runId: 'run-1', operationId: 'op-1', groupId: 'g-1', stage: 's', status: 'applied' }] })
    );

    expect(result.valid).toBe(false);
    expect(result.operationCounts).toMatchObject({ planned: 2, applied: 1 });
  });

  it('fails on any failed journal entry', () => {
    const result = verifyStudentProfileNormalization(
      input({
        journal: [
          { runId: 'run-1', operationId: 'op-1', groupId: 'g-1', stage: 's', status: 'applied' },
          { runId: 'run-1', operationId: 'op-2', groupId: 'g-1', stage: 's', status: 'failed', errorCode: 'X' },
        ],
      })
    );

    expect(result.valid).toBe(false);
    expect(result.operationCounts.failed).toBe(1);
  });

  it('fails on a pending entry, which means the run never finished', () => {
    const result = verifyStudentProfileNormalization(
      input({
        journal: [
          { runId: 'run-1', operationId: 'op-1', groupId: 'g-1', stage: 's', status: 'applied' },
          { runId: 'run-1', operationId: 'op-2', groupId: 'g-1', stage: 's', status: 'pending' },
        ],
      })
    );

    expect(result.valid).toBe(false);
  });
});

describe('reviewed document after-state', () => {
  it('fails when a document does not have the fingerprint the final plan approved', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        documentEffectDrift: [
          { path: 'students/legacy-1', expected: 'expected', observed: 'different' },
        ],
      },
    });

    expect(result.documentEffectDrift).toHaveLength(1);
    expect(result.valid).toBe(false);
  });
});

describe('identity invariants', () => {
  it('blocks a legacy soft-merge record that never became a tombstone', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        profiles: [
          base.observations.profiles[0],
          { id: 'legacy-2', mergedIntoStudentId: 'canonical-1', name: 'n', dob: 'd', contact: 'c' },
        ],
        aliases: [{ legacyProfileId: 'legacy-1', canonicalProfileId: 'canonical-1' }],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    // A surviving mergedIntoStudentId is not evidence of a completed merge —
    // it is the old script's marker, and nothing in the app reads it.
    expect(result.unnormalizedLegacySoftMergeProfileIds).toEqual(['legacy-2']);
    expect(result.valid).toBe(false);
  });

  it('blocks a duplicate code still owned by two profiles', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        codeOwners: [
          { code: 'HS260167', profileId: 'canonical-1' },
          { code: 'HS260167', profileId: 'legacy-1' },
        ],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.duplicateCodes).toEqual(['HS260167']);
    expect(result.valid).toBe(false);
  });

  it('blocks an alias pointing at a profile that is itself retired', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        aliases: [{ legacyProfileId: 'legacy-1', canonicalProfileId: 'legacy-1' }],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.valid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('UNKNOWN_REFERENCE');
  });

  it('blocks a profile with more than one open enrollment', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: { ...base.observations, openEnrollmentCountByProfile: { 'canonical-1': 2 } },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.multipleOpenProfileIds).toEqual(['canonical-1']);
    expect(result.valid).toBe(false);
  });

  it('blocks any remaining mutable reference to a retired profile', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: { ...base.observations, mutableLegacyReferences: ['receipts/r-9'] },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.valid).toBe(false);
  });

  it('blocks an unknown reference rather than reporting it as informational', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        unknownReferences: [{ path: 'mystery/x', fieldPath: 'studentId', profileId: 'legacy-1' }],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.valid).toBe(false);
    expect(result.unknownReferences).toHaveLength(1);
  });

  it.each(['aliasOwnedUserIds', 'aliasOwnedCredentialIds', 'aliasOwnedSummaryIds'])(
    'blocks when %s is non-empty',
    (field) => {
      const base = input();
      const result = verifyStudentProfileNormalization({
        ...base,
        observations: { ...base.observations, [field]: ['legacy-1'] },
      } as Parameters<typeof verifyStudentProfileNormalization>[0]);

      expect(result.valid).toBe(false);
    }
  );

  it('blocks a class whose roster and enrollment counts disagree', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        classCounts: [{ classId: 'c-1', rosterCount: 13, enrollmentCount: 12 }],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.classCountMismatches).toEqual(['c-1']);
    expect(result.valid).toBe(false);
  });
});

describe('admission-search coverage', () => {
  it('counts a canonical profile whose fields are absent', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        profiles: [
          { id: 'canonical-1', name: 'n', dob: '2014-05-02', contact: '0900000000' },
          base.observations.profiles[1],
        ],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.studentsWithUnusableAdmissionSearchFields).toBe(1);
    expect(result.valid).toBe(false);
  });

  it('counts a stale field as unusable, because the query treats it as a non-match', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        profiles: [
          { ...base.observations.profiles[0], admissionSearchContact: '0911111111' },
          base.observations.profiles[1],
        ],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.studentsWithUnusableAdmissionSearchFields).toBe(1);
    expect(result.valid).toBe(false);
  });

  it('does not count a retired document, whose canonical twin already carries the fields', () => {
    // Counting them would hold the blocker non-zero until retirement, which
    // runs long after the gate it would be blocking.
    const result = verifyStudentProfileNormalization(input());

    expect(result.studentsWithUnusableAdmissionSearchFields).toBe(0);
    expect(result.valid).toBe(true);
  });

  it('reports an underivable profile against the baseline instead of blocking', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        profiles: [
          base.observations.profiles[0],
          base.observations.profiles[1],
          { id: 'canonical-2', name: 'Nguyễn A', dob: '', contact: '0900000001' },
        ],
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.studentsWithUnderivableAdmissionSearchFields).toBe(1);
    expect(result.valid).toBe(true);
  });
});

describe('money and finance anomalies', () => {
  it('blocks when a money total moved', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: {
        ...base.observations,
        money: { before: { ledgerAmounts: 1000 }, after: { ledgerAmounts: 900 } },
      },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.moneyMatches).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('ignores a finance anomaly that was already in the frozen baseline', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: { ...base.observations, financeAnomalies: ['orphan_ledger:l-1'] },
      baseline: { financeAnomalies: ['orphan_ledger:l-1'] },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.financeAnomaliesOutsideBaseline).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('blocks a finance anomaly that appeared during the run', () => {
    const base = input();
    const result = verifyStudentProfileNormalization({
      ...base,
      observations: { ...base.observations, financeAnomalies: ['orphan_ledger:l-2'] },
      baseline: { financeAnomalies: ['orphan_ledger:l-1'] },
    } as Parameters<typeof verifyStudentProfileNormalization>[0]);

    expect(result.financeAnomaliesOutsideBaseline).toEqual(['orphan_ledger:l-2']);
    expect(result.valid).toBe(false);
  });
});

describe('money that was never observed', () => {
  it('does not report a match when neither side recorded a single total', () => {
    // Absence of a measurement is not a passing measurement. An empty pair
    // satisfies "every key agrees" without there being a key, and the release
    // gate reads moneyMatches as proof the money survived the merge.
    const result = verifyStudentProfileNormalization(
      input({
        observations: {
          ...input().observations,
          money: { before: {}, after: {} },
        },
      })
    );

    expect(result.moneyMatches).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain('UNKNOWN_REFERENCE');
    expect(result.valid).toBe(false);
  });

  it('still reports a match when a real total was observed on both sides', () => {
    const result = verifyStudentProfileNormalization(input());

    expect(result.moneyMatches).toBe(true);
  });
});
