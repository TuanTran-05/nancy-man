// Shared configuration for all k6 load tests
// Usage: k6 run -e BASE_URL=https://app-staging.example.com -e ADMIN_TOKEN=xxx loadtests/scenarios/smoke.ts

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const STAFF_TOKEN = __ENV.STAFF_TOKEN || '';
export const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';

export function authHeaders(token: string) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}

export function publicHeaders() {
  return {
    headers: { 'Content-Type': 'application/json' },
  };
}
