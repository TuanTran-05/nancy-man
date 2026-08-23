import type { DashboardOverview, Incident } from '../shared/models.js';

export interface SessionInfo { username: string; csrfToken: string; expiresAt: string; }

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) }, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const getSession = () => request<SessionInfo>('/api/session');
export const login = (credentials: { username: string; password: string; totp: string }) => request<SessionInfo>('/api/session', { method: 'POST', body: JSON.stringify(credentials) });
export const logout = (csrfToken: string) => request<void>('/api/session', { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } });
export const getOverview = () => request<DashboardOverview>('/api/overview');
export const acknowledgeIncident = (id: string, note: string, csrfToken: string) => request<Incident>(`/api/incidents/${encodeURIComponent(id)}/ack`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ note }) });
