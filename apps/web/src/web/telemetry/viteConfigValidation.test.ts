import { describe, expect, it } from 'vitest';

import { validateProductionBrowserTelemetryBuild } from '../../../vite.config.js';

const validEnvironment = {
  VITE_OPS_BROWSER_TELEMETRY_ENABLED: 'true',
  VITE_OPS_BROWSER_INGEST_URL: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
  VITE_OPS_BROWSER_PROJECT_KEY: 'ops-web-public-key',
  VITE_APP_RELEASE_SHA: '0123456789abcdef0123456789abcdef01234567'
};

describe('Ops production browser telemetry Vite validation', () => {
  it('rejects a production build before bundling when public telemetry config is absent', () => {
    expect(() => validateProductionBrowserTelemetryBuild('build', 'production', {})).toThrow(
      'Ops browser telemetry must be enabled in production'
    );
  });

  it('accepts complete public config and does not constrain dev/test Vite invocations', () => {
    expect(() =>
      validateProductionBrowserTelemetryBuild('build', 'production', validEnvironment)
    ).not.toThrow();
    expect(() => validateProductionBrowserTelemetryBuild('serve', 'development', {})).not.toThrow();
  });
});
