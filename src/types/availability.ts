export type AvailabilityPairKey = 'tue_thu' | 'wed_fri' | 'sat_sun' | 'sun_mon';
export type AvailabilityDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface TeacherAvailabilitySlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  allowedPairs: AvailabilityPairKey[];
  active: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeacherAvailabilitySelection {
  dayKey?: AvailabilityDayKey;
  pairKey?: AvailabilityPairKey;
  slotId: string;
}

export interface TeacherAvailabilityProfile {
  id: string;
  teacherId: string;
  teacherName: string;
  selections: TeacherAvailabilitySelection[];
  selectionKeys: string[];
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeacherAvailabilityChangeRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  currentSelections: TeacherAvailabilitySelection[];
  requestedSelections: TeacherAvailabilitySelection[];
  requestedSelectionKeys?: string[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt?: string;
}
