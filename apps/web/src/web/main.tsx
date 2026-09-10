import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { OpsErrorBoundary } from './components/OpsErrorBoundary.js';
import {
  captureBrowserException,
  createOpsBrowserRuntimeTelemetry,
  installOpsBrowserRuntimeTelemetry,
  readOpsBrowserTelemetryConfig
} from './telemetry/runtimeTelemetry.js';
import './styles.css';

const telemetryConfig = readOpsBrowserTelemetryConfig(
  import.meta.env as Record<string, string | boolean | undefined>,
  import.meta.env.PROD
);
if (telemetryConfig.enabled) {
  const telemetry = createOpsBrowserRuntimeTelemetry(telemetryConfig);
  installOpsBrowserRuntimeTelemetry(telemetry);
  void telemetry.flush().catch((error) => {
    void captureBrowserException(error, {
      code: 'UNHANDLED_PROMISE_REJECTION',
      source: 'browser',
      route: () => globalThis.location?.pathname,
    });
    return undefined;
  });
}

const root = document.getElementById('root');
if (!root) {
  const error = new Error('Ops Console root element is missing');
  captureBrowserException(error, {
    code: 'OPS_WEB_ROOT_MISSING',
    source: 'browser'
  });
  throw error;
}
createRoot(root).render(React.createElement(OpsErrorBoundary, undefined, React.createElement(App)));
