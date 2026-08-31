import { randomUUID } from 'node:crypto';
import type { OpsRole } from '../../../../../packages/security/src/sessions.js';
import {
  signLegacyMonitoringRequest,
  type LegacyMonitoringRole
} from '../../../../../packages/contracts/src/legacyMonitoringProtocol.js';

type Principal = { userId: string; role: LegacyMonitoringRole };
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function assertLoopbackBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/') {
    throw new Error('Legacy monitoring adapter must be loopback-only');
  }
  return parsed.origin;
}

export class LegacyMonitoringClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly nonce: () => string;

  constructor(input: {
    secret: string;
    baseUrl?: string;
    fetchImpl?: FetchLike;
    now?: () => Date;
    nonce?: () => string;
  }) {
    if (!input.secret) throw new Error('Legacy monitoring secret is required');
    this.baseUrl = assertLoopbackBaseUrl(input.baseUrl ?? 'http://127.0.0.1:3101/');
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.now = input.now ?? (() => new Date());
    this.nonce = input.nonce ?? randomUUID;
    this.secret = input.secret;
  }

  private readonly secret: string;

  async getOverview(principal: Principal): Promise<unknown> {
    return this.request('/internal/v1/monitoring/overview', 'GET', undefined, principal);
  }

  async getInfrastructureHistory(
    input: Principal & { range: '1h' | '24h' | '7d' | '30d' }
  ): Promise<unknown> {
    return this.request(
      `/internal/v1/monitoring/infrastructure/history?range=${input.range}`,
      'GET',
      undefined,
      input
    );
  }

  async acknowledgeIncident(
    input: Principal & { incidentId: string; note: string }
  ): Promise<unknown> {
    return this.request(
      '/internal/v1/monitoring/incidents/ack',
      'POST',
      { incidentId: input.incidentId, note: input.note },
      input
    );
  }

  async getZaloLink(principal: Principal): Promise<unknown> {
    return this.request('/internal/v1/monitoring/zalo/link', 'GET', undefined, principal);
  }

  async createZaloLinkCode(principal: Principal): Promise<unknown> {
    return this.request('/internal/v1/monitoring/zalo/link-code', 'POST', {}, principal);
  }

  async disableZaloLink(principal: Principal): Promise<void> {
    await this.request('/internal/v1/monitoring/zalo/unlink', 'POST', {}, principal);
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    payload: Record<string, unknown> | undefined,
    principal: Principal
  ): Promise<unknown> {
    const rawBody = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = this.now().toISOString();
    const nonce = this.nonce();
    const signature = signLegacyMonitoringRequest({
      secret: this.secret,
      method,
      path,
      timestamp,
      nonce,
      rawBody,
      userId: principal.userId,
      role: principal.role
    });
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      ...(payload === undefined ? {} : { body: rawBody }),
      headers: {
        accept: 'application/json',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Ops-Internal-Timestamp': timestamp,
        'X-Ops-Internal-Nonce': nonce,
        'X-Ops-Internal-Signature': signature,
        'X-Ops-Principal-Id': principal.userId,
        'X-Ops-Principal-Role': principal.role
      }
    });
    if (!response.ok) throw new Error('LEGACY_MONITORING_UNAVAILABLE');
    if (response.status === 204) return undefined;
    return response.json();
  }
}

export type LegacyMonitoringPrincipal = Principal & { role: OpsRole };
