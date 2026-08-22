import { describe, expect, it } from 'vitest';
import { resolveApiRoute, SUPPORTED_API_ROUTE_PATTERNS } from './routes.js';

function route(pathname: string) {
  const value = resolveApiRoute(pathname);
  return value && { handlerId: value.handlerId, query: value.query };
}

const VPS_API_ROUTE_CASES = [
  ['/api/v1/messages/:action*', '/api/v1/messages/send', 'zalo', { action: 'send' }],
  ['/api/v1/zalo/:action*', '/api/v1/zalo/send', 'zalo', { action: 'send' }],
  [
    '/api/v1/finance/(receipts|expenses)/([a-zA-Z0-9]+)/(post|void|next-number)',
    '/api/v1/finance/receipts/abc123/post',
    'finance',
    { action: 'post', resource: 'receipts', id: 'abc123' },
  ],
  [
    '/api/v1/finance/(receipts|expenses)/create',
    '/api/v1/finance/receipts/create',
    'finance',
    { action: 'create', resource: 'receipts' },
  ],
  [
    '/api/v1/finance/(receipts|expenses)/create-and-post',
    '/api/v1/finance/expenses/create-and-post',
    'finance',
    { action: 'create-and-post', resource: 'expenses' },
  ],
  [
    '/api/v1/finance/(receipts|expenses)/(next-number)',
    '/api/v1/finance/expenses/next-number',
    'finance',
    { action: 'next-number', resource: 'expenses' },
  ],
  [
    '/api/v1/finance/wallet/deposit-and-post',
    '/api/v1/finance/wallet/deposit-and-post',
    'finance',
    { action: 'deposit-and-post', resource: 'wallet' },
  ],
  [
    '/api/v1/finance/wallet/transactions',
    '/api/v1/finance/wallet/transactions',
    'finance',
    { action: 'transactions', resource: 'wallet' },
  ],
  [
    '/api/v1/finance/wallet/balances',
    '/api/v1/finance/wallet/balances',
    'finance',
    { action: 'balances', resource: 'wallet' },
  ],
  [
    '/api/v1/finance/wallet/student-context',
    '/api/v1/finance/wallet/student-context',
    'finance',
    { action: 'student-context', resource: 'wallet' },
  ],
  [
    '/api/v1/finance/wallet/allocate-and-post',
    '/api/v1/finance/wallet/allocate-and-post',
    'finance',
    { action: 'allocate-and-post', resource: 'wallet' },
  ],
  [
    '/api/v1/finance/wallet/([a-zA-Z0-9]+)/(void)',
    '/api/v1/finance/wallet/abc123/void',
    'finance',
    { action: 'void', resource: 'wallet', id: 'abc123' },
  ],
  ['/api/v1/finance/report', '/api/v1/finance/report', 'finance', { action: 'report' }],
  [
    '/api/v1/classes/generate-ledgers',
    '/api/v1/classes/generate-ledgers',
    'classes',
    { action: 'generate-ledgers' },
  ],
  ['/api/v1/health', '/api/v1/health', 'audit', { action: 'health' }],
  ['/api/v1/edu/:action*', '/api/v1/edu/assignments', 'edu', { action: 'assignments' }],
  [
    '/api/v1/teacher-attendance/:action*',
    '/api/v1/teacher-attendance/list',
    'attendance',
    { action: 'list', resource: 'teacher-attendance' },
  ],
  ['/api/v1/zalo-bot/:action*', '/api/v1/zalo-bot/link', 'zalo', { action: 'bot-link' }],
  ['/api/zalo-bot/:action*', '/api/zalo-bot/link', 'zalo', { action: 'bot-link' }],
  ['/api/v1/:path*', '/api/v1/payments/payos/reconcile', 'payments/payos', { action: 'reconcile' }],
  ['/api/:path*', '/api/read/student-dashboard', 'read', { channel: 'student-dashboard' }],
] as const;

describe('VPS API route table', () => {
  it('has one executable example for every supported public route pattern', () => {
    expect(VPS_API_ROUTE_CASES.map(([source]) => source)).toEqual([
      ...SUPPORTED_API_ROUTE_PATTERNS,
    ]);
  });

  it.each(VPS_API_ROUTE_CASES)(
    'preserves $0 with sample $1',
    (_source, pathname, handlerId, query) => {
      expect(route(pathname)).toEqual({ handlerId, query });
    }
  );

  it('adds a liveness route without changing the public compatibility patterns', () => {
    expect(route('/api/v1/liveness')).toEqual({
      handlerId: 'audit',
      query: { action: 'liveness' },
    });
  });

  it('routes signed local object reads through the storage handler', () => {
    expect(route('/api/v1/files/read')).toEqual({
      handlerId: 'files',
      query: { action: 'read' },
    });
  });

  it('preserves handler resolution for nested generic routes', () => {
    const pathname = '/api/v1/payments/payos/reconcile';
    const handlerId = 'payments/payos';
    const query = { action: 'reconcile' };
    expect(route(pathname)).toEqual({ handlerId, query });
  });

  it('keeps generic fallback semantics after special routes', () => {
    expect(route('/api/v1/finance/wallet/id/not-an-action')).toEqual({
      handlerId: 'finance',
      query: { action: 'wallet/id/not-an-action' },
    });
  });

  it.each([
    ['/api/v1/admissions/recent', 'admissions', { action: 'recent' }],
    ['/api/v1/attendance/toggle', 'attendance', { action: 'toggle' }],
    ['/api/v1/audit/log', 'audit', { action: 'log' }],
    ['/api/v1/auth/google-link-start', 'auth', { action: 'google-link-start' }],
    ['/api/v1/classes/update', 'classes', { action: 'update' }],
    ['/api/v1/edu/assignment-create', 'edu', { action: 'assignment-create' }],
    ['/api/v1/files/read', 'files', { action: 'read' }],
    ['/api/v1/knowledge-bank/download', 'knowledge-bank', { action: 'download' }],
    ['/api/v1/read/students', 'read', { channel: 'students' }],
    ['/api/v1/students/update', 'students', { action: 'update' }],
    ['/api/v1/zalo/bulk-notification-job', 'zalo', { action: 'bulk-notification-job' }],
  ] as const)('routes native VPS endpoint %s', (pathname, handlerId, query) => {
    expect(route(pathname)).toEqual({ handlerId, query });
  });

  it('rejects malformed or unknown routes', () => {
    expect(resolveApiRoute('/api/unknown/action')).toBeNull();
    expect(resolveApiRoute('/not-api')).toBeNull();
    expect(resolveApiRoute('/api/%E0%A4%A/action')).toBeNull();
  });
});
