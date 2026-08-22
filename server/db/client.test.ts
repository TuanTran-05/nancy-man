import { describe, expect, it } from 'vitest';
import { readPostgresConfig } from './client.js';

describe('readPostgresConfig', () => {
  it('requires DATABASE_URL only when the SQL client is requested', () => {
    expect(() => readPostgresConfig({})).toThrow(/DATABASE_URL/);
  });

  it('uses bounded pool defaults suitable for a traditional VPS', () => {
    expect(readPostgresConfig({ DATABASE_URL: 'postgres://localhost/edutrack' })).toMatchObject({
      connectionString: 'postgres://localhost/edutrack',
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'edutrack-api',
    });
  });

  it('rejects unsafe or malformed pool settings', () => {
    expect(() =>
      readPostgresConfig({
        DATABASE_URL: 'postgres://localhost/edutrack',
        POSTGRES_POOL_MAX: '0',
      })
    ).toThrow(/POSTGRES_POOL_MAX/);
    expect(() =>
      readPostgresConfig({
        DATABASE_URL: 'postgres://localhost/edutrack',
        POSTGRES_SSL: 'sometimes',
      })
    ).toThrow(/POSTGRES_SSL/);
  });

  it('supports explicit TLS modes without weakening it by default', () => {
    expect(
      readPostgresConfig({
        DATABASE_URL: 'postgres://localhost/edutrack',
        POSTGRES_SSL: 'disable',
      }).ssl
    ).toBe(false);
    expect(
      readPostgresConfig({
        DATABASE_URL: 'postgres://localhost/edutrack',
        POSTGRES_SSL: 'verify-full',
      }).ssl
    ).toEqual({ rejectUnauthorized: true });
  });
});
