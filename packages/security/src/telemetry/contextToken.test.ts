import { describe, expect, it } from 'vitest';

import { issueTelemetryContextToken, verifyTelemetryContextToken } from './contextToken.js';

const now = new Date('2026-08-22T03:14:00.000Z');
const payload = {
  audience: 'edutrack-ops-ingest' as const,
  channel: 'browser' as const,
  userRef: 'usr_01',
  role: 'teacher',
  displayLabel: 'Teacher',
  sessionHash: 'a'.repeat(64),
  nonce: 'nonce-01'
};

describe('browser telemetry context token', () => {
  it('issues a fifteen-minute signed identity context and verifies it in constant-time', () => {
    const token = issueTelemetryContextToken(payload, { keyId: 'v1', key: 'signing-key', now });
    const verified = verifyTelemetryContextToken(token, { v1: 'signing-key' }, now);

    expect(verified).toMatchObject(payload);
    expect(verified?.expiresAt).toBe('2026-08-22T03:29:00.000Z');
  });

  it.each([
    ['tampered signature', (token: string) => `${token}tampered`, now],
    ['expired token', (token: string) => token, new Date('2026-08-22T03:30:00.000Z')]
  ])('returns anonymous identity for %s', (_reason, mutate, verificationTime) => {
    const token = issueTelemetryContextToken(payload, { keyId: 'v1', key: 'signing-key', now });

    expect(
      verifyTelemetryContextToken(mutate(token), { v1: 'signing-key' }, verificationTime)
    ).toBeNull();
  });
});
