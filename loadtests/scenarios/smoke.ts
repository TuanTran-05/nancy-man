// Smoke Test: Quick sanity check - verify all endpoints are reachable
// Run: k6 run -e BASE_URL=https://app-staging.example.com loadtests/scenarios/smoke.ts

import { sleep } from 'k6';
import { ADMIN_TOKEN } from '../k6.config.ts';
import { getHealth } from '../endpoints/health.ts';
import { getStaffConfig } from '../endpoints/staff-config.ts';
import { verifyStudentLogin } from '../endpoints/verify-student-login.ts';
import { getFinanceReport } from '../endpoints/finance-report.ts';
import { getAuditLogs } from '../endpoints/audit-logs.ts';
import {
  getFinanceLedgersPage,
  getParentDashboard,
  getPayOSPaymentList,
  getZaloSendCount,
} from '../endpoints/read-models.ts';

export const options = {
  vus: 1,
  duration: '30s',

  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  // Test each endpoint once per iteration
  getHealth();
  sleep(0.5);

  getStaffConfig(ADMIN_TOKEN);
  sleep(0.5);

  verifyStudentLogin();
  sleep(0.5);

  if (ADMIN_TOKEN) {
    getFinanceReport(ADMIN_TOKEN);
    sleep(0.5);

    getAuditLogs(ADMIN_TOKEN);
    sleep(0.5);

    getFinanceLedgersPage(ADMIN_TOKEN);
    sleep(0.5);

    getPayOSPaymentList(ADMIN_TOKEN);
    sleep(0.5);

    getZaloSendCount(ADMIN_TOKEN);
    sleep(0.5);

    getParentDashboard(ADMIN_TOKEN);
    sleep(0.5);
  }

  sleep(1);
}
