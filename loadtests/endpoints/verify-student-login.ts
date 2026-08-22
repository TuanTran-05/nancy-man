import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, publicHeaders } from '../k6.config.ts';

// Pool of test student codes to spread across rate limit buckets
const TEST_CODES = Array.from({ length: 50 }, (_, i) => `TEST${String(i + 1).padStart(4, '0')}`);
const studentLoginExpectedStatuses = http.expectedStatuses(200, 400, 401, 429);

export function verifyStudentLogin(code?: string) {
  const studentCode = code || TEST_CODES[Math.floor(Math.random() * TEST_CODES.length)];

  const payload = JSON.stringify({
    code: studentCode,
    password: 'TestPassword123!',
  });

  const res = http.post(`${BASE_URL}/api/v1/auth/verify-student-login`, payload, {
    ...publicHeaders(),
    tags: { endpoint: 'verify-student-login' },
    responseCallback: studentLoginExpectedStatuses,
  });

  check(res, {
    'login: returns valid status': (r) =>
      r.status === 200 || r.status === 400 || r.status === 401 || r.status === 429,
    'login: not server error': (r) => r.status < 500,
  });

  return res;
}
