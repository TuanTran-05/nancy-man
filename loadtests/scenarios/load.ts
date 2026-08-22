// Load Test: Measure normal operating capacity
// Run: k6 run -e BASE_URL=https://app-staging.example.com -e ADMIN_TOKEN=xxx loadtests/scenarios/load.ts

import { sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { ADMIN_TOKEN } from '../k6.config.ts';
import { getHealth } from '../endpoints/health.ts';
import { getStaffConfig } from '../endpoints/staff-config.ts';
import { verifyStudentLogin } from '../endpoints/verify-student-login.ts';
import { getFinanceReport } from '../endpoints/finance-report.ts';
import { getAuditLogs } from '../endpoints/audit-logs.ts';
import { postReceipt } from '../endpoints/receipt-post.ts';
import {
  getFinanceLedgersPage,
  getParentDashboard,
  getPayOSPaymentList,
  getZaloSendCount,
  getDashboardAggregate,
  getAdminDashboardSummary,
  getAccountingStudents,
} from '../endpoints/read-models.ts';

const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 10 }, // Warm-up
        { duration: '5m', target: 10 }, // Sustained normal
        { duration: '2m', target: 25 }, // Moderate peak
        { duration: '5m', target: 25 }, // Sustained peak
        { duration: '2m', target: 0 }, // Cool-down
      ],
      gracefulRampDown: '30s',
    },
  },

  thresholds: {
    http_req_duration: ['p(50)<700', 'p(95)<1500', 'p(99)<3000'],
    'http_req_duration{endpoint:health}': ['p(95)<1000'],
    'http_req_duration{endpoint:finance-report}': ['p(95)<5000'],
    http_req_failed: ['rate<0.05'],
    http_reqs: ['rate>5'],
  },
};

export default function () {
  const rand = Math.random();

  if (rand < 0.4) {
    // 40% - Health check (baseline)
    getHealth();
  } else if (rand < 0.6) {
    // 20% - Audit logs (authenticated, paginated)
    if (ADMIN_TOKEN) {
      getAuditLogs(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  } else if (rand < 0.72) {
    // 12% - Finance report
    if (ADMIN_TOKEN) {
      getFinanceReport(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  } else if (rand < 0.8) {
    // 8% - Finance paginated read model
    if (ADMIN_TOKEN) {
      getFinanceLedgersPage(ADMIN_TOKEN);
      getDashboardAggregate(ADMIN_TOKEN);
      getAdminDashboardSummary(ADMIN_TOKEN);
      getAccountingStudents(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  } else if (rand < 0.86) {
    // 6% - Payment list read
    if (ADMIN_TOKEN) getPayOSPaymentList(ADMIN_TOKEN);
    else getHealth();
  } else if (rand < 0.94) {
    // 8% - Parent dashboard read boundary
    if (ADMIN_TOKEN) getParentDashboard(ADMIN_TOKEN);
    else getHealth();
  } else if (rand < 0.97) {
    // 3% - Zalo send-count read only
    if (ADMIN_TOKEN) getZaloSendCount(ADMIN_TOKEN);
    else getHealth();
  } else if (rand < 0.99) {
    // 2% - Student login (rate-limited)
    verifyStudentLogin();
  } else if (rand < 0.995) {
    // 0.5% - Staff config
    getStaffConfig(ADMIN_TOKEN);
  } else {
    // 0.5% - Receipt post (transaction)
    if (ADMIN_TOKEN) {
      postReceipt(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  }

  sleep(Math.random() * 2 + 0.5); // 0.5-2.5s think time
}
