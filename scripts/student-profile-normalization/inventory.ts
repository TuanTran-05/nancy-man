import type { DocumentStore } from '@/server/db/documentStore.js';
import { sha256 } from './canonicalJson.js';
import {
  discoverStudentReferences,
  type StudentIdMatch,
  type StudentIdFieldMatch,
  DOCUMENT_ID_FIELD_PATH,
} from './discovery.js';
import {
  getStudentReferenceSpec,
  STUDENT_REFERENCE_FREE_COLLECTIONS,
  STUDENT_REFERENCE_REGISTRY,
  STUDENT_REFERENCE_REGISTRY_VERSION,
} from './referenceRegistry.js';
import type { StudentReferenceRewriteKind } from './types.js';

/**
 * Classifies the raw discovery match set (see `discovery.ts`) against the
 * typed registry (see `referenceRegistry.ts`).
 *
 * `discoverStudentReferences` deliberately over-reports — it flags any
 * substring hit anywhere in a document, in any collection, known or not. That
 * is correct for a scan with no registry to check against yet. This module
 * is the second, registry-aware pass: every match becomes either `known`
 * (its collection is registered and every one of its matched field paths is
 * covered by that registration) or `unknown` — there is no third option, and
 * no generic "registered collection, unlisted field" allowance. A field the
 * registry does not name is exactly as unclassified as a whole unregistered
 * collection.
 *
 * A match in a collection on the free-list (no student reference possible,
 * per its recorded evidence) is dropped from both sets: it was never a real
 * candidate.
 *
 * This intentionally does not carry document fingerprints or update times.
 * Discovery never reads full document values past the substring scan, for
 * the same privacy reason it never reports them — the module runs over
 * credential collections. A fingerprinted, fully re-read inventory happens
 * inside the writer's apply-time preflight (Task 11), against an
 * authenticated, reviewed candidate set, not during open-ended Phase 0 scans.
 */

export interface StudentReferenceMatch {
  /**
   * The entry whose policy governs this document.
   *
   * One document can be described by several entries — a linked account is
   * matched both by the id it is keyed under and by the `studentId` it
   * carries — and those entries do not always agree about what should happen
   * to it. The governing entry is chosen by an explicit precedence in
   * `chooseGoverningEntry`, never by registry order.
   */
  registryEntryId: string;
  /** Every entry that covered at least one matched field path, sorted. */
  registryEntryIds: string[];
  documentPath: string;
  matchedFieldPaths: string[];
  /** See `StudentIdFieldMatch`: which id was found in which field. */
  fieldMatches: StudentIdFieldMatch[];
  matchedProfileIds: string[];
}

export interface UnknownStudentReference {
  documentPath: string;
  matchedFieldPaths: string[];
  matchedProfileIds: string[];
}

export interface StudentReferenceInventory {
  registryVersion: string;
  known: StudentReferenceMatch[];
  unknown: UnknownStudentReference[];
  scannedCollections: string[];
  scannedDocuments: number;
  digest: string;
}

function collectionOf(documentPath: string): string {
  return documentPath.split('/')[0];
}

const FREE_COLLECTIONS = new Set(
  STUDENT_REFERENCE_FREE_COLLECTIONS.map((entry) => entry.collectionPath)
);

const KEY_ENCODES_STUDENT_KINDS = new Set(['keyed_document', 'deterministic_identity', 'profile_owned']);

type EntryAcceptance = { registryEntryId: string; fieldPaths: Set<string> };

const entriesByCollection = new Map<string, EntryAcceptance[]>();
for (const entry of STUDENT_REFERENCE_REGISTRY) {
  // Stored as shapes, so `metadata.studentIds[]` in the registry meets
  // `metadata.studentIds.13` from the scan.
  const accepted = new Set(entry.fieldPaths.map(fieldPathShape));
  if (KEY_ENCODES_STUDENT_KINDS.has(entry.kind)) accepted.add(DOCUMENT_ID_FIELD_PATH);
  // An entry with no declared field paths and no document-id coverage (e.g.
  // pure metadata-existence entries like credential records) accepts any
  // field path within its collection, because its own fields carry no
  // student-identifying content by design — only the collection membership
  // does.
  const acceptsAnyField = entry.fieldPaths.length === 0 && !KEY_ENCODES_STUDENT_KINDS.has(entry.kind);

  const list = entriesByCollection.get(entry.collectionPath) || [];
  list.push({ registryEntryId: entry.id, fieldPaths: acceptsAnyField ? new Set(['*']) : accepted });
  entriesByCollection.set(entry.collectionPath, list);
}

/**
 * The shape of a field path, with array indices collapsed.
 *
 * The scan reports the element it found — `metadata.studentIds.13`,
 * `metadata.plan.5.creates.0.studentId` — because that is where the id
 * literally is. A registry can only ever name the shape: it cannot enumerate
 * the indices a document happens to have. Both sides are normalised here, so
 * an entry declares `metadata.studentIds[]` once and covers every element.
 *
 * A purely numeric object key is indistinguishable from an array index at
 * this layer and is normalised too. That is deliberate: a collection keying
 * data by numeric string would otherwise need one registry entry per key,
 * which is the same impossibility in a different shape.
 */
function fieldPathShape(fieldPath: string): string {
  // The separator goes with the index: `metadata.studentIds.13` is
  // `metadata.studentIds[]`, and `metadata.plan.5.creates.0.studentId` is
  // `metadata.plan[].creates[].studentId`.
  return fieldPath.replace(/(?:^|\.)\d+(?=\.|$)/g, '[]');
}

/**
 * Which entry's policy governs a document several entries describe.
 *
 * Preservation dominates. If any covering entry declares the document
 * immutable, the document is immutable — a second entry that would patch a
 * field in place cannot make an audit record rewritable, and reading the
 * precedence the other way round would let the weakest registration in a
 * collection authorise a write to the strongest-protected document in it.
 *
 * Below that, an action that moves or recreates the document dominates one
 * that edits it in place: a linked account keyed `student:<legacyId>` has to
 * be recreated under the canonical id, and patching its `studentId` field
 * where it stands would leave the account answering to the retired id.
 *
 * Ranked as a total map rather than a lookup in a list: a kind added to
 * `StudentReferenceRewriteKind` without a rank here is a compile error. Ranking
 * by position in an array would instead give the new kind `indexOf` -1, which
 * sorts ahead of `preserve_via_alias` and silently hands an unconsidered kind
 * authority over an immutable record.
 */
const REWRITE_KIND_PRECEDENCE: Record<StudentReferenceRewriteKind, number> = {
  preserve_via_alias: 0,
  claim_registry: 1,
  create_alias: 2,
  recreate_document: 3,
  delete_and_rebuild: 4,
  drain_or_rewrite: 5,
  rewrite_nested: 6,
  patch_field: 7,
};

function chooseGoverningEntry(entryIds: readonly string[]): string {
  return [...entryIds].sort((left, right) => {
    const leftRank = REWRITE_KIND_PRECEDENCE[getStudentReferenceSpec(left).rewriteKind];
    const rightRank = REWRITE_KIND_PRECEDENCE[getStudentReferenceSpec(right).rewriteKind];
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  })[0];
}

function classifyMatch(match: StudentIdMatch): StudentReferenceMatch | UnknownStudentReference {
  const collectionPath = collectionOf(match.documentPath);
  const entries = entriesByCollection.get(collectionPath);

  if (entries) {
    // Coverage is per field path across the whole collection's entries, not
    // per entry. A document that matches the id it is keyed under and the
    // `studentId` it carries is described entirely by the registry even
    // though no single entry names both, and calling it unregistered blocked
    // the run over something the registry already knew.
    const covering = new Set<string>();
    const uncovered = match.matchedFieldPaths.filter((fieldPath) => {
      const shape = fieldPathShape(fieldPath);
      const owners = entries.filter(
        (entry) => entry.fieldPaths.has('*') || entry.fieldPaths.has(shape)
      );
      for (const owner of owners) covering.add(owner.registryEntryId);
      return owners.length === 0;
    });

    if (uncovered.length === 0 && covering.size > 0) {
      const registryEntryIds = [...covering].sort();
      return {
        registryEntryId: chooseGoverningEntry(registryEntryIds),
        registryEntryIds,
        documentPath: match.documentPath,
        matchedFieldPaths: match.matchedFieldPaths,
        fieldMatches: match.fieldMatches,
        matchedProfileIds: match.matchedProfileIds,
      };
    }
  }

  return {
    documentPath: match.documentPath,
    matchedFieldPaths: match.matchedFieldPaths,
    matchedProfileIds: match.matchedProfileIds,
  };
}

export async function inventoryStudentReferences(input: {
  db: DocumentStore;
  candidateProfileIds: readonly string[];
}): Promise<StudentReferenceInventory> {
  const discovery = await discoverStudentReferences({
    db: input.db,
    candidateProfileIds: input.candidateProfileIds,
  });

  const known: StudentReferenceMatch[] = [];
  const unknown: UnknownStudentReference[] = [];

  for (const match of discovery.matches) {
    if (FREE_COLLECTIONS.has(collectionOf(match.documentPath))) continue;

    const classified = classifyMatch(match);
    if ('registryEntryId' in classified) known.push(classified);
    else unknown.push(classified);
  }

  known.sort((left, right) => left.documentPath.localeCompare(right.documentPath));
  unknown.sort((left, right) => left.documentPath.localeCompare(right.documentPath));

  const digest = sha256(
    JSON.stringify({
      registryVersion: STUDENT_REFERENCE_REGISTRY_VERSION,
      known,
      unknown,
    })
  );

  return {
    registryVersion: STUDENT_REFERENCE_REGISTRY_VERSION,
    known,
    unknown,
    scannedCollections: discovery.collections.map((entry) => entry.path),
    scannedDocuments: discovery.scannedDocuments,
    digest,
  };
}
