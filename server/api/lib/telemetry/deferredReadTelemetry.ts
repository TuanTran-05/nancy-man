import { runInBackground } from '../../../runtime/backgroundTasks.js';

/**
 * Work a read performs for the operators, not for the caller.
 *
 * The canonical shadow comparison is the case this exists for. It resolves
 * every id on a page through the identity boundary — roughly four DocumentStore
 * reads per student — and produces log lines and nothing else. Awaiting it
 * inside the request charged the student directory about eight hundred reads
 * per page for output no client has ever read, which is most of the time the
 * page took to appear.
 *
 * Deferring is not dropping. The VPS process registry keeps this work visible
 * after the response and lets graceful shutdown drain it. The local registry
 * below also gives tests a telemetry-specific flush point. Failures are
 * swallowed on purpose — telemetry that can fail a read is worse than
 * telemetry that is occasionally missing.
 */

const pending = new Set<Promise<void>>();

export function deferReadTelemetry(run: () => Promise<void>): void {
  const tracked = (async () => {
    try {
      await run();
    } catch (error) {
      console.warn('[deferred-read-telemetry-failed]', String(error));
    }
  })();

  pending.add(tracked);
  void tracked.finally(() => pending.delete(tracked));
  runInBackground(tracked, 'deferred-read-telemetry');
}

/**
 * Settles everything deferred so far, including work scheduled by that work.
 *
 * Tests assert on telemetry that no longer happens before the response, so
 * they need a point at which it has definitely happened.
 */
export async function flushDeferredReadTelemetry(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
