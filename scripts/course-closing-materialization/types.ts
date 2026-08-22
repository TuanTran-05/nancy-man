import type {
  ClosingDocumentStatus,
  ClosingDocumentType,
  CourseClosingDataUnavailableReason,
  CourseClosingRecord,
} from '../../shared/courseClosingRecords.js';

export interface MaterializationEvidenceDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface MaterializationSourceBundle {
  records: CourseClosingRecord[];
  notifications: MaterializationEvidenceDocument[];
  ledgers: MaterializationEvidenceDocument[];
}

export interface MaterializationStorageState {
  recordId: string;
  documentType: ClosingDocumentType;
  expectedStoragePath: string;
  exists: boolean;
}

export type MaterializationAction =
  | 'unchanged_ready'
  | 'repair_ready_status'
  | 'materialize_verified'
  | 'materialize_unavailable_missing'
  | 'materialize_unavailable_incomplete'
  | 'conflict';

/**
 * A single artifact scheduled for DOCX materialization.
 *
 * Items carry no student name, class name, evaluation content or contact data:
 * the plan is written to disk and reviewed by hand, so it stays free of PII.
 */
export interface MaterializationPlanItem {
  recordId: string;
  documentType: ClosingDocumentType;
  templateVersion: 1;
  action?: MaterializationAction;
  expectedStoragePath?: string;
  recordFingerprint?: string;
  evidenceFingerprint?: string;
  unavailableReason?: CourseClosingDataUnavailableReason;
  conflictCode?: string;
  /** @deprecated Compatibility with pending-only plans. */
  plannedStatus?: ClosingDocumentStatus;
  /** @deprecated Compatibility with pending-only plans. */
  plannedAttempts?: number;
}

export interface MaterializationRunPlan {
  generatedAt: string;
  items: MaterializationPlanItem[];
  blocked?: boolean;
  summary: {
    total?: number;
    evaluation: number;
    tuition: number;
    unchanged_ready?: number;
    repair_ready_status?: number;
    materialize_verified?: number;
    materialize_unavailable_missing?: number;
    materialize_unavailable_incomplete?: number;
    conflict?: number;
    /** @deprecated Compatibility with pending-only plans. */
    planned?: number;
    /** @deprecated Compatibility with pending-only plans. */
    skippedNotRequested?: number;
    /** @deprecated Compatibility with pending-only plans. */
    skippedReady?: number;
    /** @deprecated Compatibility with pending-only plans. */
    skippedRetrying?: number;
    /** @deprecated Compatibility with pending-only plans. */
    skippedFailed?: number;
  };
}

export type MaterializationOutcome =
  | 'materialized'
  | 'unchanged_ready'
  | 'repaired_ready_status'
  | 'skipped_ready'
  | 'exhausted'
  | 'conflicted'
  | 'failed';

export interface MaterializationItemResult {
  recordId: string;
  documentType: ClosingDocumentType;
  outcome: MaterializationOutcome;
  observedStatus?: ClosingDocumentStatus;
  observedAttempts?: number;
  errorCode?: string;
}

export interface MaterializationApplySummary {
  materialized: number;
  unchanged_ready: number;
  repaired_ready_status: number;
  conflicted: number;
  failed: number;
  /** @deprecated Compatibility with pending-only apply summaries. */
  skipped_ready?: number;
  /** @deprecated Compatibility with pending-only apply summaries. */
  exhausted?: number;
  results: MaterializationItemResult[];
}

export type VerificationOutcome = 'ready_with_file' | 'metadata_missing' | 'file_missing';

export interface VerificationItemResult {
  recordId: string;
  documentType: ClosingDocumentType;
  outcome: VerificationOutcome;
  storagePath?: string;
}

export interface MaterializationVerificationSummary {
  ready_with_file: number;
  metadata_missing: number;
  file_missing: number;
  results: VerificationItemResult[];
}

export interface MaterializationTarget {
  projectId: string;
  databaseId: string;
}
