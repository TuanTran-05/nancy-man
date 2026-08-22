import { describe, expect, it, vi } from 'vitest';
import { verifyCourseClosingMaterialization } from './verifier.js';
import type { MaterializationRunPlan } from './types.js';

function planFor(documentTypes: Array<'evaluation' | 'tuition'>): MaterializationRunPlan {
  return {
    generatedAt: '2026-07-27T00:00:00.000Z',
    blocked: false,
    items: documentTypes.map((documentType, index) => ({
      recordId: 'r1',
      documentType,
      templateVersion: 1 as const,
      action: index === 0 ? 'unchanged_ready' : 'materialize_unavailable_missing',
      expectedStoragePath: `course_closing_records/2026-07/c/co/s/${documentType}-v1.docx`,
      recordFingerprint: String(index).repeat(64),
      evidenceFingerprint: String(index + 2).repeat(64),
      ...(index === 0 ? {} : { unavailableReason: 'historical_source_missing' as const }),
    })),
    summary: {
      total: documentTypes.length,
      evaluation: documentTypes.filter((type) => type === 'evaluation').length,
      tuition: documentTypes.filter((type) => type === 'tuition').length,
      unchanged_ready: documentTypes.length > 0 ? 1 : 0,
      repair_ready_status: 0,
      materialize_verified: 0,
      materialize_unavailable_missing: Math.max(0, documentTypes.length - 1),
      materialize_unavailable_incomplete: 0,
      conflict: 0,
    },
  };
}

function dbWith(docs: Record<string, any>): any {
  return {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ exists: docs[id] !== undefined, data: () => docs[id] }),
      }),
    }),
  };
}

const evaluationDocument = {
  status: 'ready',
  storagePath: 'course_closing_records/2026-07/c/co/s/evaluation-v1.docx',
  generatedAt: '2026-07-27T01:00:00.000Z',
};
const tuitionDocument = {
  status: 'ready',
  storagePath: 'course_closing_records/2026-07/c/co/s/tuition-v1.docx',
  generatedAt: '2026-07-27T01:00:00.000Z',
};

describe('verifyCourseClosingMaterialization', () => {
  it('verifies both document objects for a complete record', async () => {
    const fileExists = vi.fn(async () => true);
    const summary = await verifyCourseClosingMaterialization(
      dbWith({ r1: { evaluationDocument, tuitionDocument } }),
      planFor(['evaluation', 'tuition']),
      { fileExists }
    );

    expect(summary.ready_with_file).toBe(2);
    expect(summary.metadata_missing).toBe(0);
    expect(summary.file_missing).toBe(0);
    expect(fileExists).toHaveBeenCalledTimes(2);
  });

  it('flags an absent Storage object', async () => {
    const summary = await verifyCourseClosingMaterialization(
      dbWith({ r1: { evaluationDocument } }),
      planFor(['evaluation']),
      { fileExists: async () => false }
    );

    expect(summary.file_missing).toBe(1);
    expect(summary.results[0]).toEqual({
      recordId: 'r1',
      documentType: 'evaluation',
      outcome: 'file_missing',
      storagePath: evaluationDocument.storagePath,
    });
  });

  it.each([
    ['a missing record', {}],
    [
      'a non-ready status',
      { r1: { evaluationDocument: { ...evaluationDocument, status: 'pending' } } },
    ],
    [
      'a missing storagePath',
      { r1: { evaluationDocument: { ...evaluationDocument, storagePath: '' } } },
    ],
    [
      'a missing generatedAt',
      { r1: { evaluationDocument: { ...evaluationDocument, generatedAt: '' } } },
    ],
  ])('reports metadata_missing for %s', async (_label, docs) => {
    const fileExists = vi.fn();
    const summary = await verifyCourseClosingMaterialization(
      dbWith(docs),
      planFor(['evaluation']),
      { fileExists }
    );

    expect(summary.metadata_missing).toBe(1);
    expect(fileExists).not.toHaveBeenCalled();
  });
});
