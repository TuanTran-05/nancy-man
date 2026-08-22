import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, authHeaders } from '../k6.config.ts';

const financeReportExpectedStatuses = http.expectedStatuses(200);

export function getFinanceReport(token: string) {
  const params = {
    ...authHeaders(token),
    tags: { endpoint: 'finance-report' },
    responseCallback: financeReportExpectedStatuses,
  };
  const url = `${BASE_URL}/api/v1/finance/report?startDate=2024-01-01&endDate=2026-12-31`;

  const res = http.get(url, params);

  check(res, {
    'finance-report: status 200': (r) => r.status === 200,
    'finance-report: not server error': (r) => r.status < 500,
  });

  return res;
}
