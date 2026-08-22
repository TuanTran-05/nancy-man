// Shared utility functions for load tests

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');
export const healthDuration = new Trend('health_duration', true);

export function checkResponse(
  res: http.ResponseRefined<http.ResponseBody | null>,
  expectedStatus: number,
  endpoint: string
): boolean {
  const passed = check(res, {
    [`${endpoint} status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${endpoint} response time < 5s`]: (r) => r.timings.duration < 5000,
  });

  if (!passed) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }

  return passed;
}
