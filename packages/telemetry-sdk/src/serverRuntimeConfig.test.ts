import { describe, expect, it } from 'vitest';

import { readServerTelemetryRuntimeConfig } from './serverRuntimeConfig.js';

const production = {
  NODE_ENV: 'production',
  OPS_TELEMETRY_ENABLED: 'true',
  OPS_TELEMETRY_INGEST_URL: 'https://man.thienuy.edu.vn/api/v1/ingest/server',
  OPS_TELEMETRY_KEY_ID: 'edutrack-ops-runtime',
  OPS_TELEMETRY_HMAC_SECRET_REFERENCE: 'ops-telemetry-hmac',
  OPS_TELEMETRY_RELEASE: '0123456789abcdef0123456789abcdef01234567',
  OPS_TELEMETRY_SPOOL_ROOT: '/var/lib/edutrack-ops/telemetry',
  OPS_TELEMETRY_SPOOL_DIRECTORY: '/var/lib/edutrack-ops/telemetry'
};

describe('server telemetry runtime configuration', () => {
  it('requires enabled telemetry for production processes', () => {
    expect(() => readServerTelemetryRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'OPS_TELEMETRY_ENABLED is required'
    );
    expect(() =>
      readServerTelemetryRuntimeConfig({ NODE_ENV: 'production', OPS_TELEMETRY_ENABLED: 'false' })
    ).toThrow('OPS_TELEMETRY_ENABLED must be true in production');
  });

  it('accepts only the canonical signed ingest endpoint and an enclosed spool directory', () => {
    expect(readServerTelemetryRuntimeConfig(production)).toEqual({
      enabled: true,
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/server',
      keyId: 'edutrack-ops-runtime',
      hmacSecretReference: 'ops-telemetry-hmac',
      release: '0123456789abcdef0123456789abcdef01234567',
      spoolRoot: '/var/lib/edutrack-ops/telemetry',
      spoolDirectory: '/var/lib/edutrack-ops/telemetry'
    });

    expect(() =>
      readServerTelemetryRuntimeConfig({
        ...production,
        OPS_TELEMETRY_INGEST_URL: 'https://collector.example.invalid/api/v1/ingest/server'
      })
    ).toThrow('OPS_TELEMETRY_INGEST_URL must target the canonical server ingest endpoint');
    expect(() =>
      readServerTelemetryRuntimeConfig({
        ...production,
        OPS_TELEMETRY_SPOOL_DIRECTORY: '/var/lib/other-service'
      })
    ).toThrow('OPS_TELEMETRY_SPOOL_DIRECTORY must be inside OPS_TELEMETRY_SPOOL_ROOT');
  });
});
