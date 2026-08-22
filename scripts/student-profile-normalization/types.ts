import type { StudentProfileMergeStage } from '../../shared/studentProfileMerge.js';

/**
 * Planner, reference, decision, operation, manifest, verification, and
 * rollback types shared across the merge engine modules. Declared once here
 * so the registry, planner, reconcilers, writer, and verifier import the same
 * shapes instead of drifting local variants.
 */

export type StudentReferenceKind =
  | 'profile_owned'
  | 'direct_field'
  | 'keyed_document'
  | 'deterministic_identity'
  | 'nested_payload'
  | 'derived_projection'
  | 'immutable_audit'
  | 'pending_job';

export type StudentReferenceRewriteKind =
  | 'patch_field'
  | 'recreate_document'
  | 'rewrite_nested'
  | 'delete_and_rebuild'
  | 'preserve_via_alias'
  | 'drain_or_rewrite'
  | 'claim_registry'
  | 'create_alias';

export interface StudentReferenceSpec {
  id: string;
  collectionPath: string;
  kind: StudentReferenceKind;
  rewriteKind: StudentReferenceRewriteKind;
  collisionKind: 'not_applicable' | 'block' | 'semantic_identity_only' | 'rebuild';
  rollbackKind:
    | 'reverse_patch'
    | 'restore_source_delete_target'
    | 'rebuild_projection'
    | 'delete_run_created_document'
    | 'preserve_immutable';
  containsMoney: boolean;
  mayRetainLegacyId: boolean;
  fieldPaths: readonly string[];
  pathMatcherId: string;
  fieldMatcherId: string;
  stateMatcherId: string;
  rewriteStrategyId: string;
  targetPathBuilderId: string;
  collisionComparatorId: string;
  verificationId: string;
  rollbackStrategyId: string;
}

export interface StudentMergeDocumentEffect {
  /** The operation whose atomic write produced this effect. */
  operationId?: string;
  path: string;
  beforeFingerprint: string | null;
  afterFingerprint: string | null;
  restoreStrategy:
    | 'restore_before_image'
    | 'delete_run_created_document'
    | 'rebuild_projection'
    | 'preserve_immutable';
  rollbackArtifactEntryId: string | null;
}

export interface EncryptedRollbackArtifactRef {
  fileName: 'student-profile-rollback-before-images.enc';
  algorithm: 'AES-256-GCM';
  digest: string;
  keyId: string;
  entryCount: number;
}

export interface StudentMergeOperation {
  operationId: string;
  groupId: string;
  stage: StudentProfileMergeStage;
  kind: StudentReferenceRewriteKind;
  registryEntryId: string;
  sourceProfileId: string;
  canonicalProfileId: string;
  sourcePath: string | null;
  targetPath: string | null;
  sourceFingerprint: string | null;
  targetBeforeFingerprint: string | null;
  expectedAfterFingerprint: string;
  dependsOn: string[];
  rollbackKind: StudentReferenceSpec['rollbackKind'];
  documentEffects: StudentMergeDocumentEffect[];
}

export type StudentMergeBlockerCode =
  | 'IDENTITY_FIELD_CONFLICT'
  | 'SIBLING_GROUP_CONFLICT'
  | 'WALLET_NONZERO_COLLISION'
  | 'LEDGER_TARGET_COLLISION'
  | 'PENDING_PAYMENT_COLLISION'
  | 'CREDENTIAL_AMBIGUOUS'
  | 'UNKNOWN_LINKED_ROLE'
  | 'DUPLICATE_ROLE_ACCOUNT'
  | 'UNKNOWN_REFERENCE'
  /**
   * A registered reference whose value embeds the id rather than being it —
   * a composite key, a URL, a sentence. Repointing it needs a strategy that
   * knows how the value is composed; assigning the canonical id would corrupt
   * it.
   */
  | 'REFERENCE_VALUE_NOT_A_BARE_ID'
  /**
   * A registered reference is owned by its document key, so changing fields
   * in place would leave the record address bound to the retired profile.
   * The owning reconciler must plan an explicit source-to-target move.
   */
  | 'REFERENCE_DOCUMENT_REKEY_REQUIRED'
  | 'LEGACY_SOFT_MERGE_POINTER_INVALID'
  | 'REGISTRY_CODE_ALREADY_CLAIMED'
  /** A candidate nobody has adjudicated yet, so no merge may be planned from it. */
  | 'IDENTITY_DECISION_REQUIRED'
  /** Adjudicated as one human, with no canonical profile chosen to survive. */
  | 'CANONICAL_PROFILE_UNSELECTED';

export interface StudentMergeBlocker {
  code: StudentMergeBlockerCode;
  candidateId: string;
  detail: string;
}
