// Soak/Endurance Test: Run for extended period to detect memory leaks
// Run: k6 run -e BASE_URL=https://app-staging.example.com -e ADMIN_TOKEN=xxx loadtests/scenarios/soak.ts
// Note: Extend duration to 4-8 hours for production validation

import { sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, ADMIN_TOKEN } from '../k6.config.ts';
import { getHealth } from '../endpoints/health.ts';
import { getStaffConfig } from '../endpoints/staff-config.ts';
import { verifyStudentLogin } from '../endpoints/verify-student-login.ts';
import { getFinanceReport } from '../endpoints/finance-report.ts';
import { getAuditLogs } from '../endpoints/audit-logs.ts';

const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    soak_test: {
      executor: 'constant-vus',
      vus: 15,
      duration: '60m', // 1 hour default; extend for longer tests
    },
  },

  thresholds: {
    http_req_duration: ['p(50)<500', 'p(95)<1500', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    // Custom threshold: p95 should not degrade more than 2x over time
  },
};

export default function () {
  const rand = Math.random();

  if (rand < 0.35) {
    getHealth();
  } else if (rand < 0.55) {
    if (ADMIN_TOKEN) {
      getAuditLogs(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  } else if (rand < 0.7) {
    if (ADMIN_TOKEN) {
      getFinanceReport(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  } else if (rand < 0.85) {
    verifyStudentLogin();
  } else {
    getStaffConfig(ADMIN_TOKEN);
  }

  sleep(Math.random() * 3 + 1); // 1-4s think time (sustained load)
}
