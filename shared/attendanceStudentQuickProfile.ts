export type QuickProfileAttendanceSummary = {
  attendedSessions: number;
  totalSessions: number;
};

export type AttendanceStudentQuickProfileResponse = {
  student: {
    id: string;
    name: string;
    studentId: string;
    classId: string;
    dob: string;
    contact: string;
    gender?: 'male' | 'female' | 'other';
    enrollmentStatus?: 'active' | 'on_leave' | 'dropped' | 'promoted';
    statusNote?: string;
    faceImage?: string;
    faceImageStoragePath?: string;
  };
  class: { id: string; name: string };
  attendance: QuickProfileAttendanceSummary | null;
  finance?: {
    hasLedgerData: boolean;
    totalPaid: number;
    totalOutstanding: number;
  };
  generatedAt: string;
};
