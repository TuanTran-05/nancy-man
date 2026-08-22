import { apiRequest } from '../api/apiClient';
import type { EnrollmentStatus, StudentLifecycle, TrialReviewStatus } from '../../types';

export type AdmissionSearchInput = {
  name: string;
  dob: string;
  contact: string;
};

export type AdmissionCreateTrialInput = {
  name?: string;
  dob?: string;
  contact?: string;
  grade?: number;
  classId: string;
  selectedHistoricalStudentId?: string;
  pendingStudentId?: string;
  note?: string;
  joinedAt?: string;
};

export type AdmissionCreateTrialResult = {
  mode: 'created' | 'reactivated';
  studentId: string;
  studentCode: string;
  trialReviewStatus: 'pending_sessions';
};

export type AdmissionAddToWaitlistInput = {
  name: string;
  dob: string;
  contact: string;
  grade?: number;
  note?: string;
};

export type AdmissionAddToWaitlistResult = {
  mode: 'added';
  studentId: string;
  studentCode: string;
};

export type AdmissionMatch = {
  id: string;
  data: {
    name?: string;
    studentId?: string;
    dob?: string;
    contact?: string;
    classId?: string;
    trialClassId?: string;
    grade?: number;
    enrollmentStatus?: EnrollmentStatus;
    studentLifecycle?: StudentLifecycle;
    admissionStatus?: 'trial' | 'accepted' | 'rejected';
    trialReviewStatus?: TrialReviewStatus;
  };
  reasons: string[];
  latestClassId?: string;
  latestClassName?: string;
};

export type RecentAdmission = {
  id: string;
  action: string;
  studentId?: string;
  studentName?: string;
  classId?: string;
  className?: string;
  trialSessionCount?: number;
  trialRequiredSessions?: number;
  trialReviewStatus?: string;
  studentLifecycle?: string;
};

type ApiEnvelope<T> = {
  success: true;
  data: T;
};

export async function searchHistoricalAdmissions(input: AdmissionSearchInput) {
  const params = new URLSearchParams(input);
  const response = await apiRequest<
    ApiEnvelope<{ exactMatches: AdmissionMatch[]; possibleMatches: AdmissionMatch[] }>
  >(`/api/v1/admissions/search-historical?${params.toString()}`);
  return response.data;
}

export async function createTrialAdmission(input: AdmissionCreateTrialInput) {
  const response = await apiRequest<ApiEnvelope<AdmissionCreateTrialResult>>(
    '/api/v1/admissions/create-trial',
    {
      method: 'POST',
      body: input,
    }
  );
  return response.data;
}

export type RecentAdmissionsResponse = {
  admissions: RecentAdmission[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
};

export async function readRecentAdmissions(
  limit?: number,
  cursor?: string
): Promise<RecentAdmissionsResponse> {
  const params = new URLSearchParams();
  if (limit) params.append('limit', String(limit));
  if (cursor) params.append('cursor', cursor);
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await apiRequest<ApiEnvelope<RecentAdmissionsResponse>>(
    `/api/v1/admissions/recent${query}`
  );
  return response.data;
}

export async function addToWaitlist(input: AdmissionAddToWaitlistInput) {
  const response = await apiRequest<ApiEnvelope<AdmissionAddToWaitlistResult>>(
    '/api/v1/admissions/add-to-waitlist',
    {
      method: 'POST',
      body: input,
    }
  );
  return response.data;
}

export async function deletePendingStudent(studentId: string) {
  const response = await apiRequest<ApiEnvelope<{ studentId: string; success: boolean }>>(
    '/api/v1/admissions/delete-pending',
    {
      method: 'POST',
      body: { studentId },
    }
  );
  return response.data;
}

export type PendingStudent = {
  id: string;
  name: string;
  studentId: string;
  dob: string;
  contact: string;
  grade: number | null;
  note?: string;
  createdAt: string;
};

export async function listPendingStudents() {
  const response = await apiRequest<ApiEnvelope<{ students: PendingStudent[] }>>(
    '/api/v1/admissions/list-pending'
  );
  return response.data;
}
