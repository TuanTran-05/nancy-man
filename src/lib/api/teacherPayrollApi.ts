import { readChannel } from './readApi';
import type { OfficeTeachersMonthResponse } from './officeTeachersApi';

export type TeacherPayrollMonthResponse = OfficeTeachersMonthResponse;

export function readTeacherPayrollMonth(month: string) {
  return readChannel<TeacherPayrollMonthResponse>('teacher-payroll-month', { month });
}
