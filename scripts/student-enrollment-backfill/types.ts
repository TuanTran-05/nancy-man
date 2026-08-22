import type { StudentCourseEnrollment } from '../../shared/studentCourseEnrollment.js';

export type SourceDoc = {
  id: string;
  data: Record<string, unknown>;
  updateTime?: string;
};

export type SafeEnrollmentExclusionCode =
  | 'ARCHIVED_STUDENT'
  | 'NON_CURRENT_STATUS'
  | 'EXISTING_ENROLLMENT'
  | 'MISSING_CLASS_ID'
  | 'MISSING_CLASS'
  | 'INVALID_CLASS_START'
  | 'FUTURE_CLASS'
  | 'INVALID_CLASS_END'
  | 'ENDED_CLASS';

export type SafeEnrollmentCandidate = {
  enrollment: StudentCourseEnrollment;
  studentFingerprint: string;
  classFingerprint: string;
};

export type SafeEnrollmentSourceBundle = {
  students: SourceDoc[];
  classes: SourceDoc[];
  existingByStudent: Map<string, StudentCourseEnrollment[]>;
};

export type SafeEnrollmentApplyJournalEntry = {
  documentId: string;
  studentId: string;
  payloadFingerprint: string;
  createdAt: string;
};

export type SafeEnrollmentApplyResult = {
  attempted: number;
  created: number;
  conflicted: number;
  createdDocumentIds: string[];
  journalSyncFailedDocumentIds: string[];
};

export type SafeEnrollmentVerification = {
  valid: boolean;
  checkedCandidates: number;
  missingDocumentIds: string[];
  mismatchedDocumentIds: string[];
  multipleOpenStudentIds: string[];
  remainingCandidateStudentIds: string[];
};

export type SafeEnrollmentRollbackBlockReason =
  | 'NOT_IN_REVIEWED_MANIFEST'
  | 'JOURNAL_MISMATCH'
  | 'DOCUMENT_MISSING'
  | 'DOCUMENT_CHANGED'
  | 'DOCUMENT_CONFIRMED';

export type SafeEnrollmentRollbackPlan = {
  safeToDelete: string[];
  blocked: Array<{
    documentId: string;
    reason: SafeEnrollmentRollbackBlockReason;
  }>;
};

export type SafeEnrollmentRollbackResult = {
  deleted: number;
  conflicted: number;
  deletedDocumentIds: string[];
};

export type SafeEnrollmentRollbackVerification = {
  valid: boolean;
  checked: number;
  remainingDocumentIds: string[];
};

export type SafeEnrollmentPlanItem = {
  studentId: string;
  classId: string | null;
  decision: 'create' | 'exclude';
  reason: 'SAFE_CURRENT_ENROLLMENT' | SafeEnrollmentExclusionCode;
  candidate?: SafeEnrollmentCandidate;
};

export type SafeEnrollmentPlan = {
  migrationId: 'safe-student-course-enrollments-v2';
  generatedAt: string;
  vietnamDate: string;
  items: SafeEnrollmentPlanItem[];
  summary: {
    scannedStudents: number;
    create: number;
    excluded: Record<SafeEnrollmentExclusionCode, number>;
    byStatus: { active: number; on_leave: number };
  };
  invariants: {
    duplicateCandidateStudentIds: string[];
    duplicateCandidateDocumentIds: string[];
    invalidCandidateDocumentIds: string[];
  };
};

export type SafeEnrollmentPlannerInput = SafeEnrollmentSourceBundle & {
  generatedAt: string;
  vietnamDate: string;
};
