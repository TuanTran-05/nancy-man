// Stress Test: Find the breaking point
// Run: k6 run -e BASE_URL=https://app-staging.example.com -e ADMIN_TOKEN=xxx loadtests/scenarios/stress.ts

import { sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, ADMIN_TOKEN } from '../k6.config.ts';
import { getHealth } from '../endpoints/health.ts';
import { getStaffConfig } from '../endpoints/staff-config.ts';
import { verifyStudentLogin } from '../endpoints/verify-student-login.ts';
import { getFinanceReport } from '../endpoints/finance-report.ts';
import { getAuditLogs } from '../endpoints/audit-logs.ts';
import { postReceipt } from '../endpoints/receipt-post.ts';

const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    stress_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 20 },
        { duration: '5m', target: 20 },
        { duration: '2m', target: 50 },
        { duration: '5m', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 150 },
        { duration: '5m', target: 150 },
        { duration: '2m', target: 200 },
        { duration: '3m', target: 200 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },

  thresholds: {
    // Observation thresholds - track when these are exceeded
    http_req_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.50'],
  },
};

export default function () {
  const rand = Math.random();

  // Higher weight on heavy endpoints to find breaking point faster
  if (rand < 0.3) {
    getHealth();
  } else if (rand < 0.55) {
    // 25% finance report (heavy)
    if (ADMIN_TOKEN) {
      getFinanceReport(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  } else if (rand < 0.75) {
    // 20% audit logs
    if (ADMIN_TOKEN) {
      getAuditLogs(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  } else if (rand < 0.85) {
    verifyStudentLogin();
  } else if (rand < 0.95) {
    getStaffConfig(ADMIN_TOKEN);
  } else {
    if (ADMIN_TOKEN) {
      postReceipt(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  }

  sleep(Math.random() * 1 + 0.3); // Shorter think time to maximize pressure
}
