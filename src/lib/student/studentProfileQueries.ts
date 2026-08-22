import { queryOptions } from '@tanstack/react-query';
import {
  fetchStudentAdminReport,
  type StudentAdminReportResponse,
} from '../api/studentAdminReportApi';
import { officeQueryKeys } from '../office/officeQueryKeys';
import { officeSharedQueryOptions, type OfficeQueryIdentity } from '../office/officeQueryPolicy';

export function studentProfileReportQueryOptions(
  identity: OfficeQueryIdentity,
  studentId: string,
  enabled: boolean = true
) {
  return queryOptions<StudentAdminReportResponse>({
    queryKey: officeQueryKeys.studentProfileReport(identity, studentId),
    queryFn: () => fetchStudentAdminReport({ studentId }),
    enabled: enabled && Boolean(studentId && identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}
