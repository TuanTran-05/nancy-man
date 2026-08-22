export interface UserProfile {
  uid: string;
  email?: string;
  displayName?: string;
  bio?: string;
  role: 'teacher' | 'student' | 'parent' | 'admin' | 'accounting' | 'office';
  studentId?: string; // Linked student record ID
  classId?: string; // For students
  teacherId?: string; // For students to know their teacher
  faceImage?: string; // Student's face image
  faceImageStoragePath?: string; // Canonical object-storage path for student face images
  updatedAt?: string;
  forcePasswordChange?: boolean; // Force user to change password on next login
  phone?: string; // Staff phone number (Zalo OA)
  blockedTeacher?: boolean;
  blockedAt?: string;
  enrollmentStatus?: 'active' | 'on_leave' | 'dropped' | 'promoted';
  statusChangedAt?: string;
  isRevoked?: boolean;
}

export type EducationLevel = 'primary' | 'lower_secondary' | 'upper_secondary';

export const LEVEL_GRADE_RANGES: Record<
  EducationLevel,
  { min: number; max: number; label: { vi: string; en: string } }
> = {
  primary: { min: 1, max: 5, label: { vi: 'Tiểu học', en: 'Primary' } },
  lower_secondary: { min: 6, max: 9, label: { vi: 'THCS', en: 'Lower Secondary' } },
  upper_secondary: { min: 10, max: 12, label: { vi: 'THPT', en: 'Upper Secondary' } },
};

export interface PasswordResetRequest {
  id: string;
  userId: string; // studentId or parentId (the 'code' or 'studentId' field)
  studentDocId: string; // Canonical PostgreSQL student ID
  type: 'student' | 'parent';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
  teacherId: string;
  studentName: string;
  reason?: string;
  phoneNumber: string;
  method?: 'otp' | 'email' | 'manual_request';
}

export interface StaffPasswordResetRequest {
  id: string;
  uid: string; // Application account ID
  email: string;
  displayName: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt?: string;
  reason?: string;
  requestedBy: string; // uid of the requester (themselves)
}
