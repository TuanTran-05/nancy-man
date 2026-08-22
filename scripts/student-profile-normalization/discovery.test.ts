import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { discoverStudentReferences } from './discovery.js';

type FakeNode = {
  id: string;
  value: Record<string, unknown>;
  sub?: Record<string, FakeNode[]>;
};

function fakeDocumentStore(tree: Record<string, FakeNode[]>): DocumentStore {
  const buildCollections = (level: Record<string, FakeNode[]>, parentPath: string) =>
    Object.keys(level).map((name) => {
      const path = parentPath ? `${parentPath}/${name}` : name;
      return {
        id: name,
        path,
        async get() {
          return {
            docs: (level[name] || []).map((node) => ({
              id: node.id,
              data: () => structuredClone(node.value),
              ref: {
                path: `${path}/${node.id}`,
                async listCollections() {
                  return buildCollections(node.sub || {}, `${path}/${node.id}`);
                },
              },
            })),
          };
        },
      };
    });

  return {
    async listCollections() {
      return buildCollections(tree, '');
    },
  } as unknown as DocumentStore;
}

describe('student reference discovery', () => {
  it('finds candidate ids in scalar, nested, array, and document-id positions', async () => {
    const db = fakeDocumentStore({
      evaluations: [{ id: 'eval-1', value: { studentId: 'legacy-1', score: 8 } }],
      receipts: [
        {
          id: 'receipt-1',
          value: { owner: { studentId: 'legacy-1' }, allocations: [{ studentId: 'legacy-2' }] },
        },
      ],
      users: [{ id: 'student:legacy-2', value: { role: 'student' } }],
    });

    const result = await discoverStudentReferences({
      db,
      candidateProfileIds: ['legacy-1', 'legacy-2'],
    });

    const byPath = new Map(result.matches.map((match) => [match.documentPath, match]));
    expect(byPath.get('evaluations/eval-1')?.matchedFieldPaths).toEqual(['studentId']);
    expect(byPath.get('receipts/receipt-1')?.matchedFieldPaths).toEqual([
      'allocations.0.studentId',
      'owner.studentId',
    ]);
    expect(byPath.get('receipts/receipt-1')?.matchedProfileIds).toEqual(['legacy-1', 'legacy-2']);
    expect(byPath.get('users/student:legacy-2')?.matchedFieldPaths).toEqual(['__documentId__']);
  });

  it('attributes each id to the field it was found in, and says which merely contain it', async () => {
    // Production's shape: an account already keyed under the canonical profile
    // whose `studentId` still names the retired one. A document-level answer —
    // "these fields matched, these ids matched" — cannot distinguish the field
    // that needs repointing from the two that are already right, so a rewrite
    // built on it assigns the canonical id to all three and flattens
    // `student:<canonicalId>` into `<canonicalId>`, breaking a live account.
    const db = fakeDocumentStore({
      users: [
        {
          id: 'student:canonical-1',
          value: { uid: 'student:canonical-1', studentId: 'legacy-1' },
        },
      ],
    });

    const result = await discoverStudentReferences({
      db,
      candidateProfileIds: ['canonical-1', 'legacy-1'],
    });

    expect(result.matches[0].fieldMatches).toEqual([
      { fieldPath: '__documentId__', profileIds: ['canonical-1'], contained: true },
      { fieldPath: 'studentId', profileIds: ['legacy-1'], contained: false },
      { fieldPath: 'uid', profileIds: ['canonical-1'], contained: true },
    ]);
  });

  it('recurses into subcollections and censuses every collection it visited', async () => {
    const db = fakeDocumentStore({
      classes: [
        {
          id: 'class-1',
          value: { name: 'G7' },
          sub: { sessions: [{ id: 'session-1', value: { attendees: ['legacy-1'] } }] },
        },
      ],
      settings: [{ id: 'config', value: { theme: 'dark' } }],
    });

    const result = await discoverStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    expect(result.matches.map((match) => match.documentPath)).toEqual([
      'classes/class-1/sessions/session-1',
    ]);
    expect(result.matches[0].matchedFieldPaths).toEqual(['attendees.0']);
    expect(result.collections).toEqual([
      {
        path: 'classes',
        documentCount: 1,
        matchedDocumentCount: 0,
        subcollectionProbe: { mode: 'exhaustive', probedDocuments: 1, foundSubcollections: true },
      },
      {
        path: 'classes/class-1/sessions',
        documentCount: 1,
        matchedDocumentCount: 1,
        subcollectionProbe: { mode: 'exhaustive', probedDocuments: 1, foundSubcollections: false },
      },
      {
        path: 'settings',
        documentCount: 1,
        matchedDocumentCount: 0,
        subcollectionProbe: { mode: 'exhaustive', probedDocuments: 1, foundSubcollections: false },
      },
    ]);
    expect(result.scannedDocuments).toBe(3);
  });

  it('probes a bounded sample for subcollections instead of one call per document', async () => {
    const probed: string[] = [];
    const docs = Array.from({ length: 40 }, (_, index) => ({
      id: `doc-${String(index).padStart(3, '0')}`,
      value: {},
    }));
    const db = {
      async listCollections() {
        return [
          {
            id: 'notifications',
            path: 'notifications',
            async get() {
              return {
                docs: docs.map((doc) => ({
                  id: doc.id,
                  data: () => ({}),
                  ref: {
                    path: `notifications/${doc.id}`,
                    async listCollections() {
                      probed.push(doc.id);
                      return [];
                    },
                  },
                })),
              };
            },
          },
        ];
      },
    } as unknown as DocumentStore;

    const result = await discoverStudentReferences({
      db,
      candidateProfileIds: ['legacy-1'],
      subcollectionSampleSize: 5,
    });

    expect(probed).toEqual(['doc-000', 'doc-001', 'doc-002', 'doc-003', 'doc-004']);
    expect(result.collections[0]).toMatchObject({
      path: 'notifications',
      documentCount: 40,
      subcollectionProbe: { mode: 'sampled', probedDocuments: 5, foundSubcollections: false },
    });
  });

  it('escalates a collection to full probing once the sample proves subcollections exist', async () => {
    const probed: string[] = [];
    const db = {
      async listCollections() {
        return [
          {
            id: 'classes',
            path: 'classes',
            async get() {
              return {
                docs: ['a', 'b', 'c'].map((id) => ({
                  id,
                  data: () => ({}),
                  ref: {
                    path: `classes/${id}`,
                    async listCollections() {
                      probed.push(id);
                      return id === 'a'
                        ? [
                            {
                              id: 'sessions',
                              path: `classes/${id}/sessions`,
                              async get() {
                                return {
                                  docs: [
                                    {
                                      id: 's-1',
                                      data: () => ({ studentId: 'legacy-1' }),
                                      ref: {
                                        path: `classes/${id}/sessions/s-1`,
                                        async listCollections() {
                                          return [];
                                        },
                                      },
                                    },
                                  ],
                                };
                              },
                            },
                          ]
                        : [];
                    },
                  },
                })),
              };
            },
          },
        ];
      },
    } as unknown as DocumentStore;

    const result = await discoverStudentReferences({
      db,
      candidateProfileIds: ['legacy-1'],
      subcollectionSampleSize: 1,
    });

    expect(probed).toEqual(['a', 'b', 'c']);
    expect(result.collections.find((entry) => entry.path === 'classes')?.subcollectionProbe).toEqual(
      { mode: 'exhaustive', probedDocuments: 3, foundSubcollections: true }
    );
    expect(result.matches.map((match) => match.documentPath)).toEqual([
      'classes/a/sessions/s-1',
    ]);
  });

  it('reports only paths and ids, never document values', async () => {
    const db = fakeDocumentStore({
      student_auth_credentials: [
        {
          id: 'legacy-1',
          value: { passwordHash: 'super-secret-hash', salt: 'nacl', name: 'QUÁCH HOÀNG MINH' },
        },
      ],
    });

    const result = await discoverStudentReferences({ db, candidateProfileIds: ['legacy-1'] });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret-hash');
    expect(serialized).not.toContain('nacl');
    expect(serialized).not.toContain('QUÁCH HOÀNG MINH');
    expect(result.matches[0].matchedFieldPaths).toEqual(['__documentId__']);
  });
});
