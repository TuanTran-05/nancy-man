import type {
  DashboardOverview,
  Incident,
  InfrastructureHistoryRange,
  InfrastructureHistoryResponse
} from '../shared/models.js';

export type OpsRole = 'ops_owner' | 'ops_maintainer' | 'ops_readonly';
export type OpsAccountStatus = 'pending_mfa' | 'active' | 'locked' | 'revoked';

export interface OpsAccountSummary {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: OpsRole;
  status: OpsAccountStatus;
  mfaEnrolled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionInfo {
  userId: string;
  username?: string;
  displayName?: string;
  role?: OpsRole;
  csrfToken?: string;
  expiresAt?: string;
}

export interface MfaFactor {
  id: string;
  type: 'totp';
  label: string;
}

export interface MfaRequired {
  status: 'mfa_required';
  mfaChallenge: string;
  factors: MfaFactor[];
}

export interface ZaloLinkInfo {
  linked: boolean;
  linkedAt?: string;
  lastSeenAt?: string;
}

export interface ApiError extends Error {
  code?: string;
  status?: number;
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {})
    },
    credentials: 'same-origin'
  });
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = (await response.json()) as { code?: unknown };
      if (typeof body.code === 'string') code = body.code;
    } catch {
      // The status remains the useful error when a proxy returns a non-JSON body.
    }
    const error = new Error(code ?? `HTTP_${response.status}`) as ApiError;
    error.code = code;
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const beginLogin = (credentials: { identifier: string; password: string }) =>
  request<MfaRequired>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials)
  });

export const completeLogin = (input: {
  mfaChallenge: string;
  factorId: string;
  token: string;
}) =>
  request<SessionInfo>('/api/v1/auth/login/totp', {
    method: 'POST',
    body: JSON.stringify(input)
  });

export const getSession = () => request<SessionInfo>('/api/v1/auth/session');

export const logout = (csrfToken: string) =>
  request<void>('/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'X-Ops-CSRF': csrfToken },
    body: '{}'
  });

export const getOverview = () => request<DashboardOverview>('/api/v1/monitoring/overview');

export const getInfrastructureHistory = (range: InfrastructureHistoryRange) =>
  request<InfrastructureHistoryResponse>(`/api/v1/monitoring/infrastructure/history?range=${range}`);

export const acknowledgeIncident = (id: string, note: string, csrfToken: string) =>
  request<Incident>(`/api/v1/monitoring/incidents/${encodeURIComponent(id)}/ack`, {
    method: 'POST',
    headers: { 'X-Ops-CSRF': csrfToken },
    body: JSON.stringify({ note })
  });

export const getZaloLink = () => request<ZaloLinkInfo>('/api/v1/zalo/link');

export const createZaloLinkCode = (csrfToken: string) =>
  request<{ code: string; command: string; expiresAt: string }>('/api/v1/zalo/link-code', {
    method: 'POST',
    headers: { 'X-Ops-CSRF': csrfToken },
    body: '{}'
  });

export const disableZaloLink = (csrfToken: string) =>
  request<void>('/api/v1/zalo/link', {
    method: 'DELETE',
    headers: { 'X-Ops-CSRF': csrfToken }
  });

export const getAccounts = () =>
  request<{ accounts: OpsAccountSummary[] }>('/api/v1/users');

export const createAccount = (
  input: { username: string; email: string; displayName: string; role: OpsRole },
  csrfToken: string
) =>
  request<{ userId: string; enrollmentUrl: string; expiresAt: string }>('/api/v1/users', {
    method: 'POST',
    headers: { 'X-Ops-CSRF': csrfToken },
    body: JSON.stringify(input)
  });

export const changeAccountRole = (userId: string, role: OpsRole, csrfToken: string) =>
  request<void>(`/api/v1/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    headers: { 'X-Ops-CSRF': csrfToken },
    body: JSON.stringify({ role })
  });

export const lockAccount = (userId: string, reason: string, csrfToken: string) =>
  request<void>(`/api/v1/users/${encodeURIComponent(userId)}/lock`, {
    method: 'POST',
    headers: { 'X-Ops-CSRF': csrfToken },
    body: JSON.stringify({ reason })
  });

export const recoverAccount = (userId: string, csrfToken: string) =>
  request<{ userId: string; enrollmentUrl: string; expiresAt: string }>(
    `/api/v1/users/${encodeURIComponent(userId)}/recover`,
    { method: 'POST', headers: { 'X-Ops-CSRF': csrfToken }, body: '{}' }
  );

export const revokeAccount = (userId: string, confirmationUsername: string, csrfToken: string) =>
  request<void>(`/api/v1/users/${encodeURIComponent(userId)}/revoke`, {
    method: 'POST',
    headers: { 'X-Ops-CSRF': csrfToken },
    body: JSON.stringify({ confirmationUsername })
  });
