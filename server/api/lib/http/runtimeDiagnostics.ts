import type { ApiResponse } from '@/server/api/lib/http/types.js';

export type RuntimeInvocation = {
  coldStart: boolean;
  invocation: number;
  instanceAgeMs: number;
  region: string;
};

export function createRuntimeInvocationTracker(startedAt = Date.now()) {
  let invocation = 0;

  return {
    record(now = Date.now(), region = process.env.VPS_REGION || 'local'): RuntimeInvocation {
      invocation += 1;
      return {
        coldStart: invocation === 1,
        invocation,
        instanceAgeMs: Math.max(0, now - startedAt),
        region,
      };
    },
  };
}

const runtimeTracker = createRuntimeInvocationTracker();

export function setRuntimeDiagnosticsHeaders(res: ApiResponse): void {
  const runtime = runtimeTracker.record();
  res.setHeader('X-Function-Cold-Start', runtime.coldStart ? '1' : '0');
  res.setHeader('X-Function-Invocation', String(runtime.invocation));
  res.setHeader('X-Function-Instance-Age-Ms', String(runtime.instanceAgeMs));
  res.setHeader('X-Function-Region', runtime.region);
}
