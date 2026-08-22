import { createHash, type KeyObject } from 'node:crypto';

import type { DrGateStatus } from './dr-status.schema.js';
import {
  requiredScenarios,
  type DrillEvidence,
  type DrillScenario,
  type UnsignedDrillEvidence
} from './drill-scenarios.js';
import { signDrillEvidence, verifyDrillEvidence } from './sign-evidence.js';

type VerificationKey = KeyObject | string | Buffer;

function disabledGate(): DrGateStatus {
  return {
    approved: false,
    approvedAt: null,
    evidenceSha256: null,
    measuredRpoSeconds: null,
    measuredRtoSeconds: null,
    expiresAt: null
  };
}

function isFresh(evidence: DrillEvidence, now: Date): boolean {
  const declaredAt = Date.parse(evidence.declaredAt);
  return Number.isFinite(declaredAt) && now.getTime() <= declaredAt + 31 * 24 * 60 * 60 * 1_000;
}

export async function runDrill(input: {
  scenario: DrillScenario;
  execute: (scenario: DrillScenario) => Promise<Omit<UnsignedDrillEvidence, 'scenario'>>;
  privateKey: VerificationKey;
}): Promise<DrillEvidence> {
  const execution = await input.execute(input.scenario);
  return signDrillEvidence({ scenario: input.scenario, ...execution }, input.privateKey);
}

export function evaluateDrGate(
  evidence: readonly DrillEvidence[],
  publicKey: VerificationKey,
  now = new Date()
): DrGateStatus {
  const evidenceByScenario = new Map<DrillScenario, DrillEvidence>();

  for (const item of evidence) {
    if (
      evidenceByScenario.has(item.scenario) ||
      !item.verificationPassed ||
      item.measuredRpoSeconds > 60 ||
      item.measuredRtoSeconds > 900 ||
      !isFresh(item, now) ||
      !verifyDrillEvidence(item, publicKey)
    ) {
      return disabledGate();
    }

    evidenceByScenario.set(item.scenario, item);
  }

  if (!requiredScenarios.every((scenario) => evidenceByScenario.has(scenario))) {
    return disabledGate();
  }

  const completeEvidence = requiredScenarios.map(
    (scenario) => evidenceByScenario.get(scenario) as DrillEvidence
  );
  const evidenceSha256 = createHash('sha256')
    .update(JSON.stringify(completeEvidence.map((item) => item.evidenceSha256)))
    .digest('hex');
  const maximumRpo = Math.max(...completeEvidence.map((item) => item.measuredRpoSeconds));
  const maximumRto = Math.max(...completeEvidence.map((item) => item.measuredRtoSeconds));
  const earliestExpiry = Math.min(
    ...completeEvidence.map((item) => Date.parse(item.declaredAt) + 31 * 24 * 60 * 60 * 1_000)
  );

  return {
    approved: true,
    approvedAt: now.toISOString(),
    evidenceSha256,
    measuredRpoSeconds: maximumRpo,
    measuredRtoSeconds: maximumRto,
    expiresAt: new Date(earliestExpiry).toISOString()
  };
}
