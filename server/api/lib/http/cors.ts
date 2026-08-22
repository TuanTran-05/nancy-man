import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { setRuntimeDiagnosticsHeaders } from './runtimeDiagnostics.js';

const localOrigins = ['http://localhost:3000', 'http://localhost:5173'];
const configuredOrigins = (process.env.APP_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS: string[] =
  configuredOrigins.length > 0
    ? configuredOrigins
    : process.env.NODE_ENV === 'production'
      ? []
      : localOrigins;

export function setCorsHeaders(res: ApiResponse, origin?: string) {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleCorsPreflight(req: ApiRequest, res: ApiResponse): boolean {
  setRuntimeDiagnosticsHeaders(res);
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  setCorsHeaders(res, origin);
  if (req.method !== 'OPTIONS') return false;
  res.status(200).end();
  return true;
}
