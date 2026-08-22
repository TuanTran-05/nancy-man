import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, publicHeaders } from '../k6.config.ts';

export function getHealth() {
  const res = http.get(`${BASE_URL}/api/v1/health`, {
    ...publicHeaders(),
    tags: { endpoint: 'health' },
  });

  check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: has status field': (r) => {
      try {
        return JSON.parse(r.body as string).status === 'ok';
      } catch {
        return false;
      }
    },
  });

  return res;
}
