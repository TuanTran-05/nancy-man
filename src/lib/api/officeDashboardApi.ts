import { readChannel } from './readApi';

export type OfficeDashboardTeacher = {
  uid: string;
  displayName: string;
  email?: string;
};

export type OfficeDashboardClassTerm = {
  id?: string;
  name?: string;
  startDate: string;
  endDate: string;
};

export type WeeklyClassSessionDto = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
};

export type OfficeDashboardClass = {
  id: string;
  name: string;
  teacherId: string;
  schedule?: string;
  daysOfWeek: number[];
  startDate: string;
  endDate?: string;
  startTime?: string;
  room?: string;
  status?: string;
  grade: number | null;
  holidays?: string[];
  terms?: OfficeDashboardClassTerm[];
  weeklySessions?: WeeklyClassSessionDto[];
};

export type OfficeDashboardStudentCount = {
  currentTotal: number;
  active: number;
  onLeave: number;
};

export type OfficeWeeklyDashboardResponse = {
  classes: OfficeDashboardClass[];
  teachers: OfficeDashboardTeacher[];
  studentCounts: Record<string, OfficeDashboardStudentCount>;
  serverTime: number;
};

export function readOfficeWeeklyDashboard() {
  return readChannel<OfficeWeeklyDashboardResponse>('office-weekly-dashboard', { limit: 2000 });
}
