import type { CourseClosingRecord } from '../../shared/courseClosingRecords.js';

export type BackfillSourceDoc = {
  id: string;
  data: Record<string, unknown>;
  updateTime?: string;
};

export interface BackfillSourceBundle {
  classes: BackfillSourceDoc[];
  students: BackfillSourceDoc[];
  evaluations: BackfillSourceDoc[];
  notifications: BackfillSourceDoc[];
  ledgers: BackfillSourceDoc[];
  enrollments: BackfillSourceDoc[];
  users: BackfillSourceDoc[];
  existingRecords: CourseClosingRecord[];
  existingRecordVersions?: Record<string, string>;
}

export type BackfillDecisionKind = 'create' | 'merge' | 'unchanged' | 'ambiguous' | 'skipped';

export type BackfillReasonCode =
  | 'READY_RECORD_PRESERVED'
  | 'IDENTITY_INCOMPLETE'
  | 'INVALID_COURSE_DATES'
  | 'CONFLICTING_COURSE_ID'
  | 'EVALUATION_SOURCE_INVALID'
  | 'TUITION_SOURCE_INVALID'
  | 'EXISTING_SNAPSHOT_CONFLICT'
  | 'NO_CLOSING_EVIDENCE'
  | 'PLANNED_CREATE'
  | 'PLANNED_MERGE'
  | 'NO_CHANGE';

export interface BackfillPlanItem {
  recordId: string;
  classId: string;
  className: string;
  courseId: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  decision: BackfillDecisionKind;
  reasons: BackfillReasonCode[];
  candidate?: CourseClosingRecord;
  expectedExists?: boolean;
  existingVersion?: string;
}

export interface BackfillRunPlan {
  generatedAt: string;
  items: BackfillPlanItem[];
  summary: Record<BackfillDecisionKind, number>;
}
