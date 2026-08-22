import { createHash } from 'node:crypto';
import {
  RETIREMENT_PRESERVED_COLLECTIONS,
  type LegacyStudentRetirementPlan,
  type LegacyStudentRetirementReviewedFile,
} from './types.js';

/**
 * Turns a plan into the two things a human needs: something to read, and
 * something to bind an approval to.
 *
 * The digest covers a canonicalized form, so the same plan produced twice
 * digests the same and an approval survives a regenerate that changed nothing.
 * That matters because the review is the expensive part: making an operator
 * re-read an identical plan because a key order shifted teaches them to stop
 * reading it.
 */

export type LegacyStudentRetirementReport = {
  digest: string;
  summary: {
    runId: string;
    candidates: number;
    eligible: number;
    blocked: number;
    operations: Record<string, number>;
    centerWideBlockers: number;
  };
  lines: string[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return Object.fromEntries(entries.map(([key, child]) => [key, canonicalize(child)]));
}

export function digestLegacyStudentRetirementPlan(plan: LegacyStudentRetirementPlan): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(plan))).digest('hex');
}

/**
 * Refuses to report a plan that would touch a collection retirement preserves.
 *
 * Checked here as well as in the planner because the report is what a human
 * approves. A plan that reached this point with a forbidden operation is a bug
 * somewhere upstream, and printing it as if it were normal is how it gets
 * approved.
 */
export function assertPreservesRetirementEvidence(plan: LegacyStudentRetirementPlan): void {
  const serialized = JSON.stringify(plan.operations);
  for (const collection of RETIREMENT_PRESERVED_COLLECTIONS) {
    if (serialized.includes(collection)) {
      throw new Error(`STUDENT_RETIREMENT_PRESERVED_COLLECTION_TOUCHED: ${collection}`);
    }
  }
}

export function assertLegacyStudentRetirementApproved(
  plan: LegacyStudentRetirementPlan,
  approval: LegacyStudentRetirementReviewedFile
): void {
  const planDigest = digestLegacyStudentRetirementPlan(plan);
  if (approval.planDigest !== planDigest) {
    throw new Error('APPROVAL_DIGEST_MISMATCH');
  }

  const { identity_technical, finance, auth_security } = approval.approvals;

  if (!identity_technical) {
    throw new Error('MISSING_APPROVAL: identity_technical');
  }
  if (!finance) {
    throw new Error('MISSING_APPROVAL: finance');
  }

  const hasCredentialDeletion = plan.operations.some(
    (op) => op.kind === 'delete_credential_tombstone'
  );

  if (hasCredentialDeletion && !auth_security) {
    throw new Error('MISSING_APPROVAL: auth_security');
  }

  const reviewers = new Set([identity_technical, finance]);
  if (auth_security) reviewers.add(auth_security);

  const requiredCount = hasCredentialDeletion ? 3 : 2;
  // If they are not distinct reviewers, the Set size will be smaller than the required distinct approvals. Wait! The requirement says:
  // "distinct authorized approvals... (`identity_technical` and `finance`, plus `auth_security` when credential deletion exists)"
  // So reviewers must be distinct people!
  
  // Actually, we must check that `identity_technical` !== `finance`, etc.
  if (reviewers.size < (auth_security ? 3 : 2)) {
    throw new Error('APPROVALS_NOT_DISTINCT');
  }
}

export function buildLegacyStudentRetirementReport(
  plan: LegacyStudentRetirementPlan
): LegacyStudentRetirementReport {
  assertPreservesRetirementEvidence(plan);

  const operations: Record<string, number> = {};
  for (const operation of plan.operations) {
    operations[operation.kind] = (operations[operation.kind] ?? 0) + 1;
  }

  const eligible = plan.candidates.filter((candidate) => candidate.eligible).length;
  const lines: string[] = [
    `run: ${plan.runId}`,
    `target: ${plan.target.projectId}/${plan.target.databaseId}`,
    `commit: ${plan.sourceCommitSha}  export: ${plan.exportOperationId}`,
    `green daily audits: ${plan.dailyGreenAuditIds.length}`,
    `candidates: ${plan.candidates.length} (${eligible} eligible)`,
  ];

  for (const [kind, count] of Object.entries(operations).sort()) {
    lines.push(`operation ${kind}: ${count}`);
  }
  // Blockers are listed in full rather than summarized. The count tells an
  // operator to stop; only the list tells them what to fix.
  for (const blocker of plan.blockers) {
    lines.push(`blocker ${blocker.code}${blocker.documentId ? ` (${blocker.documentId})` : ''}: ${blocker.detail}`);
  }
  for (const candidate of plan.candidates) {
    for (const blocker of candidate.blockers) {
      lines.push(`blocker ${blocker.code} (${candidate.legacyProfileId}): ${blocker.detail}`);
    }
  }

  return {
    digest: digestLegacyStudentRetirementPlan(plan),
    summary: {
      runId: plan.runId,
      candidates: plan.candidates.length,
      eligible,
      blocked: plan.candidates.length - eligible,
      operations,
      centerWideBlockers: plan.blockers.length,
    },
    lines,
  };
}
