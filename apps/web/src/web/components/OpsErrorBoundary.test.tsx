// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installOpsBrowserRuntimeTelemetry } from '../telemetry/runtimeTelemetry.js';
import { OpsErrorBoundary } from './OpsErrorBoundary.js';

afterEach(() => cleanup());

describe('OpsErrorBoundary', () => {
  it('captures the original render Error with its component stack before showing fallback UI', () => {
    const captured: Array<{ error: unknown; componentStack?: string }> = [];
    const error = new Error('dashboard render failed');
    const uninstall = installOpsBrowserRuntimeTelemetry(
      {
        captureException: (caught, context) => {
          captured.push({
            error: caught,
            componentStack:
              typeof context.componentStack === 'string' ? context.componentStack : undefined
          });
          return 'EVT_00000000000000000000000000';
        },
        flush: async () => undefined,
        healthy: () => true
      },
      { window, document }
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function ThrowingPanel(): never {
      throw error;
    }

    try {
      render(
        <OpsErrorBoundary>
          <ThrowingPanel />
        </OpsErrorBoundary>
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Không thể hiển thị bảng điều khiển.');
      expect(captured).toHaveLength(1);
      expect(captured[0]?.error).toBe(error);
      expect(captured[0]?.componentStack).toContain('ThrowingPanel');
    } finally {
      consoleError.mockRestore();
      uninstall();
    }
  });
});
