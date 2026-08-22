import { describe, expect, it } from 'vitest';
import { planStudentProfileNormalization } from './planAssembler.js';
import type { StudentIdentityCandidate } from './planner.js';
import type { StudentReferenceInventory } from './inventory.js';

/**
 * The orchestration the CLI was always meant to hold.
 *
 * Candidates, reconcilers, and the reference registry all existed and were
 * tested; nothing assembled them into a plan, so the engine had operations it
 * could execute and no way to be told what they were. An audit that cannot
 * emit a plan makes every mode after it unreachable — approve, apply, verify,
 * rollback — however complete those are on their own.
 */

const TARGET = { projectId: 'edutrack-prod', databaseId: 'edutrack' };
const COMMIT = 'a'.repeat(40);

function candidate(overrides: Partial<StudentIdentityCandidate> = {}): StudentIdentityCandidate {
  return {
    candidateId: 'exact_code:abc',
    kind: 'exact_code',
    profileIds: ['canonical-1', 'legacy-1'],
    normalizedCodes: ['HS260167'],
    evidenceFingerprint: 'f'.repeat(64),
    canonicalScores: [],
    proposedCanonicalProfileId: 'canonical-1',
    decision: 'merge_same_human',
    blockers: [],
    ...overrides,
  };
}

function emptyInventory(
  overrides: Partial<StudentReferenceInventory> = {}
): StudentReferenceInventory {
  return {
    registryVersion: 'student-references-v2',
    known: [],
    unknown: [],
    scannedCollections: ['students'],
    scannedDocuments: 2,
    digest: 'd'.repeat(64),
    ...overrides,
  };
}

function sources(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    auditPhase: 'final' as const,
    sourceCommit: COMMIT,
    registryVersion: 'student-references-v2',
    target: TARGET,
    exportEvidence: {
      operationName: 'projects/edutrack-prod/databases/edutrack/operations/op-1',
      outputUriPrefix: 'gs://backups/x',
      snapshotTime: '2026-08-07T01:00:00.000Z',
      evidenceDigest: 'e'.repeat(64),
    },
    rollbackArtifact: null,
    actorId: 'admin:tt',
    now: '2026-08-10T00:00:00.000Z',
    candidates: [candidate()],
    profiles: {
      'canonical-1': { name: 'QUÁCH HOÀNG MINH', dob: '2014-05-02', studentId: 'HS260167' },
      'legacy-1': { name: 'QUÁCH HOÀNG MINH', dob: '2014-05-02', studentId: 'HS260167' },
    },
    finance: {},
    credentials: [],
    linkedUsers: [],
    inventory: emptyInventory(),
    ...overrides,
  };
}

describe('planStudentProfileNormalization', () => {
  it('emits the reviewed stage sequence for a same-human merge', () => {
    const plan = planStudentProfileNormalization(sources());

    expect(plan.groups).toHaveLength(1);
    const stages = plan.groups[0].operations.map((operation) => operation.stage);
    // Codes before aliases before the tombstone: an alias that resolves to a
    // profile whose code somebody else still owns is worse than no alias.
    expect(stages).toEqual([
      'claim_codes',
      'create_aliases',
      'reconcile_profile',
      'rebuild_projections',
      'tombstone_legacy',
    ]);
  });

  it('chains each stage behind the one before it', () => {
    const plan = planStudentProfileNormalization(sources());
    const operations = plan.groups[0].operations;

    expect(operations[0].dependsOn).toEqual([]);
    for (let index = 1; index < operations.length; index += 1) {
      expect(operations[index].dependsOn).toContain(operations[index - 1].operationId);
    }
  });

  it('writes the tombstone the shared contract defines and nothing of its own', () => {
    const plan = planStudentProfileNormalization(sources());
    const tombstone = plan.groups[0].operations.find(
      (operation) => operation.stage === 'tombstone_legacy'
    );

    expect(tombstone?.targetPath).toBe('students/legacy-1');
    expect(tombstone?.write).toMatchObject({
      mode: 'patch',
      payload: expect.objectContaining({
        studentProfileState: 'merged_tombstone',
        canonicalProfileId: 'canonical-1',
        mergeRunId: 'run-1',
        identityWriteDisabled: true,
        authDisabled: true,
        walletOwnership: 'canonicalized',
      }),
    });
  });

  it('rewrites a known reference onto the canonical id', () => {
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          known: [
            {
              registryEntryId: 'evaluations.studentId',
              registryEntryIds: ['evaluations.studentId'],
              documentPath: 'evaluations/ev-1',
              matchedFieldPaths: ['studentId'],
              matchedProfileIds: ['legacy-1'],
              fieldMatches: [
                { fieldPath: 'studentId', profileIds: ['legacy-1'], contained: false },
              ],
            },
          ],
        }),
      })
    );

    const rewrite = plan.groups[0].operations.find(
      (operation) => operation.stage === 'rewrite_references'
    );
    expect(rewrite).toMatchObject({
      targetPath: 'evaluations/ev-1',
      write: { mode: 'patch', payload: { studentId: 'canonical-1' } },
    });
  });

  it('refuses to overwrite a field that only contains the id rather than being it', () => {
    // A course-fee ledger id is `<studentId>__<courseId>`, so a receipt's
    // `ledgerId` matches the scan without being a student id. Patching it to
    // the canonical profile id — which is what "set every matched field to the
    // canonical id" does — replaces a composite key with half of one and
    // orphans the receipt from its ledger. The registry has listed `ledgerId`
    // on the receipts entry since v1, so this was already reachable.
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          known: [
            {
              registryEntryId: 'receipts.studentId',
              registryEntryIds: ['receipts.studentId'],
              documentPath: 'receipts/r-1',
              matchedFieldPaths: ['ledgerId', 'studentId'],
              matchedProfileIds: ['legacy-1'],
              fieldMatches: [
                { fieldPath: 'ledgerId', profileIds: ['legacy-1'], contained: true },
                { fieldPath: 'studentId', profileIds: ['legacy-1'], contained: false },
              ],
            },
          ],
        }),
      })
    );

    const rewrites = plan.groups[0].operations.filter(
      (operation) => operation.stage === 'rewrite_references'
    );

    expect(rewrites).toEqual([]);
    expect(plan.groups[0].blockers.map((blocker) => blocker.code)).toContain(
      'REFERENCE_VALUE_NOT_A_BARE_ID'
    );
  });

  it('rewrites only the fields that name a retired id, leaving the rest alone', () => {
    // A linked account already keyed under the canonical profile can still
    // carry a `studentId` pointing at the retired one. Its `uid` and document
    // key legitimately contain the *canonical* id, so they need no rewrite —
    // but the scan reports the document, not the field, as having matched, and
    // "set every matched field to the canonical id" would flatten
    // `student:<canonicalId>` down to `<canonicalId>` and break a live auth
    // account. Production has exactly this document.
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          known: [
            {
              registryEntryId: 'users.deterministic',
              registryEntryIds: ['users.deterministic', 'users.field_query'],
              documentPath: 'users/student:canonical-1',
              matchedFieldPaths: ['__documentId__', 'studentId', 'uid'],
              matchedProfileIds: ['canonical-1', 'legacy-1'],
              fieldMatches: [
                { fieldPath: '__documentId__', profileIds: ['canonical-1'], contained: true },
                { fieldPath: 'studentId', profileIds: ['legacy-1'], contained: false },
                { fieldPath: 'uid', profileIds: ['canonical-1'], contained: true },
              ],
            },
          ],
        }),
      })
    );

    const rewrites = plan.groups[0].operations.filter(
      (operation) => operation.stage === 'rewrite_linked_users'
    );

    // Only the field that actually named the retired profile is touched.
    // Asserted with toEqual, not toMatchObject: the whole point is which keys
    // the payload does *not* have, and a partial match would accept the
    // corrupting `uid` and `__documentId__` writes this test exists to reject.
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].targetPath).toBe('users/student:canonical-1');
    expect(rewrites[0].write).toEqual({
      mode: 'patch',
      payload: { studentId: 'canonical-1' },
    });
    // And the composite fields, naming the canonical id already, block nothing.
    expect(plan.groups[0].blockers.map((blocker) => blocker.code)).not.toContain(
      'REFERENCE_VALUE_NOT_A_BARE_ID'
    );
  });

  it('leaves a derived summary to its delete-and-rebuild stage', () => {
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          known: [
            {
              registryEntryId: 'accounting_student_summaries.derived',
              registryEntryIds: ['accounting_student_summaries.derived'],
              documentPath: 'accounting_student_summaries/legacy-1',
              matchedFieldPaths: ['__documentId__', 'studentId'],
              matchedProfileIds: ['legacy-1'],
              fieldMatches: [
                { fieldPath: '__documentId__', profileIds: ['legacy-1'], contained: false },
                { fieldPath: 'studentId', profileIds: ['legacy-1'], contained: false },
              ],
            },
          ],
        }),
      })
    );

    const summaryOperations = plan.groups[0].operations.filter(
      (operation) => operation.targetPath === 'accounting_student_summaries/legacy-1'
    );
    expect(summaryOperations).toHaveLength(1);
    expect(summaryOperations[0]).toMatchObject({
      stage: 'rebuild_projections',
      kind: 'delete_and_rebuild',
      write: { mode: 'delete' },
    });
    expect(plan.groups[0].blockers).toEqual([]);
  });

  it('blocks an opaque keyed document until its owning reconciler plans a move', () => {
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          known: [
            {
              registryEntryId: 'student_course_enrollments.keyed',
              registryEntryIds: ['student_course_enrollments.keyed'],
              documentPath: 'student_course_enrollments/opaque-key',
              matchedFieldPaths: ['studentId'],
              matchedProfileIds: ['legacy-1'],
              fieldMatches: [
                { fieldPath: 'studentId', profileIds: ['legacy-1'], contained: false },
              ],
            },
          ],
        }),
      })
    );

    expect(
      plan.groups[0].operations.filter(
        (operation) => operation.targetPath === 'student_course_enrollments/opaque-key'
      )
    ).toEqual([]);
    expect(plan.groups[0].blockers.map((blocker) => blocker.code)).toContain(
      'REFERENCE_DOCUMENT_REKEY_REQUIRED'
    );
  });

  it('rebuilds a stale deterministic uid without flattening its role prefix', () => {
    // Exact production shape from audit run 7: the document key and studentId
    // already name the canonical profile, while uid alone still embeds the
    // retired id. The correct patch is `student:<canonicalId>`, not the bare
    // canonical id and not a document move.
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          known: [
            {
              registryEntryId: 'users.deterministic',
              registryEntryIds: ['users.deterministic', 'users.field_query'],
              documentPath: 'users/student:canonical-1',
              matchedFieldPaths: ['__documentId__', 'studentId', 'uid'],
              matchedProfileIds: ['canonical-1', 'legacy-1'],
              fieldMatches: [
                { fieldPath: '__documentId__', profileIds: ['canonical-1'], contained: true },
                { fieldPath: 'studentId', profileIds: ['canonical-1'], contained: false },
                { fieldPath: 'uid', profileIds: ['legacy-1'], contained: true },
              ],
            },
          ],
        }),
      })
    );

    const rewrites = plan.groups[0].operations.filter(
      (operation) => operation.stage === 'rewrite_linked_users'
    );

    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].write).toEqual({
      mode: 'patch',
      payload: { uid: 'student:canonical-1' },
    });
    expect(plan.groups[0].blockers.map((blocker) => blocker.code)).not.toContain(
      'REFERENCE_VALUE_NOT_A_BARE_ID'
    );
  });

  it('leaves an immutable reference to resolve through the alias', () => {
    // A progression event or an audit log names the id that was correct when
    // it was written. Rewriting it would edit the record of what happened.
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          known: [
            {
              registryEntryId: 'student_progression_events.fields',
              registryEntryIds: ['student_progression_events.fields'],
              documentPath: 'student_progression_events/ev-1',
              matchedFieldPaths: ['profileId'],
              matchedProfileIds: ['legacy-1'],
              fieldMatches: [
                { fieldPath: 'profileId', profileIds: ['legacy-1'], contained: false },
              ],
            },
          ],
        }),
      })
    );

    expect(
      plan.groups[0].operations.filter((operation) => operation.stage === 'rewrite_references')
    ).toEqual([]);
  });

  it('emits no operation for a candidate confirmed to be two different people', () => {
    const plan = planStudentProfileNormalization(
      sources({ candidates: [candidate({ decision: 'confirmed_distinct_person' })] })
    );

    expect(plan.groups[0].operations).toEqual([]);
    expect(plan.groups[0].blockers).toEqual([]);
  });

  it('keeps an unresolved candidate as a blocker rather than merging it', () => {
    const plan = planStudentProfileNormalization(
      sources({ candidates: [candidate({ decision: 'manual_review' })] })
    );

    expect(plan.groups[0].operations).toEqual([]);
    expect(plan.groups[0].blockers.map((blocker) => blocker.code)).toContain(
      'IDENTITY_DECISION_REQUIRED'
    );
  });

  it('blocks the whole run on a reference the registry cannot describe', () => {
    const plan = planStudentProfileNormalization(
      sources({
        inventory: emptyInventory({
          unknown: [
            {
              documentPath: 'some_new_collection/doc-1',
              matchedFieldPaths: ['studentId'],
              matchedProfileIds: ['legacy-1'],
            },
          ],
        }),
      })
    );

    expect(plan.blockers.map((blocker) => blocker.code)).toContain('UNKNOWN_REFERENCE');
  });

  it('emits no executable operation from a preliminary audit', () => {
    // A preliminary plan is something to argue with. Emitting executable
    // operations from reads taken before the export would let the wrong
    // artifact be approved.
    const plan = planStudentProfileNormalization(sources({ auditPhase: 'preliminary' }));

    for (const operation of plan.groups[0].operations) {
      expect(operation.write).toBeUndefined();
      expect(operation.expectedAfterFingerprint).toBeUndefined();
    }
  });

  it('is deterministic for the same input', () => {
    const first = planStudentProfileNormalization(sources());
    const second = planStudentProfileNormalization(sources());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('carries group money forward to the plan total', () => {
    const plan = planStudentProfileNormalization(
      sources({
        finance: {
          'canonical-1': {
            id: 'canonical-1',
            walletBalance: 500_000,
            walletOpeningBalance: 0,
            ledgers: [],
            receipts: [],
            invoices: [],
            pendingPayments: [],
          },
          'legacy-1': {
            id: 'legacy-1',
            walletBalance: 250_000,
            walletOpeningBalance: 0,
            ledgers: [],
            receipts: [],
            invoices: [],
            pendingPayments: [],
          },
        },
      })
    );

    expect(plan.money.before.walletBalance).toBe(750_000);
    expect(plan.money.expectedAfter.walletBalance).toBe(750_000);
  });
});
