import { PostgresDocumentStore } from '@/server/db/documentStore.js';
import type { ApiRequest, ApiResponse } from '../http/types.js';
import { normalizeAuthRole, type AuthRole } from './roles.js';
import { buildUserContextFromData, type UserContext } from './authz.js';
import {
  decodedFromSession,
  loadSession,
  type DecodedAuthToken,
  type SessionPrincipal,
} from './sessionStore.js';

export const db = new PostgresDocumentStore();

export function getDb(): PostgresDocumentStore {
  return db;
}

function contextFromPrincipal(principal: SessionPrincipal): UserContext {
  return buildUserContextFromData(
    { uid: principal.uid, email: principal.email },
    {
      role: principal.role,
      displayName: principal.displayName,
      studentId: principal.studentId,
      classId: principal.classId,
      teacherId: principal.teacherId,
    }
  );
}

function rejectMissingSession(res: ApiResponse) {
  res.status(401).json({ success: false, error: 'Missing or expired session' });
  return null;
}

function hasRequiredRole(principal: SessionPrincipal, roles?: AuthRole[]): boolean {
  return !roles?.length || roles.includes(principal.role);
}

export async function verifyAuthToken(
  req: ApiRequest,
  res: ApiResponse,
  requiredRoles?: AuthRole[]
): Promise<DecodedAuthToken | null> {
  try {
    const principal = await loadSession(req);
    if (!principal) return rejectMissingSession(res);
    if (!hasRequiredRole(principal, requiredRoles)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return null;
    }
    return decodedFromSession(principal);
  } catch (error) {
    console.error('[auth] Session verification failed', error);
    res.status(503).json({
      success: false,
      error: 'Unable to verify account status. Please try again later.',
    });
    return null;
  }
}

export type VerifiedAuthContext = {
  decoded: DecodedAuthToken;
  context: UserContext;
};

export function clearVerifiedAuthContextCache(): void {
  // Kept as a no-op compatibility export for focused tests and maintenance
  // tooling. Native sessions are checked in PostgreSQL on every request.
}

export async function verifyAuthContext(
  req: ApiRequest,
  res: ApiResponse,
  requiredRoles?: AuthRole[]
): Promise<VerifiedAuthContext | null> {
  try {
    const principal = await loadSession(req);
    if (!principal) return rejectMissingSession(res);
    const role = normalizeAuthRole(principal.role);
    if (!role || (requiredRoles?.length && !requiredRoles.includes(role))) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return null;
    }
    return {
      decoded: decodedFromSession(principal),
      context: contextFromPrincipal(principal),
    };
  } catch (error) {
    console.error('[auth] Session context verification failed', error);
    res.status(503).json({
      success: false,
      error: 'Unable to verify account status. Please try again later.',
    });
    return null;
  }
}
