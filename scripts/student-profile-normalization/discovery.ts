import type { DocumentStore } from '@/server/db/documentStore.js';

/**
 * Phase 0 discovery traversal.
 *
 * Runs read-only against production and reports *where* candidate student ids
 * appear, without classifying anything. The typed reference registry is written
 * from this output rather than from assumption, so the bias here is to
 * over-report: a substring hit is recorded and a human decides what it means.
 *
 * Output carries paths, ids, and counts only. Never document values, because
 * this runs over credential and profile collections.
 */

export const DOCUMENT_ID_FIELD_PATH = '__documentId__';

/**
 * One field of one document, and the candidate ids found in it.
 *
 * The attribution is the point. A document-level answer — "these fields
 * matched, these ids matched" — cannot say *which* id was in *which* field,
 * and a rewrite driven by that has no choice but to assign the canonical id to
 * every matched field. Production has a linked account keyed
 * `users/student:<canonicalId>` whose `studentId` still names the retired
 * profile: two of its three matched fields name the id that is already
 * correct, and rewriting those flattens `student:<canonicalId>` to
 * `<canonicalId>` and breaks a live auth account.
 */
export type StudentIdFieldMatch = {
  fieldPath: string;
  /** Candidate ids found in this field, sorted. */
  profileIds: string[];
  /**
   * The value merely *contains* an id instead of being one.
   *
   * The scan matches substrings on purpose — a course-fee ledger id is
   * `<studentId>__<courseId>`, an audit log's `metadata.url` embeds the id in
   * a path — and that breadth is what stops a reference hiding. But such a
   * field cannot be repointed by assigning the canonical id to it: that would
   * replace a composite key with half of one. Recording which is which is
   * what lets a rewrite refuse rather than corrupt.
   */
  contained: boolean;
};

export type StudentIdMatch = {
  documentPath: string;
  matchedFieldPaths: string[];
  /** Per-field attribution of the ids above. Sorted by `fieldPath`. */
  fieldMatches: StudentIdFieldMatch[];
  matchedProfileIds: string[];
};

/**
 * DocumentStore exposes no database-level list of subcollection paths; the only way
 * to find them is to ask each document, one RPC at a time. On a production
 * database that dominates the whole scan.
 *
 * So probe a bounded sample per collection, and escalate that collection to
 * every document the moment the sample proves subcollections exist. Subcollections
 * are a schema-wide pattern rather than a per-document accident, so a sample that
 * finds none is strong evidence — but it is evidence, not proof, which is why
 * every entry reports how it was probed.
 */
export const DEFAULT_SUBCOLLECTION_SAMPLE_SIZE = 25;

export type SubcollectionProbe = {
  mode: 'sampled' | 'exhaustive';
  probedDocuments: number;
  foundSubcollections: boolean;
};

export type CollectionCensusEntry = {
  path: string;
  documentCount: number;
  matchedDocumentCount: number;
  subcollectionProbe: SubcollectionProbe;
};

export type StudentReferenceDiscovery = {
  collections: CollectionCensusEntry[];
  matches: StudentIdMatch[];
  scannedDocuments: number;
  subcollectionSampleSize: number;
};

type CollectionLike = {
  path: string;
  get: () => Promise<{ docs: DocumentLike[] }>;
};

type DocumentLike = {
  id: string;
  data: () => Record<string, unknown> | undefined;
  ref: { path: string; listCollections: () => Promise<CollectionLike[]> };
};

function collectValueMatches(
  value: unknown,
  fieldPath: string,
  candidates: readonly string[],
  found: Map<string, Set<string>>,
  contained: Set<string>
): void {
  if (typeof value === 'string') {
    for (const candidate of candidates) {
      if (value === candidate || value.includes(candidate)) {
        const ids = found.get(fieldPath) || new Set<string>();
        ids.add(candidate);
        found.set(fieldPath, ids);
        if (value !== candidate) contained.add(fieldPath);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectValueMatches(
        entry,
        fieldPath ? `${fieldPath}.${index}` : String(index),
        candidates,
        found,
        contained
      );
    });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      collectValueMatches(entry, fieldPath ? `${fieldPath}.${key}` : key, candidates, found, contained);
    }
  }
}

function matchDocument(
  doc: DocumentLike,
  candidates: readonly string[]
): StudentIdMatch | null {
  const found = new Map<string, Set<string>>();
  const contained = new Set<string>();

  for (const candidate of candidates) {
    if (doc.id === candidate || doc.id.includes(candidate)) {
      const ids = found.get(DOCUMENT_ID_FIELD_PATH) || new Set<string>();
      ids.add(candidate);
      found.set(DOCUMENT_ID_FIELD_PATH, ids);
      // A document keyed `student:<id>` or `<studentId>__<courseId>` is named
      // after the profile without being named the profile. Moving it is a
      // target-path decision, never a field assignment.
      if (doc.id !== candidate) contained.add(DOCUMENT_ID_FIELD_PATH);
    }
  }

  collectValueMatches(doc.data() || {}, '', candidates, found, contained);

  if (found.size === 0) return null;

  const matchedProfileIds = new Set<string>();
  for (const ids of found.values()) {
    for (const id of ids) matchedProfileIds.add(id);
  }

  return {
    documentPath: doc.ref.path,
    matchedFieldPaths: [...found.keys()].sort(),
    fieldMatches: [...found.entries()]
      .map(([fieldPath, ids]) => ({
        fieldPath,
        profileIds: [...ids].sort(),
        contained: contained.has(fieldPath),
      }))
      .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath)),
    matchedProfileIds: [...matchedProfileIds].sort(),
  };
}

export async function discoverStudentReferences(input: {
  db: DocumentStore;
  candidateProfileIds: readonly string[];
  subcollectionSampleSize?: number;
}): Promise<StudentReferenceDiscovery> {
  const candidates = [...new Set(input.candidateProfileIds)].filter((id) => id.length > 0);
  const sampleSize = Math.max(0, input.subcollectionSampleSize ?? DEFAULT_SUBCOLLECTION_SAMPLE_SIZE);
  const collections: CollectionCensusEntry[] = [];
  const matches: StudentIdMatch[] = [];
  let scannedDocuments = 0;

  const visit = async (collection: CollectionLike): Promise<void> => {
    const snapshot = await collection.get();
    let matchedDocumentCount = 0;

    for (const doc of snapshot.docs) {
      scannedDocuments += 1;
      const match = matchDocument(doc, candidates);
      if (match) {
        matches.push(match);
        matchedDocumentCount += 1;
      }
    }

    const children: CollectionLike[] = [];
    let probedDocuments = 0;
    let foundSubcollections = false;
    let exhaustive = snapshot.docs.length <= sampleSize;

    for (const doc of snapshot.docs) {
      if (!exhaustive && probedDocuments >= sampleSize) break;
      probedDocuments += 1;
      const found = await doc.ref.listCollections();
      if (found.length > 0) {
        foundSubcollections = true;
        // A subcollection anywhere means the pattern is real for this
        // collection, so stop sampling and probe the rest.
        exhaustive = true;
        children.push(...(found as CollectionLike[]));
      }
    }

    collections.push({
      path: collection.path,
      documentCount: snapshot.docs.length,
      matchedDocumentCount,
      subcollectionProbe: {
        mode: exhaustive ? 'exhaustive' : 'sampled',
        probedDocuments,
        foundSubcollections,
      },
    });

    for (const child of children) {
      await visit(child);
    }
  };

  const roots = (await (input.db as unknown as {
    listCollections: () => Promise<CollectionLike[]>;
  }).listCollections()) as CollectionLike[];

  for (const root of roots) {
    await visit(root);
  }

  collections.sort((left, right) => left.path.localeCompare(right.path));
  matches.sort((left, right) => left.documentPath.localeCompare(right.documentPath));

  return { collections, matches, scannedDocuments, subcollectionSampleSize: sampleSize };
}
