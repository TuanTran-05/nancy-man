import { createHash, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

import type { DrillEvidence, UnsignedDrillEvidence } from './drill-scenarios.js';

type SigningKey = KeyObject | string | Buffer;

export function canonicalizeDrillEvidence(evidence: UnsignedDrillEvidence): string {
  return JSON.stringify({
    scenario: evidence.scenario,
    declaredAt: evidence.declaredAt,
    recoveryTarget: {
      timestamp: evidence.recoveryTarget.timestamp,
      walLsn: evidence.recoveryTarget.walLsn
    },
    lastRecoverableCommitAt: evidence.lastRecoverableCommitAt,
    readyAt: evidence.readyAt,
    measuredRpoSeconds: evidence.measuredRpoSeconds,
    measuredRtoSeconds: evidence.measuredRtoSeconds,
    sourceSystemId: evidence.sourceSystemId,
    targetSystemId: evidence.targetSystemId,
    verificationPassed: evidence.verificationPassed,
    operatorId: evidence.operatorId,
    toolReleaseSha: evidence.toolReleaseSha
  });
}

export function drillEvidenceSha256(evidence: UnsignedDrillEvidence): string {
  return createHash('sha256').update(canonicalizeDrillEvidence(evidence)).digest('hex');
}

export function signDrillEvidence(
  evidence: UnsignedDrillEvidence,
  privateKey: SigningKey
): DrillEvidence {
  const evidenceSha256 = drillEvidenceSha256(evidence);
  const signature = sign(null, Buffer.from(evidenceSha256, 'utf8'), privateKey).toString('base64');

  return Object.freeze({ ...evidence, evidenceSha256, signature });
}

export function verifyDrillEvidence(evidence: DrillEvidence, publicKey: SigningKey): boolean {
  const { evidenceSha256, signature, ...unsigned } = evidence;
  const expectedHash = drillEvidenceSha256(unsigned);
  const expectedHashBuffer = Buffer.from(expectedHash, 'utf8');
  const actualHashBuffer = Buffer.from(evidenceSha256, 'utf8');

  if (
    expectedHashBuffer.length !== actualHashBuffer.length ||
    !timingSafeEqual(expectedHashBuffer, actualHashBuffer)
  ) {
    return false;
  }

  try {
    return verify(null, expectedHashBuffer, publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
