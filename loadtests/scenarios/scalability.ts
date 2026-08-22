// Scalability Test: Verify VPS capacity behavior
// Run: k6 run -e BASE_URL=https://app-staging.example.com -e ADMIN_TOKEN=xxx loadtests/scenarios/scalability.ts

import { sleep } from 'k6';
import { ADMIN_TOKEN } from '../k6.config.ts';
import { getHealth } from '../endpoints/health.ts';
import { getStaffConfig } from '../endpoints/staff-config.ts';
import { verifyStudentLogin } from '../endpoints/verify-student-login.ts';
import { getFinanceReport } from '../endpoints/finance-report.ts';
import { getAuditLogs } from '../endpoints/audit-logs.ts';
import {
  buildScalabilityOptions,
  normalizeScalabilityTarget,
} from '../lib/scalabilityThresholds.ts';

const scalabilityTarget = normalizeScalabilityTarget(__ENV.SCALABILITY_TARGET);

export const options = buildScalabilityOptions(scalabilityTarget);

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

  sleep(Math.random() * 2 + 0.5);
}
