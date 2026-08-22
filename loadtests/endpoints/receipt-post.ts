import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, authHeaders } from '../k6.config.ts';
import { assertSafeLoadtestTarget } from '../lib/productionGuard.ts';

const receiptPostExpectedStatuses = http.expectedStatuses(200, 400, 404);

export function postReceipt(token: string, receiptId?: string) {
  assertSafeLoadtestTarget({ baseUrl: __ENV.BASE_URL, env: __ENV.LOADTEST_ENV });
  const id = receiptId || 'loadtest-receipt-001';
  const params = {
    ...authHeaders(token),
    tags: { endpoint: 'receipt-post' },
    responseCallback: receiptPostExpectedStatuses,
  };

  const res = http.post(`${BASE_URL}/api/v1/finance/receipts/${id}/post`, null, params);

  check(res, {
    'receipt-post: valid response': (r) => r.status === 200 || r.status === 400 || r.status === 404,
    'receipt-post: not server error': (r) => r.status < 500,
  });

  return res;
}
