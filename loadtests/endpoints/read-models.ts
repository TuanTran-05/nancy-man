import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, authHeaders } from '../k6.config.ts';

const readExpectedStatuses = http.expectedStatuses(200, 400, 401, 403, 404);

function getRead(token: string, path: string, endpoint: string) {
  const params = {
    ...authHeaders(token),
    tags: { endpoint },
    responseCallback: readExpectedStatuses,
  };
  const res = http.get(`${BASE_URL}${path}`, params);
  check(res, {
    [`${endpoint}: valid response`]: (r) => [200, 400, 401, 403, 404].includes(r.status),
    [`${endpoint}: not server error`]: (r) => r.status < 500,
  });
  return res;
}

export function getParentDashboard(token: string) {
  return getRead(token, '/api/v1/read/parent-dashboard?limit=20', 'parent-dashboard');
}

export function getFinanceLedgersPage(token: string) {
  return getRead(token, '/api/v1/read/finance?resource=ledgers&limit=50', 'finance-ledgers-page');
}

export function getPayOSPaymentList(token: string) {
  return getRead(token, '/api/v1/payments/payos/list?status=all&limit=50', 'payos-payment-list');
}

export function getZaloSendCount(token: string) {
  return getRead(
    token,
    '/api/v1/zalo/zalo-send-count?studentId=loadtest-student&classId=loadtest-class&type=absence&context=2026-05-26',
    'zalo-send-count'
  );
}

export function getDashboardAggregate(token: string) {
  return getRead(
    token,
    '/api/v1/read/dashboard-aggregate?channel=dashboard-aggregate',
    'read-dashboard-aggregate'
  );
}

export function getAdminDashboardSummary(token: string) {
  return getRead(
    token,
    '/api/v1/read/admin-dashboard-summary?channel=admin-dashboard-summary',
    'read-admin-dashboard-summary'
  );
}

export function getAccountingStudents(token: string) {
  return getRead(
    token,
    '/api/v1/read/accounting-students?channel=accounting-students&limit=100',
    'read-accounting-students'
  );
}
