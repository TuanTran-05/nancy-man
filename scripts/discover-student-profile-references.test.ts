import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  parseStudentProfileDiscoveryArgs,
  runStudentProfileDiscovery,
} from './discover-student-profile-references.js';

type FakeDoc = { id: string; value: Record<string, unknown> };

function fakeDocumentStore(collections: Record<string, FakeDoc[]>): DocumentStore {
  const docsOf = (name: string, parentPath: string) =>
    (collections[name] || []).map((doc) => ({
      id: doc.id,
      data: () => structuredClone(doc.value),
      ref: {
        path: `${parentPath}${name}/${doc.id}`,
        async listCollections() {
          return [];
        },
      },
    }));

  const forbid = (operation: string) => () => {
    throw new Error(`DISCOVERY_MUST_BE_READ_ONLY:${operation}`);
  };

  return {
    collection(name: string) {
      return {
        async get() {
          return { docs: docsOf(name, ''), size: (collections[name] || []).length };
        },
        doc: forbid('doc'),
        add: forbid('add'),
      };
    },
    batch: forbid('batch'),
    runTransaction: forbid('runTransaction'),
    async listCollections() {
      return Object.keys(collections).map((name) => ({
        id: name,
        path: name,
        async get() {
          return { docs: docsOf(name, '') };
        },
      }));
    },
  } as unknown as DocumentStore;
}

describe('student profile discovery CLI arguments', () => {
  it('requires an explicit output directory and never invents one', () => {
    expect(() => parseStudentProfileDiscoveryArgs([])).toThrow(
      'STUDENT_PROFILE_DISCOVERY_OUTPUT_DIR_REQUIRED'
    );
  });

  it('rejects unknown flags rather than ignoring them', () => {
    expect(() =>
      parseStudentProfileDiscoveryArgs(['--output-dir', 'scratch/x', '--aply'])
    ).toThrow('STUDENT_PROFILE_DISCOVERY_UNKNOWN_FLAG:--aply');
  });

  it('refuses any flag that implies a write', () => {
    expect(() =>
      parseStudentProfileDiscoveryArgs(['--output-dir', 'scratch/x', '--apply'])
    ).toThrow('STUDENT_PROFILE_DISCOVERY_IS_READ_ONLY');
  });

  it('defaults candidates to the discovered legacy population and accepts explicit ids', () => {
    expect(parseStudentProfileDiscoveryArgs(['--output-dir', 'scratch/x'])).toEqual({
      outputDir: 'scratch/x',
      explicitCandidateIds: [],
    });
    expect(
      parseStudentProfileDiscoveryArgs([
        '--output-dir',
        'scratch/x',
        '--candidate-id',
        'legacy-9',
        '--candidate-id',
        'legacy-8',
      ]).explicitCandidateIds
    ).toEqual(['legacy-8', 'legacy-9']);
  });
});

describe('student profile discovery run', () => {
  const baseCollections = {
    students: [
      {
        id: 'canonical-1',
        value: {
          admissionSearchName: 'a',
          admissionSearchDob: 'b',
          admissionSearchContact: 'c',
        },
      },
      { id: 'legacy-1', value: { mergedIntoStudentId: 'canonical-1' } },
    ],
    student_profile_aliases: [],
    course_fee_ledgers: [
      { id: 'l-1', value: { studentId: 'legacy-1', classId: 'c-1', amount: 500_000 } },
    ],
    student_course_enrollments: [],
    receipts: [{ id: 'r-1', value: { studentId: 'legacy-1' } }],
  };

  it('scans the legacy soft-merge population it discovered and writes the report set', async () => {
    const written = new Map<string, string>();
    const result = await runStudentProfileDiscovery(
      { outputDir: 'scratch/discovery', explicitCandidateIds: [] },
      {
        db: fakeDocumentStore(baseCollections),
        writeFile: async (filePath, contents) => {
          written.set(filePath, contents);
        },
        now: new Date('2026-08-06T04:00:00.000Z'),
        sourceCommitSha: 'abc123',
      }
    );

    expect(result.candidateProfileIds).toEqual(['legacy-1']);
    expect(result.census.legacySoftMerges).toHaveLength(1);
    expect(result.census.missingAdmissionSearchFields.total).toBe(1);
    expect(result.financeBaseline.orphanLedgers.map((row) => row.ledgerId)).toEqual(['l-1']);
    expect(
      result.discovery.matches.map((match) => match.documentPath).includes('receipts/r-1')
    ).toBe(true);

    expect([...written.keys()].sort()).toEqual([
      'scratch/discovery/student-profile-census.json',
      'scratch/discovery/student-profile-discovery-summary.json',
      'scratch/discovery/student-profile-finance-baseline.json',
      'scratch/discovery/student-profile-reference-inventory.json',
    ]);

    const summary = JSON.parse(
      written.get('scratch/discovery/student-profile-discovery-summary.json') || '{}'
    );
    expect(summary.sourceCommitSha).toBe('abc123');
    expect(summary.generatedAt).toBe('2026-08-06T04:00:00.000Z');
    expect(summary.readOnly).toBe(true);
  });

  it('scans explicit candidate ids when supplied instead of the discovered population', async () => {
    const result = await runStudentProfileDiscovery(
      { outputDir: 'scratch/discovery', explicitCandidateIds: ['canonical-1'] },
      {
        db: fakeDocumentStore(baseCollections),
        writeFile: async () => {},
        now: new Date('2026-08-06T04:00:00.000Z'),
        sourceCommitSha: 'abc123',
      }
    );

    expect(result.candidateProfileIds).toEqual(['canonical-1']);
  });
});
