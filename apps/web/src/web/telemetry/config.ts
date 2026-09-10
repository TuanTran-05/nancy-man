import { captureBrowserException } from './runtimeTelemetry.js';

export type OpsBrowserTelemetryConfig =
  | { enabled: false }
  | {
      enabled: true;
      endpoint: string;
      projectKey: string;
      release: string;
    };

export function readOpsBrowserTelemetryConfig(
  environment: Record<string, string | boolean | undefined>,
  production: boolean
): OpsBrowserTelemetryConfig {
  const enabled = environment.VITE_OPS_BROWSER_TELEMETRY_ENABLED === 'true';
  if (!enabled) {
    if (production) throw new Error('Ops browser telemetry must be enabled in production');
    return { enabled: false };
  }
  const endpoint = environment.VITE_OPS_BROWSER_INGEST_URL;
  const projectKey = environment.VITE_OPS_BROWSER_PROJECT_KEY;
  const release = environment.VITE_APP_RELEASE_SHA;
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(typeof endpoint === 'string' ? endpoint : '');
  } catch (error) {
    void captureBrowserException(error, {
      code: 'UNHANDLED_BROWSER_EXCEPTION',
      source: 'browser',
      route: () => globalThis.location?.pathname,
    });
    throw new Error('Ops browser telemetry ingest URL is invalid', { cause: error });
  }
  if (
    endpointUrl.protocol !== 'https:' ||
    endpointUrl.pathname !== '/api/v1/ingest/browser' ||
    endpointUrl.search ||
    endpointUrl.hash ||
    endpointUrl.username ||
    endpointUrl.password
  ) {
    throw new Error('Ops browser telemetry ingest URL is invalid');
  }
  if (typeof projectKey !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(projectKey)) {
    throw new Error('Ops browser telemetry project key is invalid');
  }
  if (typeof release !== 'string' || !/^[a-f0-9]{40}$/.test(release)) {
    throw new Error('Ops browser telemetry release SHA is invalid');
  }
  return { enabled: true, endpoint: endpointUrl.toString(), projectKey, release };
}
