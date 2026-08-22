import type { OfficeQueryIdentity } from './officeQueryPolicy';

/**
 * Keys are domain-first, then identity, then server parameters.
 *
 * Domain-first rather than role-first because ten of the sixteen
 * Office-reachable routes are also served to admin, teacher or accounting; a
 * role-named namespace would fork one page's cache per role. The `uid` and
 * `role` segments already isolate identity and server projection, and
 * `queryClient` is a module-level singleton that outlives sign-out.
 *
 * Only parameters that change the *server* response belong here. Search text,
 * chip filters, sort order and view mode reshape data the client already has;
 * putting them in a key buys duplicate entries and duplicate identical
 * requests.
 */
export const officeQueryKeyPrefixes = {
  weeklyDashboard: ['office-weekly-dashboard'] as const,
  teachersMonth: ['office-teachers-month'] as const,
  teacherAttendanceWeek: ['teacher-attendance-week'] as const,
  academic: ['office-academic'] as const,
  admissionsPending: ['admissions-pending'] as const,
  admissionsHistory: ['admissions-history'] as const,
  classList: ['class-list'] as const,
  teacherReferences: ['teacher-references'] as const,
  holidays: ['system-holidays'] as const,
  studentIndex: ['student-index'] as const,
  classMetadata: ['class-detail-metadata'] as const,
  classRoster: ['class-detail-roster'] as const,
  classEvaluations: ['class-detail-evaluations'] as const,
  classAssignments: ['class-detail-assignments'] as const,
  classSubmissions: ['class-detail-submissions'] as const,
  classSessions: ['class-detail-sessions'] as const,
  classDailyReports: ['class-detail-daily-reports'] as const,
  studentProfileReport: ['student-profile-report'] as const,
  teacherAvailabilityProfiles: ['teacher-availability-profiles'] as const,
  teacherAvailabilityPending: ['teacher-availability-pending'] as const,
  courseClosingMonth: ['course-closing-record-month'] as const,
  courseClosingRecords: ['course-closing-records'] as const,
  courseClosingFiles: ['course-closing-record-file'] as const,
  printRequests: ['print-requests-list'] as const,
};

export const officeQueryKeys = {
  weeklyDashboard: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.weeklyDashboard, uid, role] as const,

  teachersMonth: ({ uid, role }: OfficeQueryIdentity, month: string) =>
    [...officeQueryKeyPrefixes.teachersMonth, uid, role, month] as const,

  teacherAttendanceWeek: ({ uid, role }: OfficeQueryIdentity, from: string, to: string) =>
    [...officeQueryKeyPrefixes.teacherAttendanceWeek, uid, role, from, to] as const,

  academic: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.academic, uid, role] as const,

  admissionsPending: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.admissionsPending, uid, role] as const,

  admissionsHistoryPage: (
    { uid, role }: OfficeQueryIdentity,
    limit: number,
    cursor: string | null
  ) =>
    [...officeQueryKeyPrefixes.admissionsHistory, uid, role, limit, cursor || '__first__'] as const,

  classList: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.classList, uid, role] as const,

  teacherReferences: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.teacherReferences, uid, role] as const,

  holidays: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.holidays, uid, role] as const,

  studentIndex: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.studentIndex, uid, role] as const,

  classMetadata: ({ uid, role }: OfficeQueryIdentity, classId: string) =>
    [...officeQueryKeyPrefixes.classMetadata, uid, role, classId] as const,

  classRoster: (
    { uid, role }: OfficeQueryIdentity,
    classId: string,
    attendanceTermStart: string = ''
  ) => [...officeQueryKeyPrefixes.classRoster, uid, role, classId, attendanceTermStart] as const,

  classEvaluations: ({ uid, role }: OfficeQueryIdentity, classId: string) =>
    [...officeQueryKeyPrefixes.classEvaluations, uid, role, classId] as const,

  classAssignments: ({ uid, role }: OfficeQueryIdentity, classId: string) =>
    [...officeQueryKeyPrefixes.classAssignments, uid, role, classId] as const,

  classSubmissions: ({ uid, role }: OfficeQueryIdentity, classId: string) =>
    [...officeQueryKeyPrefixes.classSubmissions, uid, role, classId] as const,

  classSessions: ({ uid, role }: OfficeQueryIdentity, classId: string) =>
    [...officeQueryKeyPrefixes.classSessions, uid, role, classId] as const,

  classDailyReports: ({ uid, role }: OfficeQueryIdentity, classId: string) =>
    [...officeQueryKeyPrefixes.classDailyReports, uid, role, classId] as const,

  studentProfileReport: ({ uid, role }: OfficeQueryIdentity, studentId: string) =>
    [...officeQueryKeyPrefixes.studentProfileReport, uid, role, studentId] as const,

  teacherAvailabilityProfiles: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.teacherAvailabilityProfiles, uid, role] as const,

  teacherAvailabilityPending: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.teacherAvailabilityPending, uid, role] as const,

  courseClosingMonth: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.courseClosingMonth, uid, role] as const,

  courseClosingRecordsRoot: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.courseClosingRecords, uid, role] as const,

  courseClosingRecords: (
    { uid, role }: OfficeQueryIdentity,
    month: string,
    normalizedSearch: string = ''
  ) =>
    [
      ...officeQueryKeyPrefixes.courseClosingRecords,
      uid,
      role,
      month,
      normalizedSearch.trim(),
    ] as const,

  courseClosingFilesRoot: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.courseClosingFiles, uid, role] as const,

  courseClosingFile: (
    { uid, role }: OfficeQueryIdentity,
    recordId: string,
    documentType: string,
    mode: 'inline' = 'inline'
  ) =>
    [
      ...officeQueryKeyPrefixes.courseClosingFiles,
      uid,
      role,
      recordId,
      documentType,
      mode,
    ] as const,

  printRequestsRoot: ({ uid, role }: OfficeQueryIdentity) =>
    [...officeQueryKeyPrefixes.printRequests, uid, role] as const,

  printRequestsList: (
    { uid, role }: OfficeQueryIdentity,
    createdDate: string = '',
    neededDate: string = '',
    status: string = 'all'
  ) =>
    [...officeQueryKeyPrefixes.printRequests, uid, role, createdDate, neededDate, status] as const,
};
