import type { StudentCourseJoin, StudentLeavePeriod } from '../../shared/studentEnrollmentWindows';
import type {
  CanonicalStudentPlacementStatus,
  CanonicalStudentEnrollmentView,
} from '../../shared/canonicalStudentReadModel';

export type { StudentCourseJoin, StudentLeavePeriod };

export type EnrollmentStatus = 'active' | 'on_leave' | 'dropped' | 'promoted';
export type StudentLifecycle = 'pending' | 'lead' | 'trial' | 'enrolled' | 'archived';
export type TrialReviewStatus =
  | 'pending_sessions'
  | 'pending_teacher_review'
  | 'accepted'
  | 'rejected';

export interface Student {
  id: string;
  name: string;
  studentId: string; // School/Class ID
  dob: string;
  contact: string;
  classId: string;
  teacherId: string;
  createdAt: string;
  faceImage?: string; // base64 string
  faceImageStoragePath?: string; // Canonical object-storage path for student face images
  code: string; // Unique login code for student
  customLoginPasswordSet?: boolean;
  loginPasswordSalt?: string;
  loginPasswordHash?: string;
  passwordVersion?: number; // 1=SHA-256 (legacy), 2=PBKDF2
  parentPasswordSet?: boolean;
  parentPasswordSalt?: string;
  parentPasswordHash?: string;
  parentPasswordVersion?: number;
  forcePasswordChange?: boolean;
  parentForcePasswordChange?: boolean;
  enrollmentStatus?: EnrollmentStatus;
  studentLifecycle?: StudentLifecycle;
  admissionStatus?: 'pending' | 'trial' | 'accepted' | 'rejected';
  trialReviewStatus?: TrialReviewStatus;
  trialSessionCount?: number;
  trialRequiredSessions?: number;
  trialStartedAt?: string;
  trialClassId?: string;
  trialTeacherId?: string;
  admittedAt?: string;
  admittedBy?: string;
  trialDecisionAt?: string;
  trialDecisionBy?: string;
  trialDecisionNote?: string;
  archiveReason?: string;
  statusNote?: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
  enrollmentDate?: string;
  leaveUntil?: string;
  courseJoins?: StudentCourseJoin[];
  leavePeriods?: StudentLeavePeriod[];
  isRevoked?: boolean;
  gender?: 'male' | 'female' | 'other';
  grade?: number; // 1-12
  /** Shared id defining a sibling group. A group is every student holding this id. */
  siblingGroupId?: string;
  walletBalance?: number;
  walletHistoryStartedAt?: string;
  walletOpeningBalance?: number;
  /**
   * Server-derived identity and placement. Present from `canonical_preferred`
   * onwards; absent in a response written before the rollout, which is why
   * every consumer treats them as optional rather than authoritative-or-throw.
   *
   * `placementStatus` supersedes `enrollmentStatus` where both are present:
   * the former is derived from the enrollment, the latter is a projection of
   * it that goes stale on its own.
   */
  canonicalProfileId?: string;
  placementStatus?: CanonicalStudentPlacementStatus;
  /** Set when the caller asked by an id a merge retired. */
  requestedProfileId?: string;
  redirected?: boolean;
  /**
   * The exact canonical enrollment for the class roster's course term.
   * Present on enrollment-backed Class Detail roster rows (current or
   * explicitly historical); absent on unscoped directory and self-reads.
   */
  attendanceEnrollment?: CanonicalStudentEnrollmentView;
}

export type SafeStudent = Omit<
  Student,
  | 'loginPasswordHash'
  | 'loginPasswordSalt'
  | 'passwordVersion'
  | 'parentPasswordHash'
  | 'parentPasswordSalt'
  | 'parentPasswordVersion'
>;

export type RiskLevel = 'low' | 'medium' | 'high';

export type QuickNotifyTemplateKey =
  | 'absence_today'
  | 'late_today'
  | 'missing_assignment'
  | 'support_needed'
  | 'praise_progress';

export interface StudentClassroomRisk {
  studentId: string;
  level: RiskLevel;
  reasons: string[];
  absent14d: number;
  late14d: number;
  overdueAssignments: number;
  latestScore: number | null;
  scoreDelta: number | null;
}
