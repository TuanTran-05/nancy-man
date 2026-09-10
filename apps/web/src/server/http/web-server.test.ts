import { describe, expect, it } from 'vitest';

import { createOpsWebTelemetryStop } from './web-server.js';

describe('Ops web telemetry lifecycle', () => {
  it('keeps the binding installed until its one shared flush completes', async () => {
    const order: string[] = [];
    let releaseFlush: (() => void) | undefined;
    const stop = createOpsWebTelemetryStop({
      stopMaintenance: () => order.push('maintenance'),
      flush: async () => {
        order.push('flush:start');
        await new Promise<void>((resolve) => {
          releaseFlush = resolve;
        });
        order.push('flush:end');
      },
      disposeNodeTelemetryLifecycle: () => order.push('dispose:node'),
      disposeRuntimeTelemetry: () => order.push('dispose:runtime')
    });

    const first = stop();
    const second = stop();
    await Promise.resolve();
    expect(order).toEqual(['maintenance', 'flush:start']);

    releaseFlush?.();
    await Promise.all([first, second]);

    expect(order).toEqual([
      'maintenance',
      'flush:start',
      'flush:end',
      'dispose:node',
      'dispose:runtime'
    ]);
  });

  it('contains a hostile flush but still uninstalls both lifecycle bindings', async () => {
    const order: string[] = [];
    const stop = createOpsWebTelemetryStop({
      stopMaintenance: () => order.push('maintenance'),
      flush: async () => {
        order.push('flush');
        throw new Error('transport failed');
      },
      disposeNodeTelemetryLifecycle: () => order.push('dispose:node'),
      disposeRuntimeTelemetry: () => order.push('dispose:runtime')
    });

    await expect(stop()).resolves.toBeUndefined();
    expect(order).toEqual(['maintenance', 'flush', 'dispose:node', 'dispose:runtime']);
  });
});
