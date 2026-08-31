import { describe, expect, test } from 'vitest';

import {
  createHealthCheckRunner,
  HealthCheckRunnerError,
  type HealthCheckDefinition,
  type HealthProbeDependencies
} from './healthCheckRunner.js';

const definitions: readonly HealthCheckDefinition[] = [
  {
    id: 'process.active',
    kind: 'process_stable',
    target: 'edutrack',
    timeoutMs: 1_000,
    observationMs: 20
  },
  {
    id: 'http.readiness_local',
    kind: 'http',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3100,
    path: '/healthz',
    timeoutMs: 1_000,
    maxBodyBytes: 256,
    allowRedirects: false
  },
  {
    id: 'release.identity',
    kind: 'release_identity',
    target: 'edutrack',
    timeoutMs: 1_000
  }
];

function deps(overrides: Partial<HealthProbeDependencies> = {}): HealthProbeDependencies {
  return {
    processProbe: async () => ({ active: true, stable: true }),
    fetch: async () => new Response('{"status":"ok"}', { status: 200 }),
    identityProbe: async () => ({ releaseId: 'release-1', configDigest: 'digest-1' }),
    ...overrides
  };
}

describe('fixed config-agent health checks', () => {
  test('runs manifest-fixed process, local HTTP, and identity checks with value-free results', async () => {
    const runner = createHealthCheckRunner({ definitions, dependencies: deps() });

    const result = await runner.run({
      runId: 'RUN_HEALTH_1',
      checkIds: definitions.map((item) => item.id),
      expectedReleaseId: 'release-1',
      expectedConfigDigest: 'digest-1'
    });

    expect(result.every((item) => item.outcome === 'passed')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('status');
    expect(result[0]).toMatchObject({ checkId: 'process.active', attempts: 1 });
  });

  test('rejects redirects, wrong identity, unstable process, and caller-selected targets', async () => {
    const runner = createHealthCheckRunner({
      definitions,
      dependencies: deps({
        processProbe: async () => ({ active: true, stable: false }),
        fetch: async () =>
          new Response('', { status: 302, headers: { location: 'https://evil.test' } }),
        identityProbe: async () => ({ releaseId: 'other', configDigest: 'other' })
      })
    });

    const result = await runner.run({
      runId: 'RUN_HEALTH_2',
      checkIds: definitions.map((item) => item.id),
      expectedReleaseId: 'release-1',
      expectedConfigDigest: 'digest-1'
    });
    expect(result.map((item) => item.outcome)).toEqual(['failed', 'failed', 'failed']);
    expect(result.map((item) => item.reasonCode)).toEqual([
      'PROCESS_UNSTABLE',
      'HTTP_REDIRECT_REJECTED',
      'RELEASE_IDENTITY_MISMATCH'
    ]);

    await expect(
      runner.run({
        runId: 'RUN_HEALTH_3',
        checkIds: ['http.readiness_local'],
        url: 'https://evil.test'
      } as never)
    ).rejects.toBeInstanceOf(HealthCheckRunnerError);
  });

  test('fails on timeout and oversized response body without returning body bytes', async () => {
    const runner = createHealthCheckRunner({
      definitions,
      dependencies: deps({ fetch: async () => new Response('x'.repeat(1_000), { status: 200 }) })
    });

    const result = await runner.run({
      runId: 'RUN_HEALTH_4',
      checkIds: ['http.readiness_local']
    });
    expect(result[0]).toMatchObject({ outcome: 'failed', reasonCode: 'HTTP_BODY_TOO_LARGE' });
    expect(JSON.stringify(result)).not.toContain('x'.repeat(20));
  });
});
