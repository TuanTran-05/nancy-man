import { queryOptions } from '@tanstack/react-query';
import {
  Assignment,
  Class,
  ClassSession,
  DailyReport,
  Evaluation,
  Student,
  Submission,
} from '../../types';
import { readChannel } from '../api/readApi';
import { readAssignmentsData, readClassDetailData } from '../api/frontendReadApi';
import { officeQueryKeys } from '../office/officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from '../office/officeQueryPolicy';

type ClassDetailRosterResponse = { students: Student[] };

export async function readClassRoster(
  classId: string,
  attendanceTermStart?: string
): Promise<Student[]> {
  const payload = await readChannel<ClassDetailRosterResponse>('class-detail', {
    view: 'roster',
    classId,
    attendanceTermStart,
  });
  return payload.students || [];
}

export function classMetadataQueryOptions(
  identity: OfficeQueryIdentity,
  classId: string,
  enabled: boolean = true
) {
  return queryOptions<Class>({
    queryKey: officeQueryKeys.classMetadata(identity, classId),
    queryFn: async () => {
      const payload = await readClassDetailData(classId);
      if (!payload.class) throw new Error('Class not found');
      return payload.class;
    },
    enabled: enabled && Boolean(classId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function classRosterQueryOptions(
  identity: OfficeQueryIdentity,
  classId: string,
  attendanceTermStart?: string,
  enabled: boolean = true
) {
  return queryOptions<Student[]>({
    queryKey: officeQueryKeys.classRoster(identity, classId),
    queryFn: () => readClassRoster(classId, attendanceTermStart),
    enabled: enabled && Boolean(classId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function classEvaluationsQueryOptions(
  identity: OfficeQueryIdentity,
  classId: string,
  enabled: boolean = true
) {
  return queryOptions<Evaluation[]>({
    queryKey: officeQueryKeys.classEvaluations(identity, classId),
    queryFn: async () => {
      const payload = await readClassDetailData(classId);
      return (payload.evaluations || []).filter((evaluation) => !(evaluation as any).isDeleted);
    },
    enabled: enabled && Boolean(classId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function classAssignmentsQueryOptions(
  identity: OfficeQueryIdentity,
  classId: string,
  enabled: boolean = true
) {
  return queryOptions<Assignment[]>({
    queryKey: officeQueryKeys.classAssignments(identity, classId),
    queryFn: async () => {
      const payload = await readAssignmentsData();
      return (payload.assignments || []).filter(
        (assignment) => assignment.classId === classId && !(assignment as any).isDeleted
      );
    },
    enabled: enabled && Boolean(classId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function classSubmissionsQueryOptions(
  identity: OfficeQueryIdentity,
  classId: string,
  enabled: boolean = true
) {
  return queryOptions<Submission[]>({
    queryKey: officeQueryKeys.classSubmissions(identity, classId),
    queryFn: async () => {
      const payload = await readAssignmentsData();
      return (payload.submissions || []).filter(
        (submission) => submission.classId === classId && !(submission as any).isDeleted
      );
    },
    enabled: enabled && Boolean(classId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function classSessionsQueryOptions(
  identity: OfficeQueryIdentity,
  classId: string,
  enabled: boolean = true
) {
  return queryOptions<ClassSession[]>({
    queryKey: officeQueryKeys.classSessions(identity, classId),
    queryFn: async () => {
      const payload = await readClassDetailData(classId);
      return payload.sessions || [];
    },
    enabled: enabled && Boolean(classId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function classDailyReportsQueryOptions(
  identity: OfficeQueryIdentity,
  classId: string,
  enabled: boolean = true
) {
  return queryOptions<DailyReport[]>({
    queryKey: officeQueryKeys.classDailyReports(identity, classId),
    queryFn: async () => {
      const payload = await readClassDetailData(classId);
      const reports = payload.reports || [];
      if (identity.role === 'admin' || identity.role === 'office') return reports;
      return reports.filter((report) => report.teacherId === identity.uid);
    },
    enabled: enabled && Boolean(classId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}
