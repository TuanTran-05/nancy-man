import type { AttendanceStudentQuickProfileResponse } from '../../../shared/attendanceStudentQuickProfile';
import { readChannel } from './readApi';

export function fetchAttendanceStudentQuickProfile(params: {
  studentId: string;
  classId: string;
}): Promise<AttendanceStudentQuickProfileResponse> {
  return readChannel<AttendanceStudentQuickProfileResponse>(
    'attendance-student-quick-profile',
    params
  );
}
