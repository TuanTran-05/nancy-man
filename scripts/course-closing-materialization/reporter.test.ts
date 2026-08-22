import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMaterializationDigest,
  readReviewedMaterializationPlan,
  writeMaterializationReports,
} from './reporter.js';
import type { MaterializationRunPlan } from './types.js';

const target = { projectId: 'proj', databaseId: 'db' };
const plan: MaterializationRunPlan = {
  generatedAt: '2026-07-27T00:00:00.000Z',
  blocked: false,
  items: [
    {
      recordId: 'c1__s1',
      documentType: 'evaluation',
      templateVersion: 1,
      action: 'materialize_unavailable_missing',
      expectedStoragePath:
        'course_closing_records/2026-07/class-1/course-1/student-1/evaluation-v1.docx',
      recordFingerprint: 'a'.repeat(64),
      evidenceFingerprint: 'b'.repeat(64),
      unavailableReason: 'historical_source_missing',
    },
    {
      recordId: 'c1__s1',
      documentType: 'tuition',
      templateVersion: 1,
      action: 'unchanged_ready',
      expectedStoragePath:
        'course_closing_records/2026-07/class-1/course-1/student-1/tuition-v1.docx',
      recordFingerprint: 'c'.repeat(64),
      evidenceFingerprint: 'd'.repeat(64),
    },
  ],
  summary: {
    total: 2,
    evaluation: 1,
    tuition: 1,
    unchanged_ready: 1,
    repair_ready_status: 0,
    materialize_verified: 0,
    materialize_unavailable_missing: 1,
    materialize_unavailable_incomplete: 0,
    conflict: 0,
  },
};

async function tempDir() {
  return await mkdtemp(path.join(tmpdir(), 'ccm-report-'));
}

describe('materialization reporter', () => {
  it('computes a stable digest that changes with plan content or target', () => {
    const first = createMaterializationDigest({ plan, target });
    expect(createMaterializationDigest({ plan, target })).toBe(first);
    expect(
      createMaterializationDigest({
        plan: {
          ...plan,
          items: [{ ...plan.items[0], recordFingerprint: 'e'.repeat(64) }],
        },
        target,
      })
    ).not.toBe(first);
    expect(
      createMaterializationDigest({ plan, target: { ...target, databaseId: 'other' } })
    ).not.toBe(first);
  });

  it('writes the complete PII-free plan to JSON and CSV', async () => {
    const dir = await tempDir();
    const manifest = await writeMaterializationReports({ plan, target, reportDir: dir });
    const json = JSON.parse(await readFile(manifest.jsonPath, 'utf8'));
    const csv = await readFile(manifest.csvPath, 'utf8');

    expect(json.digest).toBe(manifest.digest);
    expect(json.blocked).toBe(false);
    expect(json.summary.total).toBe(2);
    expect(csv).toContain(
      'recordId,documentType,templateVersion,action,expectedStoragePath,recordFingerprint,evidenceFingerprint,unavailableReason,conflictCode'
    );
    expect(csv).toContain('materialize_unavailable_missing');
    for (const content of [JSON.stringify(json), csv]) {
      expect(content).not.toMatch(
        /studentName|className|teacherName|studentCode|phone|notification content|ledger amount/i
      );
    }
  });

  it('round-trips a reviewed plan through digest confirmation', async () => {
    const dir = await tempDir();
    const manifest = await writeMaterializationReports({ plan, target, reportDir: dir });
    const reviewed = await readReviewedMaterializationPlan({
      planPath: manifest.planPath,
      confirmDigest: manifest.digest,
      expectedProjectId: 'proj',
      expectedDatabaseId: 'db',
    });

    expect(reviewed.plan).toEqual(plan);
  });

  it('rejects wrong digest, target drift, edits, and invalid structure', async () => {
    const dir = await tempDir();
    const manifest = await writeMaterializationReports({ plan, target, reportDir: dir });

    await expect(
      readReviewedMaterializationPlan({
        planPath: manifest.planPath,
        confirmDigest: 'deadbeef',
        expectedProjectId: 'proj',
        expectedDatabaseId: 'db',
      })
    ).rejects.toThrow('MATERIALIZE_REVIEWED_DIGEST_MISMATCH');
    await expect(
      readReviewedMaterializationPlan({
        planPath: manifest.planPath,
        confirmDigest: manifest.digest,
        expectedProjectId: 'other',
        expectedDatabaseId: 'db',
      })
    ).rejects.toThrow('MATERIALIZE_REVIEWED_TARGET_MISMATCH');

    const stored = JSON.parse(await readFile(manifest.planPath, 'utf8'));
    stored.plan.items[0].action = 'unchanged_ready';
    await writeFile(manifest.planPath, JSON.stringify(stored), 'utf8');
    await expect(
      readReviewedMaterializationPlan({
        planPath: manifest.planPath,
        confirmDigest: manifest.digest,
        expectedProjectId: 'proj',
        expectedDatabaseId: 'db',
      })
    ).rejects.toThrow('MATERIALIZE_REVIEWED_DIGEST_MISMATCH');

    const invalidPath = path.join(dir, 'invalid.json');
    await writeFile(invalidPath, JSON.stringify({ digest: 'x' }), 'utf8');
    await expect(
      readReviewedMaterializationPlan({
        planPath: invalidPath,
        confirmDigest: 'x',
        expectedProjectId: 'proj',
        expectedDatabaseId: 'db',
      })
    ).rejects.toThrow('MATERIALIZE_REVIEWED_PLAN_INVALID');
  });
});
