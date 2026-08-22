import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MaterializationRunPlan, MaterializationTarget } from './types.js';

export interface MaterializationReportManifest {
  generatedAt: string;
  digest: string;
  target: MaterializationTarget;
  jsonPath: string;
  csvPath: string;
  planPath: string;
  summary: MaterializationRunPlan['summary'];
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const text = typeof value === 'string' && /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(plan: MaterializationRunPlan): string {
  const headers = [
    'recordId',
    'documentType',
    'templateVersion',
    'action',
    'expectedStoragePath',
    'recordFingerprint',
    'evidenceFingerprint',
    'unavailableReason',
    'conflictCode',
  ];
  return [
    headers.join(','),
    ...plan.items.map((item) =>
      [
        item.recordId,
        item.documentType,
        item.templateVersion,
        item.action,
        item.expectedStoragePath,
        item.recordFingerprint,
        item.evidenceFingerprint,
        item.unavailableReason,
        item.conflictCode,
      ]
        .map(csvCell)
        .join(',')
    ),
  ].join('\r\n');
}

function sanitizePlan(plan: MaterializationRunPlan): MaterializationRunPlan {
  return {
    generatedAt: plan.generatedAt,
    blocked: Boolean(plan.blocked),
    summary: { ...plan.summary },
    items: plan.items.map((item) => ({
      recordId: item.recordId,
      documentType: item.documentType,
      templateVersion: item.templateVersion,
      action: item.action,
      expectedStoragePath: item.expectedStoragePath,
      recordFingerprint: item.recordFingerprint,
      evidenceFingerprint: item.evidenceFingerprint,
      unavailableReason: item.unavailableReason,
      conflictCode: item.conflictCode,
    })),
  };
}

export function createMaterializationDigest(input: {
  plan: MaterializationRunPlan;
  target: MaterializationTarget;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        target: input.target,
        plan: sanitizePlan(input.plan),
      })
    )
    .digest('hex');
}

export async function readReviewedMaterializationPlan(input: {
  planPath: string;
  confirmDigest: string;
  expectedProjectId: string;
  expectedDatabaseId: string;
}): Promise<{
  digest: string;
  target: MaterializationTarget;
  plan: MaterializationRunPlan;
}> {
  const stored = JSON.parse(await readFile(path.resolve(input.planPath), 'utf8')) as {
    digest?: string;
    target?: MaterializationTarget;
    plan?: MaterializationRunPlan;
  };
  if (!stored.plan || !stored.digest || !stored.target) {
    throw new Error('MATERIALIZE_REVIEWED_PLAN_INVALID');
  }
  if (
    stored.target.projectId !== input.expectedProjectId ||
    stored.target.databaseId !== input.expectedDatabaseId
  ) {
    throw new Error('MATERIALIZE_REVIEWED_TARGET_MISMATCH');
  }
  const computed = createMaterializationDigest({ plan: stored.plan, target: stored.target });
  if (computed !== stored.digest || stored.digest !== input.confirmDigest.trim()) {
    throw new Error('MATERIALIZE_REVIEWED_DIGEST_MISMATCH');
  }
  return { digest: stored.digest, target: stored.target, plan: stored.plan };
}

export async function writeMaterializationReports(input: {
  plan: MaterializationRunPlan;
  target: MaterializationTarget;
  reportDir: string;
}): Promise<MaterializationReportManifest> {
  const reportDir = path.resolve(input.reportDir);
  const sanitizedPlan = sanitizePlan(input.plan);
  const digest = createMaterializationDigest({ plan: sanitizedPlan, target: input.target });
  const jsonPath = path.join(reportDir, 'course-closing-materialization-report.json');
  const csvPath = path.join(reportDir, 'course-closing-materialization-report.csv');
  const planPath = path.join(reportDir, 'course-closing-materialization-plan.json');

  await mkdir(reportDir, { recursive: true });
  await Promise.all([
    writeFile(
      jsonPath,
      `${JSON.stringify(
        {
          generatedAt: input.plan.generatedAt,
          digest,
          target: input.target,
          blocked: sanitizedPlan.blocked,
          summary: input.plan.summary,
          items: sanitizedPlan.items,
        },
        null,
        2
      )}\n`,
      'utf8'
    ),
    writeFile(csvPath, `\uFEFF${toCsv(sanitizedPlan)}\r\n`, 'utf8'),
    writeFile(
      planPath,
      `${JSON.stringify({ digest, target: input.target, plan: sanitizedPlan }, null, 2)}\n`,
      'utf8'
    ),
  ]);

  return {
    generatedAt: input.plan.generatedAt,
    digest,
    target: input.target,
    jsonPath,
    csvPath,
    planPath,
    summary: input.plan.summary,
  };
}

export async function writeMaterializationRunSummary(input: {
  reportDir: string;
  filename: string;
  payload: unknown;
}): Promise<string> {
  const reportDir = path.resolve(input.reportDir);
  const target = path.join(reportDir, input.filename);
  await mkdir(reportDir, { recursive: true });
  await writeFile(target, `${JSON.stringify(input.payload, null, 2)}\n`, 'utf8');
  return target;
}
