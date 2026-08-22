import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { inventoryStudentReferences } from './inventory.js';
import { STUDENT_REFERENCE_REGISTRY_VERSION } from './referenceRegistry.js';

function fakeDocumentStore(collections: Record<string, Array<{ id: string; value: Record<string, unknown> }>>) {
  return {
    async listCollections() {
      return Object.keys(collections).map((name) => ({
        id: name,
        path: name,
        async get() {
          return {
            docs: (collections[name] || []).map((doc) => ({
              id: doc.id,
              data: () => structuredClone(doc.value),
              ref: {
                path: `${name}/${doc.id}`,
                async listCollections() {
                  return [];
                },
              },
            })),
          };
        },
      }));
    },
  } as unknown as DocumentStore;
}

describe('inventoryStudentReferences', () => {
  it('classifies a match in a registered collection as known', async () => {
    const db = fakeDocumentStore({
      evaluations: [{ id: 'eval-1', value: { studentId: 'legacy-1' } }],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.registryVersion).toBe(STUDENT_REFERENCE_REGISTRY_VERSION);
    expect(result.known).toHaveLength(1);
    expect(result.known[0]).toMatchObject({
      registryEntryId: 'evaluations.studentId',
      documentPath: 'evaluations/eval-1',
      matchedProfileIds: ['legacy-1'],
    });
    expect(result.unknown).toEqual([]);
  });

  it('classifies a match in a student-free collection as neither known nor unknown', async () => {
    const db = fakeDocumentStore({
      config: [{ id: 'legacy-1', value: {} }],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.known).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it('classifies a match in a collection absent from both registry and free-list as UNKNOWN_REFERENCE', async () => {
    const db = fakeDocumentStore({
      some_new_collection_nobody_registered: [{ id: 'doc-1', value: { studentId: 'legacy-1' } }],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.known).toEqual([]);
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0]).toMatchObject({
      documentPath: 'some_new_collection_nobody_registered/doc-1',
      matchedProfileIds: ['legacy-1'],
    });
  });

  it('classifies a match on an unregistered field path within an otherwise-registered collection as unknown', async () => {
    // `evaluations.studentId` only registers the `studentId` field path; a
    // match on some other field the registry does not name must not be
    // silently accepted as known just because the collection has an entry.
    const db = fakeDocumentStore({
      evaluations: [{ id: 'eval-1', value: { reviewerNote: 'see legacy-1 for context' } }],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.known).toEqual([]);
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0].documentPath).toBe('evaluations/eval-1');
  });

  it('classifies a document-id match against a keyed registry entry as known even without a scalar field match', () => {
    return (async () => {
      const db = fakeDocumentStore({
        students: [{ id: 'legacy-1', value: { name: 'x' } }],
      });
      const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });
      expect(result.known.map((m) => m.registryEntryId)).toContain('students.profile');
    })();
  });

  it('covers an array element through the registered `[]` path', async () => {
    // Production writes ids into arrays: `metadata.studentIds`,
    // `metadata.affectedStudentIds`, `allocations[].ledgerId`. The scan reports
    // each element by its own index — `metadata.studentIds.13` — and a registry
    // can only ever name the shape, never every index a document happens to
    // have. Without this, 113 audit records were unregistered against an entry
    // whose whole purpose was to cover them.
    const db = fakeDocumentStore({
      audit_logs: [{ id: 'log-1', value: { metadata: { studentIds: ['other', 'legacy-1'] } } }],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.unknown).toEqual([]);
    expect(result.known.map((match) => match.registryEntryId)).toContain('audit_logs.fields');
  });

  it('classifies the run-7 repair-log change arrays as immutable audit references', async () => {
    const db = fakeDocumentStore({
      audit_logs: [
        {
          id: 'data-repair-1',
          value: {
            changes: {
              enrollmentTermEnd: [{ studentId: 'legacy-1' }],
              ledgerTermEnd: [{ id: 'legacy-1_ledger', studentId: 'legacy-1' }],
            },
          },
        },
      ],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.unknown).toEqual([]);
    expect(result.known).toHaveLength(1);
    expect(result.known[0]).toMatchObject({
      registryEntryId: 'audit_logs.fields',
      matchedFieldPaths: [
        'changes.enrollmentTermEnd.0.studentId',
        'changes.ledgerTermEnd.0.id',
        'changes.ledgerTermEnd.0.studentId',
      ],
    });
  });

  it('accepts a document whose matched fields are covered between two entries', async () => {
    // A linked account is keyed `student:<profileId>` and also carries
    // `studentId`, so it matches the document id and a field. Both are
    // registered — the id encoding by `users.deterministic`, the field by
    // `users.field_query` — but neither entry covers both alone. Requiring one
    // entry to account for every matched path called such a document
    // unregistered while the registry described all of it.
    const db = fakeDocumentStore({
      users: [{ id: 'student:legacy-1', value: { uid: 'legacy-1', studentId: 'legacy-1' } }],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.unknown).toEqual([]);
    expect(result.known).toHaveLength(1);
  });

  it('still refuses a document when one matched field is covered and another is not', async () => {
    // The union must not become "any match in a registered collection is
    // fine". An unregistered path is exactly what the blocker is for.
    const db = fakeDocumentStore({
      users: [
        { id: 'student:legacy-1', value: { studentId: 'legacy-1', scratchNote: 'legacy-1' } },
      ],
    });

    const result = await inventoryStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.known).toEqual([]);
    expect(result.unknown).toHaveLength(1);
  });

  it('produces a stable digest that changes when the known/unknown sets change', async () => {
    const dbA = fakeDocumentStore({ evaluations: [{ id: 'eval-1', value: { studentId: 'legacy-1' } }] });
    const dbB = fakeDocumentStore({ evaluations: [{ id: 'eval-2', value: { studentId: 'legacy-1' } }] });

    const resultA = await inventoryStudentReferences({ db: dbA, candidateProfileIds: ['legacy-1'] });
    const resultA2 = await inventoryStudentReferences({ db: dbA, candidateProfileIds: ['legacy-1'] });
    const resultB = await inventoryStudentReferences({ db: dbB, candidateProfileIds: ['legacy-1'] });

    expect(resultA.digest).toBe(resultA2.digest);
    expect(resultA.digest).not.toBe(resultB.digest);
  });
});
