import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import admissionsHandler from '../api/admissions/route.js';
import attendanceHandler from '../api/attendance/route.js';
import auditHandler from '../api/audit/route.js';
import authHandler from '../api/auth/route.js';
import classesHandler from '../api/classes/route.js';
import eduHandler from '../api/edu/route.js';
import financeHandler from '../api/finance/route.js';
import filesHandler from '../api/storage/route.js';
import knowledgeBankHandler from '../api/knowledge-bank/route.js';
import payosHandler from '../api/payments/payos/route.js';
import readHandler from '../api/read/route.js';
import studentsHandler from '../api/students/route.js';
import zaloHandler from '../api/zalo/route.js';

export type ApiHandler = (
  req: ApiRequest,
  res: ApiResponse
) => void | ApiResponse | Promise<void | ApiResponse>;

export type ApiHandlerId =
  | 'admissions'
  | 'attendance'
  | 'audit'
  | 'auth'
  | 'classes'
  | 'edu'
  | 'finance'
  | 'files'
  | 'knowledge-bank'
  | 'payments/payos'
  | 'read'
  | 'students'
  | 'zalo';

export interface ApiRouteResolution {
  handlerId: ApiHandlerId;
  handler: ApiHandler;
  query: Record<string, string>;
}

export const SUPPORTED_API_ROUTE_PATTERNS = [
  '/api/v1/messages/:action*',
  '/api/v1/zalo/:action*',
  '/api/v1/finance/(receipts|expenses)/([a-zA-Z0-9]+)/(post|void|next-number)',
  '/api/v1/finance/(receipts|expenses)/create',
  '/api/v1/finance/(receipts|expenses)/create-and-post',
  '/api/v1/finance/(receipts|expenses)/(next-number)',
  '/api/v1/finance/wallet/deposit-and-post',
  '/api/v1/finance/wallet/transactions',
  '/api/v1/finance/wallet/balances',
  '/api/v1/finance/wallet/student-context',
  '/api/v1/finance/wallet/allocate-and-post',
  '/api/v1/finance/wallet/([a-zA-Z0-9]+)/(void)',
  '/api/v1/finance/report',
  '/api/v1/classes/generate-ledgers',
  '/api/v1/health',
  '/api/v1/edu/:action*',
  '/api/v1/teacher-attendance/:action*',
  '/api/v1/zalo-bot/:action*',
  '/api/zalo-bot/:action*',
  '/api/v1/:path*',
  '/api/:path*',
] as const;

const ACTION_HANDLERS: Partial<Record<string, { id: ApiHandlerId; handler: ApiHandler }>> = {
  admissions: { id: 'admissions', handler: admissionsHandler },
  attendance: { id: 'attendance', handler: attendanceHandler },
  audit: { id: 'audit', handler: auditHandler },
  auth: { id: 'auth', handler: authHandler },
  classes: { id: 'classes', handler: classesHandler },
  edu: { id: 'edu', handler: eduHandler },
  finance: { id: 'finance', handler: financeHandler },
  files: { id: 'files', handler: filesHandler },
  'knowledge-bank': { id: 'knowledge-bank', handler: knowledgeBankHandler },
  students: { id: 'students', handler: studentsHandler },
  zalo: { id: 'zalo', handler: zaloHandler },
};

function decodePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function splitPath(pathname: string): string[] | null {
  const parts = pathname.split('/').filter(Boolean);
  const decoded = parts.map(decodePart);
  return decoded.some((part) => part === null) ? null : (decoded as string[]);
}

function result(
  handlerId: ApiHandlerId,
  handler: ApiHandler,
  query: Record<string, string>
): ApiRouteResolution {
  return { handlerId, handler, query };
}

function resolveDirectApi(parts: string[]): ApiRouteResolution | null {
  if (parts[0] !== 'api') return null;

  if (parts[1] === 'payments' && parts[2] === 'payos' && parts.length >= 4) {
    return result('payments/payos', payosHandler, { action: parts.slice(3).join('/') });
  }

  if (parts[1] === 'read' && parts.length >= 3) {
    return result('read', readHandler, { channel: parts.slice(2).join('/') });
  }

  const entry = ACTION_HANDLERS[parts[1]];
  if (!entry || parts.length < 3) return null;
  return result(entry.id, entry.handler, { action: parts.slice(2).join('/') });
}

/**
 * Nguon su that duy nhat cho routing tren VPS.
 *
 * Cac route dac biet duoc giai truoc, sau do `/api/v1/:path*` moi roi ve
 * route truc tiep.
 */
export function resolveApiRoute(pathname: string): ApiRouteResolution | null {
  const parts = splitPath(pathname);
  if (!parts || parts[0] !== 'api') return null;

  if (parts[1] !== 'v1') {
    if (parts[1] === 'zalo-bot' && parts.length >= 3) {
      return result('zalo', zaloHandler, { action: `bot-${parts.slice(2).join('/')}` });
    }
    return resolveDirectApi(parts);
  }

  const v1 = parts.slice(2);

  if ((v1[0] === 'messages' || v1[0] === 'zalo') && v1.length >= 2) {
    return result('zalo', zaloHandler, { action: v1.slice(1).join('/') });
  }

  if (v1[0] === 'zalo-bot' && v1.length >= 2) {
    return result('zalo', zaloHandler, { action: `bot-${v1.slice(1).join('/')}` });
  }

  if (v1[0] === 'teacher-attendance' && v1.length >= 2) {
    return result('attendance', attendanceHandler, {
      action: v1.slice(1).join('/'),
      resource: 'teacher-attendance',
    });
  }

  if (v1[0] === 'health' && v1.length === 1) {
    return result('audit', auditHandler, { action: 'health' });
  }

  if (v1[0] === 'liveness' && v1.length === 1) {
    return result('audit', auditHandler, { action: 'liveness' });
  }

  if (v1[0] === 'finance') {
    const tail = v1.slice(1);
    const resource = tail[0];
    if ((resource === 'receipts' || resource === 'expenses') && tail.length === 2) {
      if (tail[1] === 'create' || tail[1] === 'create-and-post' || tail[1] === 'next-number') {
        return result('finance', financeHandler, { action: tail[1], resource });
      }
    }
    if (
      (resource === 'receipts' || resource === 'expenses') &&
      tail.length === 3 &&
      /^[a-zA-Z0-9]+$/.test(tail[1]) &&
      (tail[2] === 'post' || tail[2] === 'void' || tail[2] === 'next-number')
    ) {
      return result('finance', financeHandler, {
        action: tail[2],
        resource,
        id: tail[1],
      });
    }
    if (resource === 'wallet' && tail.length === 2) {
      const action = tail[1];
      if (
        action === 'deposit-and-post' ||
        action === 'transactions' ||
        action === 'balances' ||
        action === 'student-context' ||
        action === 'allocate-and-post'
      ) {
        return result('finance', financeHandler, { action, resource: 'wallet' });
      }
    }
    if (
      resource === 'wallet' &&
      tail.length === 3 &&
      /^[a-zA-Z0-9]+$/.test(tail[1]) &&
      tail[2] === 'void'
    ) {
      return result('finance', financeHandler, {
        action: 'void',
        resource: 'wallet',
        id: tail[1],
      });
    }
    if (resource === 'report' && tail.length === 1) {
      return result('finance', financeHandler, { action: 'report' });
    }
  }

  // Rewrite chung `/api/v1/:path*` -> `/api/:path*`.
  return resolveDirectApi(['api', ...v1]);
}
