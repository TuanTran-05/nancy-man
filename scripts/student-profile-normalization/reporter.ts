import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, sha256 } from './canonicalJson.js';
import type { StudentMergeBlocker, StudentMergeDocumentEffect } from './types.js';

/**
 * Manifests, digests, and the approval gate.
 *
 * `planDigest` is what a reviewer actually signs, so it covers everything that
 * could change what the run does to production: target, run, commit, registry
 * version, export evidence, rollback artifact, every operation in order, every
 * document fingerprint, every decision, and every money total. Operation order
 * is inside the digest because the executor runs them in sequence — two
 * orderings of the same operations are two different plans.
 *
 * The approval step deliberately does almost nothing: it re-derives the digest
 * from the plan's own contents and refuses if it disagrees with the one being
 * signed. It never regenerates operations, never reads review decisions, and
 * never repairs a plan. Attestation and authorship are kept apart so a
 * signature always refers to a byte-identical artifact.
 */

/**
 * What an operation does to its target document.
 *
 * The payload lives here, in the plan, rather than being derived at apply
 * time. A reviewer signs the exact bytes that will be written, and the digest
 * covers them, which is what keeps "the executor invents nothing" true for the
 * ten stages that are not a keyed copy.
 *
 * `copy_source` moves a document verbatim to its canonical path. `patch`
 * merges a payload into a document that must already exist — creating it
 * instead would invent a record nobody reviewed. `set` writes a document the
 * run creates: an alias, a code claim. `delete` retires one.
 */
export type StudentProfileMergePlanWrite =
  | { mode: 'copy_source' }
  | { mode: 'set'; payload: Record<string, unknown> }
  | { mode: 'patch'; payload: Record<string, unknown> }
  | { mode: 'delete' };

export type StudentProfileMergePlanOperation = {
  operationId: string;
  stage: string;
  sourcePath: string | null;
  targetPath: string | null;
  write?: StudentProfileMergePlanWrite;
  /**
   * Execution fields. Optional on the type because a preliminary audit
   * legitimately has none — it never re-reads DocumentStore and emits no
   * executable operation. Preflight requires all of them before apply, so
   * "optional here" never means "optional at write time".
   */
  registryEntryId?: string;
  kind?: string;
  dependsOn?: string[];
  sourceFingerprint?: string | null;
  targetBeforeFingerprint?: string | null;
  expectedAfterFingerprint?: string | null;
};

export type StudentProfileMergePlanGroup = {
  groupId: string;
  canonicalProfileId: string;
  legacyProfileIds: string[];
  candidateKind: string;
  /**
   * The reading of the database this group was reported from.
   *
   * A decision is written against it and checked against it, so a judgement
   * made about one set of documents cannot be applied to another after the
   * data moved underneath.
   */
  evidenceFingerprint: string;
  operations: StudentProfileMergePlanOperation[];
  documentEffects: StudentMergeDocumentEffect[];
  decisions: Record<string, unknown>;
  money: { before: Record<string, number>; expectedAfter: Record<string, number> };
  blockers: StudentMergeBlocker[];
};

export type StudentProfileMergePlan = {
  schemaVersion: 1;
  auditPhase: 'preliminary' | 'final';
  runId: string;
  sourceCommit: string;
  registryVersion: string;
  target: { projectId: string; databaseId: string };
  exportEvidence: {
    operationName: string;
    outputUriPrefix: string;
    snapshotTime: string;
    evidenceDigest: string;
  } | null;
  rollbackArtifact: { fileName: string; digest: string; entryCount: number } | null;
  groups: StudentProfileMergePlanGroup[];
  money: { before: Record<string, number>; expectedAfter: Record<string, number> };
  blockers: StudentMergeBlocker[];
};

export type StudentProfileMergeApprovalRole = 'identity_technical' | 'finance' | 'auth_security';

export type StudentProfileMergeApproval = {
  role: StudentProfileMergeApprovalRole;
  reviewerId: string;
  reviewedAt: string;
  planDigest: string;
};

export interface StudentProfileMergeReviewedFile {
  approved: true;
  applyable: true;
  planDigest: string;
  approvalDigest: string;
  approvals: StudentProfileMergeApproval[];
  target: { projectId: string; databaseId: string };
  plan: StudentProfileMergePlan;
}

/** Stages whose presence makes `auth_security` a required signature. */
const CREDENTIAL_STAGES = new Set(['select_credentials', 'rewrite_linked_users']);

export function createStudentProfileMergePlanDigest(plan: StudentProfileMergePlan): string {
  // canonicalJson sorts object keys, so authoring order cannot change the
  // digest, while arrays keep their order because order is meaningful here.
  return sha256(canonicalJson(plan));
}

export function createStudentProfileMergeApprovalDigest(input: {
  planDigest: string;
  approvals: readonly StudentProfileMergeApproval[];
}): string {
  const sorted = [...input.approvals].sort((a, b) =>
    a.role === b.role ? a.reviewerId.localeCompare(b.reviewerId) : a.role.localeCompare(b.role)
  );
  return sha256(canonicalJson({ planDigest: input.planDigest, approvals: sorted }));
}

function requiredRoles(plan: StudentProfileMergePlan): StudentProfileMergeApprovalRole[] {
  const roles: StudentProfileMergeApprovalRole[] = ['identity_technical', 'finance'];
  const touchesAuth = plan.groups.some((group) =>
    group.operations.some((operation) => CREDENTIAL_STAGES.has(operation.stage))
  );
  if (touchesAuth) roles.push('auth_security');
  return roles;
}

export function createReviewedStudentProfileNormalizationPlan(input: {
  plan: StudentProfileMergePlan;
  planDigest: string;
  approvals: readonly StudentProfileMergeApproval[];
  authorizedReviewers: Record<StudentProfileMergeApprovalRole, readonly string[]>;
}): StudentProfileMergeReviewedFile {
  const recomputed = createStudentProfileMergePlanDigest(input.plan);
  if (recomputed !== input.planDigest) {
    throw new Error(
      'STUDENT_PROFILE_PLAN_DIGEST_MISMATCH: the plan does not hash to the digest being approved'
    );
  }

  if (input.plan.auditPhase !== 'final') {
    throw new Error('STUDENT_PROFILE_PLAN_NOT_FINAL: only a final audit may be approved');
  }

  const groupBlockers = input.plan.groups.flatMap((group) => group.blockers);
  if (input.plan.blockers.length > 0 || groupBlockers.length > 0) {
    throw new Error(
      `STUDENT_PROFILE_PLAN_HAS_BLOCKERS: ${[...input.plan.blockers, ...groupBlockers]
        .map((blocker) => blocker.code)
        .join(', ')}`
    );
  }

  const seenRoles = new Set<string>();
  const seenReviewers = new Set<string>();
  for (const approval of input.approvals) {
    if (approval.planDigest !== input.planDigest) {
      throw new Error(
        `STUDENT_PROFILE_APPROVAL_STALE: ${approval.role} signed a different plan digest`
      );
    }
    if (seenRoles.has(approval.role)) {
      throw new Error(`STUDENT_PROFILE_APPROVAL_DUPLICATE_ROLE: ${approval.role}`);
    }
    // Distinctness is checked across roles, not within one: the point is that
    // two people looked, so one person holding two role memberships cannot
    // satisfy the gate alone.
    if (seenReviewers.has(approval.reviewerId)) {
      throw new Error(
        `STUDENT_PROFILE_APPROVAL_NOT_DISTINCT: ${approval.reviewerId} signed more than one role`
      );
    }
    if (!(input.authorizedReviewers[approval.role] ?? []).includes(approval.reviewerId)) {
      throw new Error(
        `STUDENT_PROFILE_APPROVAL_UNAUTHORIZED: ${approval.reviewerId} may not sign ${approval.role}`
      );
    }
    seenRoles.add(approval.role);
    seenReviewers.add(approval.reviewerId);
  }

  for (const role of requiredRoles(input.plan)) {
    if (!seenRoles.has(role)) {
      throw new Error(`STUDENT_PROFILE_APPROVAL_ROLE_MISSING: ${role}`);
    }
  }

  return {
    approved: true,
    applyable: true,
    planDigest: input.planDigest,
    approvalDigest: createStudentProfileMergeApprovalDigest({
      planDigest: input.planDigest,
      approvals: input.approvals,
    }),
    approvals: [...input.approvals],
    target: input.plan.target,
    plan: input.plan,
  };
}

/**
 * Neutralizes spreadsheet formula injection and CSV structure characters.
 *
 * These reports are opened in Excel and Google Sheets by reviewers, and a
 * student name or a blocker detail is attacker-influenced text. A leading
 * `=`, `+`, `-`, or `@` would otherwise execute on open.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const neutralized = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export type ReportPaths = {
  outputDir: string;
  planPath: string;
  reportPath: string;
  csvPath: string;
  inventoryPath: string;
  reviewDecisionsTemplatePath: string;
  journalTemplatePath: string;
};

/**
 * Claims the output directory before the audit reads anything.
 *
 * The exclusive create is what stops a rerun overwriting evidence a reviewer
 * may already have signed against. Doing it at write time meant a production
 * audit read every collection the registry knows — the most expensive read in
 * the program — and only then discovered it had nowhere to put the answer.
 *
 * Parents are created; the leaf is not allowed to exist.
 */
export async function reserveStudentProfileNormalizationReportDir(
  outputDir: string
): Promise<void> {
  await mkdir(path.dirname(outputDir), { recursive: true });
  try {
    await mkdir(outputDir, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`STUDENT_PROFILE_REPORT_DIR_EXISTS: ${outputDir}`, { cause: error });
    }
    throw error;
  }
}

export async function writeStudentProfileNormalizationReports(input: {
  outputDir: string;
  plan: StudentProfileMergePlan;
  /**
   * The scan's own evidence. `unknown` is required rather than optional
   * because an unregistered reference blocks the global apply, and the field
   * paths it carries are the only part of that finding a reviewer can act on
   * — they name the registry entry that is missing. Leaving the caller free to
   * omit it is how the first production audit reported 996 of them into an
   * artifact that recorded none.
   */
  inventory: { collections: unknown[]; matches: unknown[]; unknown: unknown[] };
  /** Set when the caller already claimed the directory before reading. */
  reserved?: boolean;
}): Promise<ReportPaths> {
  // Idempotent with the reservation above: an audit claims the directory
  // before it reads, and this call is what creates it when a caller writes
  // reports without having reserved one.
  if (!input.reserved) await reserveStudentProfileNormalizationReportDir(input.outputDir);

  const isFinal = input.plan.auditPhase === 'final';
  const planDigest = isFinal ? createStudentProfileMergePlanDigest(input.plan) : null;

  const paths: ReportPaths = {
    outputDir: input.outputDir,
    planPath: path.join(input.outputDir, 'student-profile-plan.json'),
    reportPath: path.join(input.outputDir, 'student-profile-report.json'),
    csvPath: path.join(input.outputDir, 'student-profile-report.csv'),
    inventoryPath: path.join(input.outputDir, 'student-profile-reference-inventory.json'),
    reviewDecisionsTemplatePath: path.join(
      input.outputDir,
      'student-profile-review-decisions.template.json'
    ),
    journalTemplatePath: path.join(input.outputDir, 'student-profile-journal.template.json'),
  };

  const planFile = {
    approved: false as const,
    auditPhase: input.plan.auditPhase,
    // A preliminary audit is never executable, whatever else it contains.
    applyable: isFinal,
    planDigest,
    plan: input.plan,
  };

  const header = [
    'groupId',
    'canonicalProfileId',
    'legacyProfileIds',
    'candidateKind',
    'operations',
    'blockers',
  ];
  const rows = input.plan.groups.map((group) =>
    [
      group.groupId,
      group.canonicalProfileId,
      group.legacyProfileIds.join(' '),
      group.candidateKind,
      String(group.operations.length),
      group.blockers.map((blocker) => blocker.code).join(' '),
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  // Shaped exactly as the final audit reads it back, and pre-filled with the
  // candidate id and evidence fingerprint the reviewer must not edit. A
  // template whose field names differ from the reader's is a form somebody
  // fills in carefully and the run then ignores.
  const reviewTemplate = {
    decisions: input.plan.groups.map((group) => ({
      candidateId: group.groupId,
      evidenceFingerprint: group.evidenceFingerprint,
      canonicalProfileId: group.canonicalProfileId,
      legacyProfileIds: group.legacyProfileIds,
      decision: null,
      reviewerId: null,
      reason: null,
    })),
    approvedFieldSources: {},
  };

  await Promise.all([
    writeFile(paths.planPath, `${canonicalJson(planFile)}\n`, { mode: 0o600 }),
    writeFile(
      paths.reportPath,
      `${canonicalJson({
        runId: input.plan.runId,
        auditPhase: input.plan.auditPhase,
        target: input.plan.target,
        groupCount: input.plan.groups.length,
        blockerCount: input.plan.blockers.length + input.plan.groups.flatMap((g) => g.blockers).length,
        money: input.plan.money,
      })}\n`,
      { mode: 0o600 }
    ),
    writeFile(paths.csvPath, `${[header.join(','), ...rows].join('\n')}\n`, { mode: 0o600 }),
    writeFile(paths.inventoryPath, `${canonicalJson(input.inventory)}\n`, { mode: 0o600 }),
    writeFile(paths.reviewDecisionsTemplatePath, `${canonicalJson(reviewTemplate)}\n`, {
      mode: 0o600,
    }),
    writeFile(
      paths.journalTemplatePath,
      `${canonicalJson({ runId: input.plan.runId, operations: [] })}\n`,
      { mode: 0o600 }
    ),
  ]);

  return paths;
}
