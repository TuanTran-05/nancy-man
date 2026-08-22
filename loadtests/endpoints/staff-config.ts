import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, authHeaders, publicHeaders } from '../k6.config.ts';

const staffConfigSuccessStatuses = http.expectedStatuses(200);
const staffConfigProtectedStatuses = http.expectedStatuses(401, 403);

function hasEmailsPayload(body: unknown): boolean {
  try {
    const parsed = JSON.parse(body as string);
    return Array.isArray(parsed.emails) || Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function getStaffConfig(adminToken = '') {
  const params = adminToken ? authHeaders(adminToken) : publicHeaders();
  const res = http.get(`${BASE_URL}/api/v1/auth/staff-config`, {
    ...params,
    tags: { endpoint: 'staff-config' },
    responseCallback: adminToken ? staffConfigSuccessStatuses : staffConfigProtectedStatuses,
  });

  if (adminToken) {
    check(res, {
      'staff-config: status 200': (r) => r.status === 200,
      'staff-config: has emails': (r) => hasEmailsPayload(r.body),
    });
  } else {
    check(res, {
      'staff-config: rejects anonymous access': (r) => r.status === 401 || r.status === 403,
      'staff-config: not server error': (r) => r.status < 500,
    });
  }

  return res;
}
