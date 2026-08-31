import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { signLegacyMonitoringRequest } from '../../../../../packages/contracts/src/legacyMonitoringProtocol.js';
import { LegacyMonitoringClient } from './legacyMonitoringClient.js';

describe('LegacyMonitoringClient', () => {
  it('sends signed loopback requests with the canonical principal and exact body', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3101/internal/v1/monitoring/incidents/ack');
      const body = String(init?.body ?? '');
      const headers = new Headers(init?.headers);
      const signed = signLegacyMonitoringRequest({
        secret: 'adapter-secret',
        method: 'POST',
        path: '/internal/v1/monitoring/incidents/ack',
        timestamp: headers.get('x-ops-internal-timestamp') ?? '',
        nonce: headers.get('x-ops-internal-nonce') ?? '',
        rawBody: body,
        userId: 'owner-id',
        role: 'ops_owner'
      });
      expect(headers.get('x-ops-internal-signature')).toBe(signed);
      expect(headers.get('x-ops-principal-id')).toBe('owner-id');
      expect(headers.get('x-ops-principal-role')).toBe('ops_owner');
      return new Response(JSON.stringify({ id: 'incident-id', acknowledgedBy: 'owner-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    const client = new LegacyMonitoringClient({
      secret: 'adapter-secret',
      fetchImpl: fetchMock,
      now: () => new Date('2026-08-31T12:00:00.000Z'),
      nonce: () => 'nonce-0123456789abcdef'
    });
    await expect(
      client.acknowledgeIncident({
        userId: 'owner-id',
        role: 'ops_owner',
        incidentId: 'incident-id',
        note: 'Đã kiểm tra'
      })
    ).resolves.toEqual({ id: 'incident-id', acknowledgedBy: 'owner-id' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses a raw empty body for GET and maps upstream failure without exposing response text', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.body).toBeUndefined();
      expect(createHash('sha256').update('', 'utf8').digest('hex')).toHaveLength(64);
      return new Response('sensitive upstream detail', { status: 503 });
    });
    const client = new LegacyMonitoringClient({ secret: 'adapter-secret', fetchImpl: fetchMock });
    await expect(client.getOverview({ userId: 'viewer-id', role: 'ops_viewer' })).rejects.toThrow(
      'LEGACY_MONITORING_UNAVAILABLE'
    );
  });
});
