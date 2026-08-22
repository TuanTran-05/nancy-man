import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { requiredScenarios, type DrillEvidence } from './drill-scenarios.js';
import { evaluateDrGate } from './run-drill.js';
import { signDrillEvidence } from './sign-evidence.js';

const keys = generateKeyPairSync('ed25519');
const declaredAt = '2026-08-22T03:14:00.000Z';

function evidenceFor(
  scenario: DrillEvidence['scenario'],
  overrides: Partial<DrillEvidence> = {}
): DrillEvidence {
  return signDrillEvidence(
    {
      scenario,
      declaredAt,
      recoveryTarget: { timestamp: '2026-08-22T03:13:00.000Z', walLsn: '0/16B6C50' },
      lastRecoverableCommitAt: '2026-08-22T03:13:30.000Z',
      readyAt: '2026-08-22T03:20:00.000Z',
      measuredRpoSeconds: 30,
      measuredRtoSeconds: 360,
      sourceSystemId: 'production-system',
      targetSystemId: 'recovery-host-01',
      verificationPassed: true,
      operatorId: 'ops-owner-01',
      toolReleaseSha: '0123456789abcdef0123456789abcdef01234567',
      ...overrides
    },
    keys.privateKey
  );
}

function completeEvidence(): DrillEvidence[] {
  return requiredScenarios.map((scenario) => evidenceFor(scenario));
}

describe('DR drill gate evaluation', () => {
  it('approves only a current signed complete scenario matrix within RPO and RTO targets', () => {
    const gate = evaluateDrGate(
      completeEvidence(),
      keys.publicKey,
      new Date('2026-08-23T03:14:00.000Z')
    );

    expect(gate).toMatchObject({
      approved: true,
      measuredRpoSeconds: 30,
      measuredRtoSeconds: 360
    });
  });

  it.each([
    ['one required scenario is absent', completeEvidence().slice(1)],
    [
      'verification fails',
      completeEvidence().map((item, index) =>
        index === 0 ? evidenceFor(item.scenario, { verificationPassed: false }) : item
      )
    ],
    [
      'RPO exceeds one minute',
      completeEvidence().map((item, index) =>
        index === 0 ? evidenceFor(item.scenario, { measuredRpoSeconds: 61 }) : item
      )
    ],
    [
      'RTO exceeds fifteen minutes',
      completeEvidence().map((item, index) =>
        index === 0 ? evidenceFor(item.scenario, { measuredRtoSeconds: 901 }) : item
      )
    ],
    [
      'an evidence signature is invalid',
      completeEvidence().map((item, index) =>
        index === 0 ? { ...item, signature: 'invalid' } : item
      )
    ],
    [
      'evidence is older than thirty-one days',
      requiredScenarios.map((scenario) =>
        evidenceFor(scenario, { declaredAt: '2026-07-21T03:14:00.000Z' })
      )
    ]
  ])('does not approve when %s', (_reason, evidence) => {
    const gate = evaluateDrGate(evidence, keys.publicKey, new Date('2026-08-23T03:14:00.000Z'));

    expect(gate.approved).toBe(false);
    expect(gate.evidenceSha256).toBeNull();
  });
});
