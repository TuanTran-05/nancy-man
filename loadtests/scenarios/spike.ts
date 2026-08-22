// Spike Test: Sudden traffic burst (e.g., all students logging in at class start)
// Run: k6 run -e BASE_URL=https://app-staging.example.com -e ADMIN_TOKEN=xxx loadtests/scenarios/spike.ts

import { sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, ADMIN_TOKEN } from '../k6.config.ts';
import { getHealth } from '../endpoints/health.ts';
import { verifyStudentLogin } from '../endpoints/verify-student-login.ts';
import { getAuditLogs } from '../endpoints/audit-logs.ts';

const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 5 }, // Baseline
        { duration: '3m', target: 5 }, // Stable baseline
        { duration: '10s', target: 100 }, // SPIKE!
        { duration: '3m', target: 100 }, // Sustained spike
        { duration: '10s', target: 5 }, // Drop back
        { duration: '3m', target: 5 }, // Recovery
        { duration: '1m', target: 0 }, // Wind down
      ],
      gracefulRampDown: '30s',
    },
  },

  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.30'],
  },
};

export default function () {
  const rand = Math.random();

  // Login storm simulation during spike
  if (rand < 0.5) {
    // 50% - Student login (simulates login storm)
    verifyStudentLogin();
  } else if (rand < 0.8) {
    // 30% - Health checks
    getHealth();
  } else {
    // 20% - Admin checking logs
    if (ADMIN_TOKEN) {
      getAuditLogs(ADMIN_TOKEN);
    } else {
      getHealth();
    }
  }

  sleep(Math.random() * 1 + 0.2); // Short think time during spike
}
