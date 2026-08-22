import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { normalizeAuthRole } from '../auth/roles.js';
import { sendApiError as unifiedSendApiError } from './apiResponse.js';

export function normalizeBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function getString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value.trim() : '';
}

export function getOptionalString(
  body: Record<string, unknown>,
  field: string
): string | undefined {
  const value = body[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function getNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function getUserAgent(req: ApiRequest): string {
  const value = req.headers['user-agent'];
  return Array.isArray(value) ? value[0] || 'unknown' : value || 'unknown';
}

export async function getUserRoleAndName(
  db: DocumentStore,
  uid: string,
  fallbackEmail?: string
): Promise<{ role: string; name: string }> {
  const userDoc = await db.collection('users').doc(uid).get();
  const data = userDoc.data() || {};
  const role = normalizeAuthRole(data.role);
  return {
    role: role || 'unknown',
    name:
      (typeof data.displayName === 'string' && data.displayName) ||
      (typeof data.name === 'string' && data.name) ||
      fallbackEmail ||
      uid,
  };
}

export function getStatusCode(err: unknown, fallback = 400): number {
  return typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
    ? (err as { statusCode: number }).statusCode
    : fallback;
}

export function withStatus(message: string, statusCode: number): Error {
  const err = new Error(message);
  (err as Error & { statusCode?: number }).statusCode = statusCode;
  return err;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type StripStudentCredentialsOptions = {
  keepDob?: boolean;
};

const CREDENTIAL_FIELDS = new Set([
  'loginPasswordHash',
  'loginPasswordSalt',
  'passwordVersion',
  'parentPasswordHash',
  'parentPasswordSalt',
  'parentPasswordVersion',
  'dob',
]);

export function stripStudentCredentials<T extends Record<string, unknown>>(
  data: T,
  options: StripStudentCredentialsOptions = {}
) {
  const result = { ...data };
  for (const f of CREDENTIAL_FIELDS) {
    if (f === 'dob' && options.keepDob) continue;
    delete result[f as keyof typeof result];
  }
  return result;
}

export function sendError(res: ApiResponse, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

export function sendSuccess(res: ApiResponse, data?: Record<string, unknown>) {
  return res.status(200).json({ success: true, ...data });
}

export const sendApiError = unifiedSendApiError;
