import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, authHeaders } from '../k6.config.ts';

const auditLogsExpectedStatuses = http.expectedStatuses(200);

export function getAuditLogs(token: string) {
  const params = {
    ...authHeaders(token),
    tags: { endpoint: 'audit-logs' },
    responseCallback: auditLogsExpectedStatuses,
  };

  const res = http.get(`${BASE_URL}/api/v1/read/audit-log?limit=20`, params);

  check(res, {
    'audit-logs: status 200': (r) => r.status === 200,
    'audit-logs: not server error': (r) => r.status < 500,
  });

  return res;
}
